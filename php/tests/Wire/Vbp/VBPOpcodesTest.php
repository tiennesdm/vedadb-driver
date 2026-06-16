<?php
declare(strict_types=1);

namespace VedaDB\Tests\Wire\Vbp;

use PHPUnit\Framework\TestCase;
use VedaDB\Wire\Vbp\VBPOpcodes as Ops;

final class VBPOpcodesTest extends TestCase
{
    public function testMandatoryOpcodesCount(): void
    {
        $this->assertCount(23, Ops::MANDATORY_OPCODES);
    }

    public function testAllTypeIdsCount(): void
    {
        $this->assertCount(38, Ops::ALL_TYPE_IDS, 'must have 38 type IDs to match Java + .NET POCs');
    }

    public function testOpcodeNamesAreKnown(): void
    {
        $expected = [
            Ops::OP_CLIENT_HELLO, Ops::OP_SERVER_READY, Ops::OP_AUTH_CHALLENGE,
            Ops::OP_AUTH_RESPONSE, Ops::OP_AUTH_OK,
            Ops::OP_QUERY, Ops::OP_EXT_QUERY, Ops::OP_PARSE, Ops::OP_BIND,
            Ops::OP_DATA_CHUNK, Ops::OP_ROWS_FINISHED, Ops::OP_COMMAND_COMPLETE,
            Ops::OP_ERROR,
            Ops::OP_BEGIN, Ops::OP_COMMIT, Ops::OP_ROLLBACK,
            Ops::OP_COPY_IN, Ops::OP_COPY_DONE, Ops::OP_COPY_FAIL,
            Ops::OP_CANCEL_QUERY,
            Ops::OP_PING, Ops::OP_PONG, Ops::OP_CLOSE,
        ];
        foreach ($expected as $op) {
            $this->assertNotEmpty(Ops::opcodeName($op), "opcode name for $op");
        }
    }

    public function testOpcodeNameForUnknown(): void
    {
        $this->assertSame('OP_0xff', Ops::opcodeName(0xff));
    }

    public function testTerminalOpcodes(): void
    {
        // Streaming terminals — end of a multi-frame response.
        $this->assertTrue(Ops::isTerminal(Ops::OP_ROWS_FINISHED));
        $this->assertTrue(Ops::isTerminal(Ops::OP_COMMAND_COMPLETE));
        $this->assertTrue(Ops::isTerminal(Ops::OP_ERROR));
        // Single-shot terminals — entire response is one frame.
        $this->assertTrue(Ops::isTerminal(Ops::OP_SERVER_READY));
        $this->assertTrue(Ops::isTerminal(Ops::OP_AUTH_OK));
        $this->assertTrue(Ops::isTerminal(Ops::OP_AUTH_CHALLENGE));
        $this->assertTrue(Ops::isTerminal(Ops::OP_PONG));
        $this->assertTrue(Ops::isTerminal(Ops::OP_CLOSE));
        // Non-terminal — accumulated in streaming responses.
        $this->assertFalse(Ops::isTerminal(Ops::OP_DATA_CHUNK));
        $this->assertFalse(Ops::isTerminal(Ops::OP_STREAM_CHUNK));
    }

    public function testIsMandatoryOpcode(): void
    {
        $this->assertTrue(Ops::isMandatory(Ops::OP_QUERY));
        $this->assertTrue(Ops::isMandatory(Ops::OP_CLOSE));
        $this->assertFalse(Ops::isMandatory(0x15)); // reserved
        $this->assertFalse(Ops::isMandatory(0xFF));
    }

    public function testTypeNameForKnown(): void
    {
        $this->assertSame('INT4', Ops::typeName(Ops::T_INT4));
        $this->assertSame('TEXT', Ops::typeName(Ops::T_TEXT));
        $this->assertSame('GEO_MULTIPOLYGON', Ops::typeName(Ops::T_GEO_MULTIPOLYGON));
    }

    public function testTypeNameForUnknown(): void
    {
        $this->assertSame('TYPE_0xbeef', Ops::typeName(0xbeef));
    }

    public function testTypeIdByName(): void
    {
        $this->assertSame(Ops::T_INT4, Ops::typeIdByName('INT4'));
        $this->assertSame(Ops::T_TEXT, Ops::typeIdByName('TEXT'));
    }

    public function testTypeIdByNameUnknownThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Ops::typeIdByName('NOPE');
    }

    public function testIsKnownType(): void
    {
        $this->assertTrue(Ops::isKnownType(Ops::T_INT4));
        $this->assertTrue(Ops::isKnownType(Ops::T_GEO_MULTIPOLYGON));
        $this->assertFalse(Ops::isKnownType(99999));
    }

    public function testSqlStateConstants(): void
    {
        $this->assertSame('0A000', Ops::SQLSTATE_FEATURE_NOT_SUPPORTED);
        $this->assertSame('42601', Ops::SQLSTATE_SYNTAX_ERROR);
        $this->assertSame('28000', Ops::SQLSTATE_AUTH_FAILED);
    }

    public function testAuthMechConstants(): void
    {
        $this->assertSame('NONE', Ops::AUTH_MECH_NONE);
        $this->assertSame('PLAIN', Ops::AUTH_MECH_PLAIN);
        $this->assertSame('SCRAM-SHA-256', Ops::AUTH_MECH_SCRAM_SHA_256);
    }

    public function testCanonicalTypeIds(): void
    {
        // Sanity check a few canonical type IDs match the spec.
        $this->assertSame(16, Ops::T_BOOL);
        $this->assertSame(23, Ops::T_INT4);
        $this->assertSame(25, Ops::T_TEXT);
        $this->assertSame(2950, Ops::T_UUID);
        $this->assertSame(5000, Ops::T_VECTOR);
    }
}
