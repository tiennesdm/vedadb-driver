<?php
declare(strict_types=1);

namespace VedaDB\Tests\Wire\Vbp;

use PHPUnit\Framework\TestCase;
use VedaDB\Wire\Vbp\VBPConnection;
use VedaDB\Wire\Vbp\VBPOpcodes as Ops;
use VedaDB\Wire\Vbp\VBPException;

final class VBPConnectionTest extends TestCase
{
    public function testNotConnectedExecuteThrows(): void
    {
        $conn = new VBPConnection('127.0.0.1', 1, 'admin', 'pw', '', 1);
        $this->expectException(VBPException::class);
        $conn->execute('SELECT 1');
    }

    public function testNotConnectedPingThrows(): void
    {
        $conn = new VBPConnection('127.0.0.1', 1, 'admin', 'pw', '', 1);
        $this->expectException(VBPException::class);
        $conn->ping();
    }

    public function testConnectFailsOnUnreachablePort(): void
    {
        $conn = new VBPConnection('127.0.0.1', 1, 'admin', 'pw', '', 1);
        $this->expectException(\Throwable::class);
        $conn->connect();
    }

    public function testDefaultPortIs6380(): void
    {
        $this->assertSame(6380, VBPConnection::DEFAULT_VBP_PORT);
    }

    public function testServerVersionAndCapsStartAtZero(): void
    {
        $conn = new VBPConnection('127.0.0.1', 6380, 'admin', 'pw', '', 1);
        $this->assertSame(0, $conn->getServerVersion());
        $this->assertSame(0, $conn->getServerCaps());
        $this->assertFalse($conn->isConnected());
    }

    public function testAuthMechanismDefaultsToPlain(): void
    {
        // Default auth mechanism should be PLAIN unless VEDADB_VBP_MECH is set.
        $prev = getenv('VEDADB_VBP_MECH');
        putenv('VEDADB_VBP_MECH');
        $conn = new VBPConnection('127.0.0.1', 6380, 'admin', 'pw', '', 1);
        $ref = new \ReflectionClass($conn);
        $prop = $ref->getProperty('authMechanism');
        $prop->setAccessible(true);
        $this->assertSame(Ops::AUTH_MECH_PLAIN, $prop->getValue($conn));
        if ($prev !== false) {
            putenv('VEDADB_VBP_MECH=' . $prev);
        }
    }

    public function testAuthMechanismScramFromEnv(): void
    {
        putenv('VEDADB_VBP_MECH=SCRAM-SHA-256');
        $conn = new VBPConnection('127.0.0.1', 6380, 'admin', 'pw', '', 1);
        $ref = new \ReflectionClass($conn);
        $prop = $ref->getProperty('authMechanism');
        $prop->setAccessible(true);
        $this->assertSame(Ops::AUTH_MECH_SCRAM_SHA_256, $prop->getValue($conn));
        putenv('VEDADB_VBP_MECH');
    }

    public function testAuthMechanismScramFromCtor(): void
    {
        $conn = new VBPConnection('127.0.0.1', 6380, 'admin', 'pw', '', 1, 'scram-sha-256');
        $ref = new \ReflectionClass($conn);
        $prop = $ref->getProperty('authMechanism');
        $prop->setAccessible(true);
        $this->assertSame(Ops::AUTH_MECH_SCRAM_SHA_256, $prop->getValue($conn));
    }
}
