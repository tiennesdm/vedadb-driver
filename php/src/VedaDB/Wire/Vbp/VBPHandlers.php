<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

use VedaDB\Wire\Vbp\VBPOpcodes as Ops;

/**
 * VBP v1 handlers — minimal stub dispatcher. Mirrors the Java POC.
 *
 * In the dev server model (vbp_dev_server), the SERVER side is the
 * canonical implementation; the client side only needs:
 *
 *   - AUTH_RESPONSE (PLAIN dev-mode): just send it and expect AUTH_OK.
 *   - QUERY: send and accumulate frames (DATA_CHUNK + ROWS_FINISHED +
 *     COMMAND_COMPLETE) via the multiplexer.
 *   - PING: send a 8-byte u64 nonce and expect PONG.
 *   - CLOSE: send and close.
 *
 * For test purposes (VBPConformanceRunner), we also have a CLIENT-side
 * handler table that maps an outgoing opcode to the expected incoming
 * terminal opcode(s).
 */
final class VBPHandlers
{
    /**
     * Map outgoing opcode → expected terminal opcode.
     */
    public const CLIENT_EXPECT = [
        Ops::OP_CLIENT_HELLO   => Ops::OP_SERVER_READY,
        Ops::OP_AUTH_RESPONSE  => Ops::OP_AUTH_OK,
        Ops::OP_QUERY          => Ops::OP_COMMAND_COMPLETE,
        Ops::OP_EXT_QUERY      => Ops::OP_COMMAND_COMPLETE,
        Ops::OP_PARSE          => Ops::OP_COMMAND_COMPLETE,
        Ops::OP_BIND           => Ops::OP_COMMAND_COMPLETE,
        Ops::OP_BEGIN          => Ops::OP_COMMAND_COMPLETE,
        Ops::OP_COMMIT         => Ops::OP_COMMAND_COMPLETE,
        Ops::OP_ROLLBACK       => Ops::OP_COMMAND_COMPLETE,
        Ops::OP_COPY_IN        => Ops::OP_COMMAND_COMPLETE,
        Ops::OP_COPY_DONE      => Ops::OP_COMMAND_COMPLETE,
        Ops::OP_CANCEL_QUERY   => Ops::OP_COMMAND_COMPLETE,
        Ops::OP_PING           => Ops::OP_PONG,
        Ops::OP_CLOSE          => Ops::OP_CLOSE,
    ];

    /**
     * Build the "expected terminal" predicate for an outgoing opcode.
     * Returns the opcode name, or null if not in the table.
     */
    public static function expectedTerminalName(int $outOp): ?string
    {
        $expected = self::CLIENT_EXPECT[$outOp] ?? null;
        return $expected === null ? null : Ops::opcodeName($expected);
    }

    /**
     * Build a stub ERROR body for unsupported opcodes.
     */
    public static function unsupportedError(int $op): string
    {
        return VBPTypeCodec::errorBody(
            Ops::SQLSTATE_FEATURE_NOT_SUPPORTED,
            'unsupported opcode: ' . Ops::opcodeName($op),
        );
    }
}
