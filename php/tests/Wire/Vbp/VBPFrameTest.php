<?php
declare(strict_types=1);

namespace VedaDB\Tests\Wire\Vbp;

use PHPUnit\Framework\TestCase;
use VedaDB\Wire\Vbp\VBPFrame;
use VedaDB\Wire\Vbp\VBPProtocolError;
use VedaDB\Wire\Vbp\VBPProtocolException;
use VedaDB\Wire\Vbp\VBPOpcodes as Ops;

final class VBPFrameTest extends TestCase
{
    public function testRoundTripHello(): void
    {
        $f = new VBPFrame(7, Ops::OP_CLIENT_HELLO, 0, "hello world");
        $encoded = $f->encode();
        $this->assertSame(8 + 2 + strlen("hello world"), strlen($encoded));
        $this->assertSame("VDB", substr($encoded, 0, 3));
        $decoded = VBPFrame::decode($encoded);
        $this->assertSame(7, $decoded->seq);
        $this->assertSame(Ops::OP_CLIENT_HELLO, $decoded->op);
        $this->assertSame(0, $decoded->flags);
        $this->assertSame("hello world", $decoded->body);
    }

    public function testEmptyBody(): void
    {
        $f = new VBPFrame(0, Ops::OP_PING, 0, "");
        $encoded = $f->encode();
        $this->assertSame(8 + 2, strlen($encoded));
        $decoded = VBPFrame::decode($encoded);
        $this->assertSame("", $decoded->body);
    }

    public function testBadMagicThrowsBadMagic(): void
    {
        $this->expectException(VBPProtocolException::class);
        try {
            VBPFrame::decode("XYZ" . pack('V', 2) . "\x00\x06\x00");
        } catch (VBPProtocolException $e) {
            $this->assertSame(VBPProtocolError::BadMagic, $e->getProtocolError());
            throw $e;
        }
    }

    public function testTruncatedHeaderThrowsTruncated(): void
    {
        $this->expectException(VBPProtocolException::class);
        try {
            VBPFrame::decode("VD");
        } catch (VBPProtocolException $e) {
            $this->assertSame(VBPProtocolError::Truncated, $e->getProtocolError());
            throw $e;
        }
    }

    public function testTruncatedBodyThrowsTruncated(): void
    {
        $this->expectException(VBPProtocolException::class);
        // header says payload=20, but only 5 bytes follow
        $bad = "VDB" . pack('V', 20) . "\x00\x06\x00ABC";
        try {
            VBPFrame::decode($bad);
        } catch (VBPProtocolException $e) {
            $this->assertSame(VBPProtocolError::Truncated, $e->getProtocolError());
            throw $e;
        }
    }

    public function testOversizePayloadThrowsOversize(): void
    {
        $this->expectException(VBPProtocolException::class);
        $big = "VDB" . pack('V', VBPFrame::MAX_FRAME_LEN + 1) . "\x00\x06\x00";
        try {
            VBPFrame::decode($big);
        } catch (VBPProtocolException $e) {
            $this->assertSame(VBPProtocolError::Oversize, $e->getProtocolError());
            throw $e;
        }
    }

    public function testUnderMinPayloadThrowsTruncated(): void
    {
        $this->expectException(VBPProtocolException::class);
        // payload=1 < opflags_len=2
        $bad = "VDB" . pack('V', 1) . "\x00";
        try {
            VBPFrame::decode($bad);
        } catch (VBPProtocolException $e) {
            $this->assertSame(VBPProtocolError::Truncated, $e->getProtocolError());
            throw $e;
        }
    }

    public function testOffsetDecode(): void
    {
        $f = new VBPFrame(42, Ops::OP_PING, 0, "ping");
        $encoded = $f->encode();
        $prefixed = "ZZZZ" . $encoded . "TAIL";
        $decoded = VBPFrame::decode($prefixed, 4);
        $this->assertSame(42, $decoded->seq);
        $this->assertSame("ping", $decoded->body);
    }

    public function testPayloadLengthIncludesOpAndFlags(): void
    {
        $f = new VBPFrame(1, Ops::OP_QUERY, 0, "SELECT 1");
        $this->assertSame(2 + strlen("SELECT 1"), $f->payloadLength());
        $this->assertSame(8 + 2 + strlen("SELECT 1"), $f->totalLength());
    }

    public function testSeqRangeValidation(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new VBPFrame(256, Ops::OP_PING, 0, "");
    }

    public function testOpRangeValidation(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new VBPFrame(0, 0x100, 0, "");
    }

    public function testFlagsRangeValidation(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new VBPFrame(0, Ops::OP_PING, 0x100, "");
    }

    public function testMaxSeqAllowed(): void
    {
        $f = new VBPFrame(0xFF, Ops::OP_PING, 0, "");
        $this->assertSame(0xFF, $f->seq);
    }
}
