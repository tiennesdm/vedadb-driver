<?php
declare(strict_types=1);

namespace VedaDB\Tests\Wire\Vbp;

use PHPUnit\Framework\TestCase;
use VedaDB\Wire\Vbp\VBPHandlers;
use VedaDB\Wire\Vbp\VBPOpcodes as Ops;

final class VBPHandlersTest extends TestCase
{
    public function testExpectedTerminalForQuery(): void
    {
        $this->assertSame('COMMAND_COMPLETE', VBPHandlers::expectedTerminalName(Ops::OP_QUERY));
        $this->assertSame('AUTH_OK', VBPHandlers::expectedTerminalName(Ops::OP_AUTH_RESPONSE));
        $this->assertSame('PONG', VBPHandlers::expectedTerminalName(Ops::OP_PING));
        $this->assertSame('CLOSE', VBPHandlers::expectedTerminalName(Ops::OP_CLOSE));
        $this->assertSame('COMMAND_COMPLETE', VBPHandlers::expectedTerminalName(Ops::OP_BEGIN));
    }

    public function testUnknownOpReturnsNull(): void
    {
        $this->assertNull(VBPHandlers::expectedTerminalName(0xff));
    }

    public function testUnsupportedErrorBody(): void
    {
        $body = VBPHandlers::unsupportedError(Ops::OP_CANCEL_QUERY);
        $this->assertStringContainsString('CANCEL_QUERY', $body);
        $this->assertStringContainsString('0A000', $body);
    }

    public function testAllClientExpectEntriesAreKnownOpcodes(): void
    {
        foreach (VBPHandlers::CLIENT_EXPECT as $outOp => $expected) {
            $this->assertNotEmpty(Ops::opcodeName($outOp));
            $this->assertNotEmpty(Ops::opcodeName($expected));
        }
    }
}
