<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

/**
 * VBP v1 opcodes (23 mandatory) and 38 type IDs.
 *
 * Opcodes per VBP_SPEC.md §3 + §4. Type IDs per §5. The spec text says
 * "27" but the tables list 36; the canonical Java + .NET POCs agree on
 * 38 (which adds GeoMultipoint and GeoMultipolygon). We use 38.
 */
final class VBPOpcodes
{
    // --- Connection lifecycle ---
    public const OP_CLIENT_HELLO    = 0x01;
    public const OP_SERVER_READY    = 0x02;
    public const OP_AUTH_CHALLENGE  = 0x03;
    public const OP_AUTH_RESPONSE   = 0x04;
    public const OP_AUTH_OK         = 0x05;

    // --- Query ---
    public const OP_QUERY            = 0x06;
    public const OP_EXT_QUERY        = 0x07;
    public const OP_PARSE            = 0x08;
    public const OP_BIND             = 0x09;
    public const OP_DATA_CHUNK       = 0x0A;
    public const OP_ROWS_FINISHED    = 0x0B;
    public const OP_COMMAND_COMPLETE = 0x0C;
    public const OP_ERROR            = 0x0D;

    // --- Transaction ---
    public const OP_BEGIN    = 0x0E;
    public const OP_COMMIT   = 0x0F;
    public const OP_ROLLBACK = 0x10;

    // --- Other ---
    public const OP_COPY_IN      = 0x11;
    public const OP_COPY_DONE    = 0x12;
    public const OP_COPY_FAIL    = 0x13;
    public const OP_CANCEL_QUERY = 0x14;
    // 0x15 reserved
    public const OP_PING         = 0x16;
    public const OP_PONG         = 0x17;
    public const OP_CLOSE        = 0x18;
    public const OP_STREAM_CHUNK = 0x19;
    public const OP_STREAM_END   = 0x1A;
    public const OP_SERVER_PUSH  = 0x1B;

    /** Mandatory opcodes per spec (excludes reserved + extension). */
    public const MANDATORY_OPCODES = [
        self::OP_CLIENT_HELLO, self::OP_SERVER_READY, self::OP_AUTH_CHALLENGE,
        self::OP_AUTH_RESPONSE, self::OP_AUTH_OK,
        self::OP_QUERY, self::OP_EXT_QUERY, self::OP_PARSE, self::OP_BIND,
        self::OP_DATA_CHUNK, self::OP_ROWS_FINISHED, self::OP_COMMAND_COMPLETE,
        self::OP_ERROR, self::OP_BEGIN, self::OP_COMMIT, self::OP_ROLLBACK,
        self::OP_COPY_IN, self::OP_COPY_DONE, self::OP_COPY_FAIL,
        self::OP_CANCEL_QUERY, self::OP_PING, self::OP_PONG, self::OP_CLOSE,
    ];

    /** Set of mandatory opcodes, for O(1) isMandatory() checks. */
    public const MANDATORY_OPCODES_SET = [
        0x01 => true, 0x02 => true, 0x03 => true, 0x04 => true, 0x05 => true,
        0x06 => true, 0x07 => true, 0x08 => true, 0x09 => true, 0x0A => true,
        0x0B => true, 0x0C => true, 0x0D => true, 0x0E => true, 0x0F => true,
        0x10 => true, 0x11 => true, 0x12 => true, 0x13 => true, 0x14 => true,
        0x16 => true, 0x17 => true, 0x18 => true,
    ];

    // --- Type IDs (38 in Java + .NET POCs) ---
    public const T_BOOL              = 16;
    public const T_INT2              = 21;
    public const T_INT4              = 23;
    public const T_INT8              = 20;
    public const T_FLOAT4            = 700;
    public const T_FLOAT8            = 701;
    public const T_TEXT              = 25;
    public const T_VARCHAR           = 1043;
    public const T_BPCHAR            = 1042;
    public const T_NAME              = 19;
    public const T_OID               = 26;
    public const T_BYTEA             = 17;
    public const T_UUID              = 2950;
    public const T_DATE              = 1082;
    public const T_TIME              = 1083;
    public const T_TIMESTAMP         = 1114;
    public const T_TIMESTAMPTZ      = 1184;
    public const T_INTERVAL          = 1186;
    public const T_NUMERIC           = 1700;
    public const T_MONEY             = 790;
    public const T_JSON              = 114;
    public const T_JSONB             = 3802;
    public const T_ARRAY             = 2277;
    public const T_INET              = 869;
    public const T_MACADDR           = 829;
    public const T_CIDR              = 650;
    public const T_VECTOR            = 5000;
    public const T_TSVECTOR          = 3614;
    public const T_DOCUMENT          = 5100;
    public const T_GRAPH_NODE        = 5300;
    public const T_GRAPH_EDGE        = 5301;
    public const T_TS_POINT          = 5400;
    public const T_TS_SERIES         = 5401;
    public const T_GEO_POINT         = 5500;
    public const T_GEO_PATH          = 5501;
    public const T_GEO_POLYGON       = 5502;
    public const T_GEO_MULTIPOINT    = 5503;
    public const T_GEO_MULTIPOLYGON  = 5504;

    /** All 38 type IDs, in canonical order. */
    public const ALL_TYPE_IDS = [
        self::T_BOOL, self::T_INT2, self::T_INT4, self::T_INT8,
        self::T_FLOAT4, self::T_FLOAT8,
        self::T_TEXT, self::T_VARCHAR, self::T_BPCHAR, self::T_NAME,
        self::T_OID, self::T_BYTEA, self::T_UUID,
        self::T_DATE, self::T_TIME, self::T_TIMESTAMP, self::T_TIMESTAMPTZ,
        self::T_INTERVAL, self::T_NUMERIC, self::T_MONEY,
        self::T_JSON, self::T_JSONB, self::T_ARRAY,
        self::T_INET, self::T_MACADDR, self::T_CIDR,
        self::T_VECTOR, self::T_TSVECTOR,
        self::T_DOCUMENT, self::T_GRAPH_NODE, self::T_GRAPH_EDGE,
        self::T_TS_POINT, self::T_TS_SERIES,
        self::T_GEO_POINT, self::T_GEO_PATH, self::T_GEO_POLYGON,
        self::T_GEO_MULTIPOINT, self::T_GEO_MULTIPOLYGON,
    ];

    // --- SQLSTATE codes ---
    public const SQLSTATE_FEATURE_NOT_SUPPORTED = '0A000';
    public const SQLSTATE_SYNTAX_ERROR           = '42601';
    public const SQLSTATE_AUTH_FAILED            = '28000';
    public const SQLSTATE_CONNECTION_FAILURE     = '08006';

    // --- Auth mechanisms ---
    public const AUTH_MECH_NONE         = 'NONE';
    public const AUTH_MECH_PLAIN        = 'PLAIN';
    public const AUTH_MECH_SCRAM_SHA_256 = 'SCRAM-SHA-256';

    /**
     * Opcodes that TERMINATE a response stream and remove the inflight slot.
     *
     * Two categories:
     *   - Streaming: ROWS_FINISHED, COMMAND_COMPLETE, ERROR — end of a
     *     multi-frame response to a query / exec.
     *   - Single-shot: SERVER_READY, AUTH_OK, AUTH_CHALLENGE, PONG, CLOSE —
     *     the entire response is a single frame.
     */
    public const TERMINAL_OPCODES = [
        self::OP_ROWS_FINISHED    => true,
        self::OP_COMMAND_COMPLETE => true,
        self::OP_ERROR            => true,
        self::OP_SERVER_READY     => true,
        self::OP_AUTH_OK          => true,
        self::OP_AUTH_CHALLENGE   => true,
        self::OP_PONG             => true,
        self::OP_CLOSE            => true,
    ];

    public static function isTerminal(int $op): bool
    {
        return isset(self::TERMINAL_OPCODES[$op]);
    }

    public static function isMandatory(int $op): bool
    {
        return isset(self::MANDATORY_OPCODES_SET[$op]);
    }

    public static function isKnownType(int $typeId): bool
    {
        return in_array($typeId, self::ALL_TYPE_IDS, true);
    }

    /** Return a human-readable opcode name, or `OP_0xNN` for unknown. */
    public static function opcodeName(int $op): string
    {
        $names = [
            0x01 => 'CLIENT_HELLO',  0x02 => 'SERVER_READY',
            0x03 => 'AUTH_CHALLENGE', 0x04 => 'AUTH_RESPONSE', 0x05 => 'AUTH_OK',
            0x06 => 'QUERY', 0x07 => 'EXT_QUERY', 0x08 => 'PARSE', 0x09 => 'BIND',
            0x0A => 'DATA_CHUNK', 0x0B => 'ROWS_FINISHED', 0x0C => 'COMMAND_COMPLETE',
            0x0D => 'ERROR',
            0x0E => 'BEGIN', 0x0F => 'COMMIT', 0x10 => 'ROLLBACK',
            0x11 => 'COPY_IN', 0x12 => 'COPY_DONE', 0x13 => 'COPY_FAIL',
            0x14 => 'CANCEL_QUERY',
            0x16 => 'PING', 0x17 => 'PONG', 0x18 => 'CLOSE',
            0x19 => 'STREAM_CHUNK', 0x1A => 'STREAM_END', 0x1B => 'SERVER_PUSH',
        ];
        return $names[$op] ?? sprintf('OP_0x%02x', $op & 0xFF);
    }

    /** Return a human-readable type name, or `TYPE_0xNNNN` for unknown. */
    public static function typeName(int $typeId): string
    {
        $names = [
            self::T_BOOL => 'BOOL', self::T_INT2 => 'INT2', self::T_INT4 => 'INT4',
            self::T_INT8 => 'INT8', self::T_FLOAT4 => 'FLOAT4', self::T_FLOAT8 => 'FLOAT8',
            self::T_TEXT => 'TEXT', self::T_VARCHAR => 'VARCHAR', self::T_BPCHAR => 'BPCHAR',
            self::T_NAME => 'NAME', self::T_OID => 'OID', self::T_BYTEA => 'BYTEA',
            self::T_UUID => 'UUID', self::T_DATE => 'DATE', self::T_TIME => 'TIME',
            self::T_TIMESTAMP => 'TIMESTAMP', self::T_TIMESTAMPTZ => 'TIMESTAMPTZ',
            self::T_INTERVAL => 'INTERVAL', self::T_NUMERIC => 'NUMERIC', self::T_MONEY => 'MONEY',
            self::T_JSON => 'JSON', self::T_JSONB => 'JSONB', self::T_ARRAY => 'ARRAY',
            self::T_INET => 'INET', self::T_MACADDR => 'MACADDR', self::T_CIDR => 'CIDR',
            self::T_VECTOR => 'VECTOR', self::T_TSVECTOR => 'TSVECTOR',
            self::T_DOCUMENT => 'DOCUMENT', self::T_GRAPH_NODE => 'GRAPH_NODE',
            self::T_GRAPH_EDGE => 'GRAPH_EDGE',
            self::T_TS_POINT => 'TS_POINT', self::T_TS_SERIES => 'TS_SERIES',
            self::T_GEO_POINT => 'GEO_POINT', self::T_GEO_PATH => 'GEO_PATH',
            self::T_GEO_POLYGON => 'GEO_POLYGON', self::T_GEO_MULTIPOINT => 'GEO_MULTIPOINT',
            self::T_GEO_MULTIPOLYGON => 'GEO_MULTIPOLYGON',
        ];
        return $names[$typeId] ?? sprintf('TYPE_0x%04x', $typeId & 0xFFFF);
    }

    public static function typeIdByName(string $name): int
    {
        foreach (self::ALL_TYPE_IDS as $id) {
            if (self::typeName($id) === $name) {
                return $id;
            }
        }
        throw new \InvalidArgumentException("unknown type name: $name");
    }
}
