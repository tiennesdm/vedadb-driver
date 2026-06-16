<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

use VedaDB\Wire\Vbp\VBPOpcodes as Ops;

/**
 * VBP authentication: PLAIN (RFC 4616) and SCRAM-SHA-256 (RFC 5802 / RFC 7677).
 *
 * PLAIN: a single AUTH_RESPONSE frame carrying "\0user\0pass".
 *
 * SCRAM-SHA-256: full 4-message flow.
 *
 *   CRITICAL — c= binding correctness (RFC 5802 §6):
 *     cbind_input = GS2Header + "," + client_first_bare
 *     c = base64(cbind_input)
 *     NOT gs2_header + "," + client_nonce.
 *
 *   Canonical pencil test vector (RFC 5802 §5):
 *     username = "user", password = "pencil",
 *     client_first_bare = "n=user,r=client-nonce"
 *     GS2Header = "n,,"
 *     cbind_input = "n,,n=user,r=client-nonce"
 *     channel_binding = base64("n,,n=user,r=client-nonce")
 *
 *   This MUST match the literal "n,,n=user,r=..." pattern; the buggy
 *   first Python + Node submissions had c=base64(gs2_header) only.
 *   The post-fix Node POC is the gold standard — see PR fix in the
 *   repo.
 *
 * Pure stdlib: uses ext-hash (hash_hmac, hash) and ext-openssl (random_bytes).
 * No third-party dependencies.
 */
final class VBPAuth
{
    private const GS2_HEADER = 'n,,';

    private function __construct()
    {
    }

    // ============================================================
    // PLAIN
    // ============================================================

    /**
     * RFC 4616 client-first-message for PLAIN: \0user\0pass.
     */
    public static function plainClientFirst(string $username, string $password): string
    {
        return "\0" . $username . "\0" . $password;
    }

    // ============================================================
    // SCRAM-SHA-256 (RFC 5802)
    // ============================================================

    /**
     * Generate a 24-char base64-encoded client nonce (192 bits, per RFC 5802 §5.1).
     *
     * CRITICAL: uses random_bytes() — the PHP CSPRNG. NEVER use rand()
     * or mt_rand() (they are NOT cryptographically secure).
     */
    public static function generateNonce(): string
    {
        // 18 raw bytes → 24 base64 chars (no padding).
        return base64_encode(random_bytes(18));
    }

    public static function saslName(string $name): string
    {
        // RFC 5802 §5.1: "=2C" for "," and "=3D" for "=".
        return strtr($name, [',' => '=2C', '=' => '=3D']);
    }

    public static function clientFirstMessage(string $username, string $clientNonce): string
    {
        return 'n=' . self::saslName($username) . ',r=' . $clientNonce;
    }

    /**
     * Parse the SCRAM server-first into its parts: r, s, i (+ optional extensions).
     *
     * @return array{r:string,s:string,i:int,extensions:array<string,string>}
     */
    public static function parseServerFirst(string $serverFirst): array
    {
        $out = ['r' => '', 's' => '', 'i' => 0, 'extensions' => []];
        foreach (explode(',', $serverFirst) as $part) {
            $eq = strpos($part, '=');
            if ($eq === false) {
                continue;
            }
            $k = substr($part, 0, $eq);
            $v = substr($part, $eq + 1);
            if ($k === 'r') {
                $out['r'] = $v;
            } elseif ($k === 's') {
                $out['s'] = $v;
            } elseif ($k === 'i') {
                $out['i'] = (int) $v;
            } else {
                $out['extensions'][$k] = $v;
            }
        }
        if ($out['r'] === '' || $out['s'] === '' || $out['i'] === 0) {
            throw new VBPError(
                Ops::SQLSTATE_AUTH_FAILED,
                'malformed server-first: missing r/s/i',
            );
        }
        return $out;
    }

    /**
     * PBKDF2-HMAC-SHA-256. PHP 8 has hash_pbkdf2 natively; we use it
     * with binary output (true) so we can hand the bytes to HMAC.
     */
    public static function hi(string $password, string $salt, int $iters): string
    {
        return hash_pbkdf2('sha256', $password, $salt, $iters, 32, true);
    }

    /**
     * Build the SCRAM client-final-message (ASCII wire string).
     *
     * Also caches auth state on $state for verify_server_final().
     */
    public static function clientFinalMessage(
        VBPScramState $state,
        string $username,
        string $password,
        string $serverFirst,
    ): string {
        $parsed = self::parseServerFirst($serverFirst);
        $combined = $parsed['r'];
        if (!str_starts_with($combined, $state->clientNonce)) {
            throw new VBPError(
                Ops::SQLSTATE_AUTH_FAILED,
                'server nonce does not begin with client nonce (possible MITM)',
            );
        }
        $state->combinedNonce = $combined;
        $salt = base64_decode($parsed['s'], true);
        if ($salt === false) {
            throw new VBPError(Ops::SQLSTATE_AUTH_FAILED, 'invalid base64 salt');
        }
        $iters = $parsed['i'];

        $salted = self::hi($password, $salt, $iters);
        $state->saltedPassword = $salted;
        $clientKey = hash_hmac('sha256', 'Client Key', $salted, true);
        $storedKey = hash('sha256', $clientKey, true);
        $state->storedKey = $storedKey;
        $serverKey = hash_hmac('sha256', 'Server Key', $salted, true);
        $state->serverKey = $serverKey;

        $clientFirstBare = 'n=' . self::saslName($username) . ',r=' . $state->clientNonce;
        // *** CORRECT c= binding per RFC 5802 §6 ***
        // For gs2-flag 'n' (no channel binding), cbind-data is ABSENT, so
        // cbind-input is just gs2-header = "n,,". c = base64("n,,") = "biws"
        // (the canonical pencil test vector).
        //
        // The previous (buggy) Node + Python POCs had:
        //   c = base64(gs2_header + "," + client_first_bare)
        // which is wrong because there is no cbind-data when gs2-cbind-flag
        // is "n". The post-fix Node POC is the gold standard — c=biws.
        $channelBinding = base64_encode(self::GS2_HEADER);
        $clientFinalWithoutProof = 'c=' . $channelBinding . ',r=' . $combined;
        $serverFirstRecon = 'r=' . $combined . ',s=' . $parsed['s'] . ',i=' . $iters;
        $authMessage = $clientFirstBare . ',' . $serverFirstRecon . ',' . $clientFinalWithoutProof;
        $state->authMessage = $authMessage;
        $clientSig = hash_hmac('sha256', $authMessage, $storedKey, true);
        $clientProof = $clientKey ^ $clientSig;
        $state->clientProof = $clientProof;
        return $clientFinalWithoutProof . ',p=' . base64_encode($clientProof);
    }

    /**
     * Verify the server-final (RFC 5802 §6) message.
     * The server-final is "v=<base64-signature>".
     */
    public static function verifyServerFinal(VBPScramState $state, string $serverFinal): void
    {
        if (!str_starts_with($serverFinal, 'v=')) {
            // Server may also return an error of the form e=<code>.
            throw new VBPError(
                Ops::SQLSTATE_AUTH_FAILED,
                'server-final has no v= signature: ' . $serverFinal,
            );
        }
        $serverSig = base64_decode(substr($serverFinal, 2), true);
        if ($serverSig === false) {
            throw new VBPError(Ops::SQLSTATE_AUTH_FAILED, 'invalid base64 in v=');
        }
        if ($state->saltedPassword === null || $state->authMessage === null) {
            throw new VBPError('0A000', 'verify_server_final called before client_final');
        }
        $serverKey = hash_hmac('sha256', 'Server Key', $state->saltedPassword, true);
        $expected = hash_hmac('sha256', $state->authMessage, $serverKey, true);
        if (!hash_equals($expected, $serverSig)) {
            throw new VBPError(
                Ops::SQLSTATE_AUTH_FAILED,
                'server signature does not match — possible MITM',
            );
        }
    }
}
