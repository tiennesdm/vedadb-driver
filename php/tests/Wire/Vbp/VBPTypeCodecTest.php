<?php
declare(strict_types=1);

namespace VedaDB\Tests\Wire\Vbp;

use PHPUnit\Framework\TestCase;
use VedaDB\Wire\Vbp\VBPTypeCodec;
use VedaDB\Wire\Vbp\VBPOpcodes as Ops;

final class VBPTypeCodecTest extends TestCase
{
    // -- Fixed-width encoders --

    public function testEncodeBool(): void
    {
        $this->assertSame("\x01", VBPTypeCodec::encodeBool(true));
        $this->assertSame("\x00", VBPTypeCodec::encodeBool(false));
    }

    public function testEncodeInt2(): void
    {
        $this->assertSame("\x2a\x00", VBPTypeCodec::encodeInt2(42));
        $this->assertSame("\xff\xff", VBPTypeCodec::encodeInt2(-1));
    }

    public function testEncodeInt4(): void
    {
        $this->assertSame(pack('V', 42), VBPTypeCodec::encodeInt4(42));
    }

    public function testEncodeInt8(): void
    {
        $this->assertSame(pack('P', 100), VBPTypeCodec::encodeInt8(100));
    }

    public function testEncodeFloat4(): void
    {
        $b = VBPTypeCodec::encodeFloat4(1.5);
        $this->assertSame(4, strlen($b));
        $this->assertEqualsWithDelta(1.5, VBPTypeCodec::decodeFloat4($b), 0.0001);
    }

    public function testEncodeFloat8(): void
    {
        $b = VBPTypeCodec::encodeFloat8(2.5);
        $this->assertSame(8, strlen($b));
        $this->assertEqualsWithDelta(2.5, VBPTypeCodec::decodeFloat8($b), 0.0001);
    }

    public function testEncodeTextIsLengthPrefixed(): void
    {
        $b = VBPTypeCodec::encodeText("hi");
        $this->assertSame(pack('V', 2) . "hi", $b);
    }

    public function testEncodeVarchar(): void
    {
        $b = VBPTypeCodec::encodeVarchar("test");
        $this->assertSame(pack('V', 4) . "test", $b);
    }

    public function testEncodeByteaIsLengthPrefixed(): void
    {
        $b = VBPTypeCodec::encodeBytea("\x01\x02");
        $this->assertSame(pack('V', 2) . "\x01\x02", $b);
    }

    public function testEncodeUuidAcceptsCanonicalAndHex(): void
    {
        $uuid = '12345678-1234-5678-1234-567812345678';
        $hex = '12345678123456781234567812345678';
        $this->assertSame(hex2bin($hex), VBPTypeCodec::encodeUuid($uuid));
        $this->assertSame(hex2bin($hex), VBPTypeCodec::encodeUuid($hex));
    }

    public function testEncodeUuidInvalidThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        VBPTypeCodec::encodeUuid('not-a-uuid');
    }

    public function testEncodeJsonb(): void
    {
        $b = VBPTypeCodec::encodeJsonb('{"a":1}');
        $this->assertSame(pack('V', 7) . '{"a":1}', $b);
    }

    public function testEncodeNumericIsLengthPrefixed(): void
    {
        $b = VBPTypeCodec::encodeNumeric("123.45");
        $this->assertSame(pack('V', 6) . "123.45", $b);
    }

    public function testEncodeDate(): void
    {
        $this->assertSame(pack('V', 19000), VBPTypeCodec::encodeDate(19000));
    }

    public function testEncodeMoney(): void
    {
        $this->assertSame(pack('P', 100), VBPTypeCodec::encodeMoney(100));
    }

    // -- Decoders --

    public function testDecodeBool(): void
    {
        $this->assertTrue(VBPTypeCodec::decodeBool("\x01"));
        $this->assertFalse(VBPTypeCodec::decodeBool("\x00"));
    }

    public function testDecodeInt4(): void
    {
        $this->assertSame(42, VBPTypeCodec::decodeInt4(pack('V', 42)));
    }

    public function testDecodeInt8(): void
    {
        $this->assertSame(12345, VBPTypeCodec::decodeInt8(pack('P', 12345)));
    }

    public function testDecodeInt2(): void
    {
        $this->assertSame(0x7fff, VBPTypeCodec::decodeInt2(pack('v', 0x7fff)));
        $this->assertSame(-1, VBPTypeCodec::decodeInt2(pack('v', 0xffff)));
    }

    public function testDecodeText(): void
    {
        $b = pack('V', 5) . "hello";
        $this->assertSame("hello", VBPTypeCodec::decodeText($b));
    }

    public function testDecodeUuid(): void
    {
        $hex = '12345678123456781234567812345678';
        $this->assertSame(
            '12345678-1234-5678-1234-567812345678',
            VBPTypeCodec::decodeUuid(hex2bin($hex)),
        );
    }

    // -- Input envelope --

    public function testInputEnvelopeNonNull(): void
    {
        $env = VBPTypeCodec::inputEnvelope(Ops::T_INT4, pack('V', 7));
        // NULL_TAG_NOT_NULL + u16 typeId + u32 len + body
        $this->assertSame(
            chr(0) . pack('v', Ops::T_INT4) . pack('V', 4) . pack('V', 7),
            $env,
        );
    }

    public function testInputEnvelopeNull(): void
    {
        $env = VBPTypeCodec::inputEnvelopeNull(Ops::T_INT4);
        $this->assertSame(chr(1) . pack('v', Ops::T_INT4), $env);
    }

    // -- Output envelope --

    public function testOutputEnvelopeRowSingleInt4(): void
    {
        $env = VBPTypeCodec::outputEnvelopeRow([Ops::T_INT4], [pack('V', 1)]);
        $decoded = VBPTypeCodec::parseDataChunk($env);
        $this->assertSame(1, $decoded['nColumns']);
        $this->assertSame([Ops::T_INT4], $decoded['colTypes']);
        $this->assertSame([1], $decoded['values']);
    }

    public function testOutputEnvelopeRowMultiColumn(): void
    {
        $env = VBPTypeCodec::outputEnvelopeRow(
            [Ops::T_INT4, Ops::T_TEXT, Ops::T_BOOL],
            [pack('V', 99), pack('V', 3) . "foo", "\x01"],
        );
        $decoded = VBPTypeCodec::parseDataChunk($env);
        $this->assertSame(3, $decoded['nColumns']);
        $this->assertSame([99, "foo", true], $decoded['values']);
    }

    public function testOutputEnvelopeRowWithNull(): void
    {
        $env = VBPTypeCodec::outputEnvelopeRow(
            [Ops::T_INT4, Ops::T_TEXT],
            [null, pack('V', 3) . "bar"],
            0b01, // bit 0 = first col NULL
        );
        $decoded = VBPTypeCodec::parseDataChunk($env);
        $this->assertNull($decoded['values'][0]);
        $this->assertSame("bar", $decoded['values'][1]);
    }

    public function testSelectOneRow(): void
    {
        $env = VBPTypeCodec::selectOneRow();
        $decoded = VBPTypeCodec::parseDataChunk($env);
        $this->assertSame([1], $decoded['values']);
    }

    // -- ROWS_FINISHED --

    public function testRowsFinishedBody(): void
    {
        $body = VBPTypeCodec::rowsFinished(3, 2, [Ops::T_INT4, Ops::T_TEXT]);
        $u = unpack('VnRows/VnCols', substr($body, 0, 8));
        $this->assertSame(3, $u['nRows']);
        $this->assertSame(2, $u['nCols']);
    }

    // -- COMMAND_COMPLETE --

    public function testCommandCompleteBody(): void
    {
        $body = VBPTypeCodec::commandComplete("SELECT", 5);
        $u = unpack('VtLen', substr($body, 0, 4));
        $this->assertSame(6, $u['tLen']);
        $this->assertSame("SELECT", substr($body, 4, 6));
    }

    // -- ERROR body --

    public function testErrorBody(): void
    {
        $body = VBPTypeCodec::errorBody("42601", "syntax error", "at line 1", "check quotes");
        $parsed = VBPTypeCodec::parseErrorBody($body);
        $this->assertSame("42601", $parsed['sqlstate']);
        $this->assertSame("syntax error", $parsed['message']);
        $this->assertSame("at line 1", $parsed['detail']);
        $this->assertSame("check quotes", $parsed['hint']);
    }

    public function testErrorBodyPaddedSqlstate(): void
    {
        $body = VBPTypeCodec::errorBody("42", "short");
        $parsed = VBPTypeCodec::parseErrorBody($body);
        $this->assertSame("42000", $parsed['sqlstate']);
    }

    // -- CLIENT_HELLO --

    public function testClientHelloBody(): void
    {
        $body = VBPTypeCodec::clientHelloBody(1, 0, "admin", "main", 0, "admin");
        $this->assertGreaterThan(0, strlen($body));
        $u = unpack('vver/vflags', substr($body, 0, 4));
        $this->assertSame(1, $u['ver']);
        $this->assertSame(0, $u['flags']);
    }

    // -- SERVER_READY parser --

    public function testParseServerReady(): void
    {
        $body = pack('VV', 100, 0x42) . "\x01" . pack('V', 4) . "ABCD";
        $sr = VBPTypeCodec::parseServerReady($body);
        $this->assertSame(100, $sr['serverVersion']);
        $this->assertSame(0x42, $sr['serverCaps']);
        $this->assertTrue($sr['authRequired']);
        $this->assertSame("ABCD", $sr['nonce']);
    }

    // -- AUTH_OK parser --

    public function testParseAuthOk(): void
    {
        $body = pack('P', 12345) . pack('P', 67890) . pack('V', 7);
        $parsed = VBPTypeCodec::parseAuthOk($body);
        $this->assertSame(12345, $parsed['sessionTokenLo']);
        $this->assertSame(67890, $parsed['sessionTokenHi']);
        $this->assertSame(7, $parsed['serverFlags']);
    }

    // -- QUERY body --

    public function testQueryBodyNoParams(): void
    {
        $body = VBPTypeCodec::queryBody(1, "SELECT 1");
        $parsed = VBPTypeCodec::parseQuery($body);
        $this->assertSame(1, $parsed['queryId']);
        $this->assertSame("SELECT 1", $parsed['sql']);
        $this->assertSame(0, $parsed['nParams']);
    }

    public function testQueryBodyWithParams(): void
    {
        $env = VBPTypeCodec::inputEnvelope(Ops::T_INT4, pack('V', 7));
        $body = VBPTypeCodec::queryBody(2, "SELECT ?", [$env]);
        $parsed = VBPTypeCodec::parseQuery($body);
        $this->assertSame(2, $parsed['queryId']);
        $this->assertSame("SELECT ?", $parsed['sql']);
        $this->assertSame(1, $parsed['nParams']);
    }

    // -- PING body --

    public function testPingBody(): void
    {
        $nonce = random_bytes(8);
        $body = VBPTypeCodec::pingBody($nonce);
        $this->assertSame(8, strlen($body));
        $this->assertSame($nonce, $body);
    }

    public function testPingBodyInvalidLengthThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        VBPTypeCodec::pingBody("abc");
    }
}
