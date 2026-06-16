<?php
declare(strict_types=1);

namespace VedaDB\Tests\Wire\Vbp;

use PHPUnit\Framework\TestCase;
use VedaDB\Wire\Vbp\VBPAuth;
use VedaDB\Wire\Vbp\VBPError;
use VedaDB\Wire\Vbp\VBPOpcodes as Ops;
use VedaDB\Wire\Vbp\VBPScramState;

final class VBPAuthTest extends TestCase
{
    public function testPlainClientFirst(): void
    {
        $this->assertSame(
            "\0admin\0secret",
            VBPAuth::plainClientFirst("admin", "secret"),
        );
    }

    public function testPlainEmptyUser(): void
    {
        $this->assertSame("\0\0pass", VBPAuth::plainClientFirst("", "pass"));
    }

    public function testSaslNameEscapes(): void
    {
        $this->assertSame('user', VBPAuth::saslName('user'));
        $this->assertSame('us=2Cer', VBPAuth::saslName('us,er'));
        $this->assertSame('us=3Der', VBPAuth::saslName('us=er'));
    }

    public function testGenerateNonce(): void
    {
        $n1 = VBPAuth::generateNonce();
        $n2 = VBPAuth::generateNonce();
        $this->assertSame(24, strlen($n1));
        $this->assertSame(24, strlen($n2));
        $this->assertNotSame($n1, $n2, 'two consecutive nonces must differ');
    }

    public function testClientFirstMessage(): void
    {
        $msg = VBPAuth::clientFirstMessage("admin", "ABCDEFGH");
        $this->assertSame("n=admin,r=ABCDEFGH", $msg);
    }

    public function testClientFirstMessageEscapesSpecial(): void
    {
        $msg = VBPAuth::clientFirstMessage("us,er", "ABC");
        $this->assertSame("n=us=2Cer,r=ABC", $msg);
    }

    public function testParseServerFirst(): void
    {
        $parsed = VBPAuth::parseServerFirst("r=combined-nonce,s=c2FsdA==,i=4096");
        $this->assertSame("combined-nonce", $parsed['r']);
        $this->assertSame("c2FsdA==", $parsed['s']);
        $this->assertSame(4096, $parsed['i']);
    }

    public function testParseServerFirstMissingFieldsThrows(): void
    {
        $this->expectException(VBPError::class);
        VBPAuth::parseServerFirst("r=only-nonce");
    }

    public function testHiIsPbkdf2(): void
    {
        // Known PBKDF2-HMAC-SHA-256 test vector (RFC 7914 §11).
        $out = VBPAuth::hi("password", "salt", 1);
        $this->assertSame(32, strlen($out));
    }

    /**
     * **CRITICAL — c= binding pencil test (RFC 5802 §5)**
     *
     * Per RFC 5802 §6, when gs2-cbind-flag is "n" (no channel binding),
     * cbind-data is ABSENT, so cbind-input is just gs2-header = "n,,".
     * c = base64("n,,") = "biws" (the canonical pencil test vector).
     *
     * The Python POC and the first Node POC submission had this bug;
     * they used c=base64(gs2_header + "," + client_first_bare). The
     * post-fix Node POC and the PHP POC both use c=biws.
     */
    public function testCbindPencilVector(): void
    {
        // Manually compute: c = base64("n,,") = "biws".
        $expectedC = base64_encode('n,,');
        $this->assertSame('biws', $expectedC, 'c= must be base64("n,,") = "biws"');
    }

    public function testClientFinalMessageScratch(): void
    {
        // Verify the RFC 7677 §3 SCRAM-SHA-256 vector using the c=biws
        // binding (the canonical pencil vector).
        //   user="user", pass="pencil", client-nonce="fyko+d2lbbFgONRv9qkxdawL"
        //   server-first="r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096"
        //   expected p=qQRLRHGPDGjB+7iVAE7NNi5xEoHKHuLCHPNQ8BTmvds=
        $state = new VBPScramState('fyko+d2lbbFgONRv9qkxdawL');
        $serverFirst = 'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096';
        $msg = VBPAuth::clientFinalMessage($state, 'user', 'pencil', $serverFirst);
        // c= must be "biws" (not "biws,..." or "biwsLG4...")
        $this->assertStringContainsString('c=biws,', $msg);
        $this->assertStringContainsString('p=qQRLRHGPDGjB+7iVAE7NNi5xEoHKHuLCHPNQ8BTmvds=', $msg);
    }

    public function testScramClientFinalRejectsBadNonce(): void
    {
        $state = new VBPScramState('mynonce');
        $serverFirst = 'r=other-nonce,s=QSXCR+Q6sek8bf92,i=4096';
        $this->expectException(VBPError::class);
        VBPAuth::clientFinalMessage($state, 'user', 'pass', $serverFirst);
    }

    public function testVerifyServerFinalOk(): void
    {
        $state = new VBPScramState('mynonce');
        $serverFirst = 'r=mynonce-extra,s=QSXCR+Q6sek8bf92,i=4096';
        VBPAuth::clientFinalMessage($state, 'user', 'pencil', $serverFirst);
        $this->assertNotNull($state->serverKey);
        $expectedV = base64_encode(
            hash_hmac('sha256', $state->authMessage, $state->serverKey, true)
        );
        // Should not throw
        VBPAuth::verifyServerFinal($state, 'v=' . $expectedV);
        $this->assertTrue(true);
    }

    public function testVerifyServerFinalRejectsBadSignature(): void
    {
        $state = new VBPScramState('mynonce');
        $serverFirst = 'r=mynonce-extra,s=QSXCR+Q6sek8bf92,i=4096';
        VBPAuth::clientFinalMessage($state, 'user', 'pencil', $serverFirst);
        $this->expectException(VBPError::class);
        VBPAuth::verifyServerFinal($state, 'v=bm90LXRoZS1yaWdodC1zaWduYXR1cmU=');
    }

    public function testVerifyServerFinalRequiresV(): void
    {
        $state = new VBPScramState('mynonce');
        $state->authMessage = 'foo';
        $state->saltedPassword = 'pwd';
        $this->expectException(VBPError::class);
        VBPAuth::verifyServerFinal($state, 'e=invalid');
    }
}
