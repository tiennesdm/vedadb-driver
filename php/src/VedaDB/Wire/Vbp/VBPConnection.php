<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

use VedaDB\Wire\Vbp\VBPOpcodes as Ops;

/**
 * High-level synchronous VBP client.
 *
 * Public API:
 *   new VBPConnection(host, port, user, password, db, timeoutSec)
 *     ->connect() returns $this
 *     ->execute(sql, params) returns VBPResult
 *     ->ping() returns array with 'latencyMs' and 'nonce'
 *     ->close()
 *
 * Mirrors the Python + Java POC VBPConnection.
 */
class VBPConnection
{
    public const DEFAULT_VBP_PORT = 6380;

    private string $host;
    private int $port;
    private string $user;
    private string $password;
    private string $database;
    private int $timeoutMs;
    private string $authMechanism;

    private ?VBPMultiplexer $mux = null;
    private int $serverVersion = 0;
    private int $serverCaps = 0;
    private int $nextQueryId = 1;
    private bool $connected = false;

    public function __construct(
        string $host,
        int $port,
        string $user,
        string $password,
        string $database = '',
        int $timeoutSeconds = 30,
        ?string $authMechanism = null,
    ) {
        $this->host = $host;
        $this->port = $port;
        $this->user = $user;
        $this->password = $password;
        $this->database = $database;
        $this->timeoutMs = $timeoutSeconds * 1000;
        $envMech = getenv('VEDADB_VBP_MECH');
        $this->authMechanism = $authMechanism !== null && $authMechanism !== ''
            ? strtoupper($authMechanism)
            : ($envMech !== false && $envMech !== '' ? strtoupper($envMech) : Ops::AUTH_MECH_PLAIN);
    }

    public function connect(): self
    {
        $this->mux = new VBPMultiplexer($this->host, $this->port, $this->timeoutMs);

        // CLIENT_HELLO. The server may reply with [SERVER_READY, AUTH_OK]
        // (dev mode, no auth) or just [SERVER_READY] (auth required).
        $hello = VBPTypeCodec::clientHelloBody(1, 0, $this->user, $this->database, 0, $this->user);
        $reply = $this->mux->call(Ops::OP_CLIENT_HELLO, $hello);
        // Find SERVER_READY in the response frames (dev server may also
        // include a no-auth AUTH_OK in the same response).
        $ready = null;
        foreach ($reply['frames'] as $f) {
            if ($f['op'] === Ops::OP_SERVER_READY) {
                $ready = $f;
                break;
            }
        }
        if ($ready === null) {
            throw new VBPError(
                Ops::SQLSTATE_CONNECTION_FAILURE,
                'expected SERVER_READY in CLIENT_HELLO reply, got '
                . Ops::opcodeName($reply['op']),
            );
        }
        $sr = VBPTypeCodec::parseServerReady($ready['body']);
        $this->serverVersion = $sr['serverVersion'];
        $this->serverCaps = $sr['serverCaps'];

        if ($sr['authRequired']) {
            $this->performAuth();
        }
        $this->connected = true;
        return $this;
    }

    private function performAuth(): void
    {
        assert($this->mux !== null);
        if ($this->authMechanism === Ops::AUTH_MECH_SCRAM_SHA_256) {
            $this->performScramAuth();
            return;
        }
        // PLAIN
        $plain = VBPAuth::plainClientFirst($this->user, $this->password);
        $reply = $this->mux->call(Ops::OP_AUTH_RESPONSE, $plain);
        if ($reply['op'] !== Ops::OP_AUTH_OK) {
            throw new VBPError(
                Ops::SQLSTATE_AUTH_FAILED,
                'auth failed: ' . Ops::opcodeName($reply['op']),
            );
        }
    }

    private function performScramAuth(): void
    {
        assert($this->mux !== null);
        $clientNonce = VBPAuth::generateNonce();
        $clientFirst = VBPAuth::clientFirstMessage($this->user, $clientNonce);
        $reply = $this->mux->call(
            Ops::OP_AUTH_RESPONSE,
            'SCRAM-SHA-256 ' . $clientFirst,
        );
        // Dev server in PLAIN mode may simply return AUTH_OK without a challenge.
        if ($reply['op'] === Ops::OP_AUTH_OK) {
            return;
        }
        if ($reply['op'] !== Ops::OP_AUTH_CHALLENGE) {
            throw new VBPError(
                Ops::SQLSTATE_AUTH_FAILED,
                'expected AUTH_CHALLENGE, got ' . Ops::opcodeName($reply['op']),
            );
        }
        $serverFirst = $reply['body'];
        $state = new VBPScramState($clientNonce);
        $clientFinal = VBPAuth::clientFinalMessage($state, $this->user, $this->password, $serverFirst);
        $reply = $this->mux->call(Ops::OP_AUTH_RESPONSE, $clientFinal);
        if ($reply['op'] !== Ops::OP_AUTH_OK) {
            throw new VBPError(
                Ops::SQLSTATE_AUTH_FAILED,
                'expected AUTH_OK, got ' . Ops::opcodeName($reply['op']),
            );
        }
        // Server-final is not delivered in v1 dev server mode; skip verification.
    }

    /**
     * Execute a query and return a VBPResult.
     *
     * @param ?string[] $params
     */
    public function execute(string $sql, ?array $params = null): VBPResult
    {
        $this->ensureConnected();
        assert($this->mux !== null);
        $qid = $this->nextQueryId++;
        $body = VBPTypeCodec::queryBody($qid, $sql, $params);
        $reply = $this->mux->call(Ops::OP_QUERY, $body);

        $columns = [];
        $colTypes = [];
        $rows = [];
        $tag = '';
        $rowsAffected = 0;
        foreach ($reply['frames'] as $f) {
            switch ($f['op']) {
                case Ops::OP_DATA_CHUNK:
                    $chunk = VBPTypeCodec::parseDataChunk($f['body']);
                    $colTypes = $chunk['colTypes'];
                    // Column names: we don't get them in the body, but the
                    // canonical "SELECT 1 AS n" pattern has a single INT4.
                    // For v1 POC, synthesize "col_0", "col_1", ...
                    if (count($columns) === 0) {
                        for ($i = 0; $i < $chunk['nColumns']; $i++) {
                            $columns[] = 'col_' . $i;
                        }
                    }
                    $rows[] = $chunk['values'];
                    break;
                case Ops::OP_ROWS_FINISHED:
                    $body = $f['body'];
                    if (strlen($body) >= 8) {
                        $u = unpack('VnRows/VnCols', substr($body, 0, 8));
                        $nRows = (int) ($u['nRows'] ?? 0);
                        while (count($rows) < $nRows) {
                            $rows[] = array_fill(0, count($colTypes), null);
                        }
                    }
                    break;
                case Ops::OP_COMMAND_COMPLETE:
                    $body = $f['body'];
                    if (strlen($body) >= 4) {
                        $u = unpack('VtLen', substr($body, 0, 4));
                        $tLen = $u['tLen'] ?? 0;
                        if ($tLen > 0 && strlen($body) >= 4 + $tLen) {
                            $tag = substr($body, 4, $tLen);
                        } else {
                            // Some servers (incl. the dev server) emit a
                            // bare ASCII tag with no length prefix.
                            $tag = $body;
                        }
                        if (strlen($body) >= 4 + $tLen + 8) {
                            $ra = unpack('Prows', substr($body, 4 + $tLen, 8));
                            $rowsAffected = (int) ($ra['rows'] ?? 0);
                        }
                    } else {
                        $tag = $body;
                    }
                    break;
            }
        }
        return new VBPResult($columns, $colTypes, $rows, $tag, (int) $rowsAffected);
    }

    /**
     * Send a PING. Returns latency (ms) and the echoed nonce.
     *
     * @return array{latencyMs:float,nonce:string}
     */
    public function ping(): array
    {
        $this->ensureConnected();
        assert($this->mux !== null);
        $nonce = random_bytes(8);
        $start = microtime(true);
        $reply = $this->mux->call(Ops::OP_PING, $nonce);
        $latency = (microtime(true) - $start) * 1000.0;
        if ($reply['op'] !== Ops::OP_PONG) {
            throw new VBPError(
                Ops::SQLSTATE_FEATURE_NOT_SUPPORTED,
                'expected PONG, got ' . Ops::opcodeName($reply['op']),
            );
        }
        return ['latencyMs' => $latency, 'nonce' => $nonce];
    }

    public function close(): void
    {
        if ($this->mux !== null && $this->connected) {
            try {
                $this->mux->call(Ops::OP_CLOSE, '');
            } catch (\Throwable) {
                // ignore — connection may already be closed
            }
        }
        if ($this->mux !== null) {
            $this->mux->close();
            $this->mux = null;
        }
        $this->connected = false;
    }

    public function __destruct()
    {
        try {
            $this->close();
        } catch (\Throwable) {
            // ignore
        }
    }

    public function getServerVersion(): int
    {
        return $this->serverVersion;
    }

    public function getServerCaps(): int
    {
        return $this->serverCaps;
    }

    public function isConnected(): bool
    {
        return $this->connected;
    }

    private function ensureConnected(): void
    {
        if (!$this->connected || $this->mux === null) {
            throw new VBPException(
                Ops::SQLSTATE_CONNECTION_FAILURE,
                'not connected — call connect() first',
            );
        }
    }
}
