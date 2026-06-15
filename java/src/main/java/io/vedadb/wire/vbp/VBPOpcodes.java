package io.vedadb.wire.vbp;

import java.util.HashMap;
import java.util.Map;

/**
 * VBP v1 opcodes (23 mandatory) and 36 type IDs.
 *
 * <p>Opcodes per VBP_SPEC.md §3 + §4.
 * Type IDs per §5. The spec text says "27" but the tables list 36 — see §5.10.
 */
public final class VBPOpcodes {

    // --- Connection lifecycle ---
    public static final int OP_CLIENT_HELLO = 0x01;
    public static final int OP_SERVER_READY = 0x02;
    public static final int OP_AUTH_CHALLENGE = 0x03;
    public static final int OP_AUTH_RESPONSE = 0x04;
    public static final int OP_AUTH_OK = 0x05;

    // --- Query ---
    public static final int OP_QUERY = 0x06;
    public static final int OP_EXT_QUERY = 0x07;
    public static final int OP_PARSE = 0x08;
    public static final int OP_BIND = 0x09;
    public static final int OP_DATA_CHUNK = 0x0A;
    public static final int OP_ROWS_FINISHED = 0x0B;
    public static final int OP_COMMAND_COMPLETE = 0x0C;
    public static final int OP_ERROR = 0x0D;

    // --- Transaction ---
    public static final int OP_BEGIN = 0x0E;
    public static final int OP_COMMIT = 0x0F;
    public static final int OP_ROLLBACK = 0x10;

    // --- Other ---
    public static final int OP_COPY_IN = 0x11;
    public static final int OP_COPY_DONE = 0x12;
    public static final int OP_COPY_FAIL = 0x13;
    public static final int OP_CANCEL_QUERY = 0x14;
    // 0x15 reserved
    public static final int OP_PING = 0x16;
    public static final int OP_PONG = 0x17;
    public static final int OP_CLOSE = 0x18;
    public static final int OP_STREAM_CHUNK = 0x19;
    public static final int OP_STREAM_END = 0x1A;
    public static final int OP_SERVER_PUSH = 0x1B;

    public static final int[] MANDATORY_OPCODES = {
        OP_CLIENT_HELLO, OP_SERVER_READY, OP_AUTH_CHALLENGE, OP_AUTH_RESPONSE, OP_AUTH_OK,
        OP_QUERY, OP_EXT_QUERY, OP_PARSE, OP_BIND, OP_DATA_CHUNK, OP_ROWS_FINISHED,
        OP_COMMAND_COMPLETE, OP_ERROR, OP_BEGIN, OP_COMMIT, OP_ROLLBACK,
        OP_COPY_IN, OP_COPY_DONE, OP_COPY_FAIL, OP_CANCEL_QUERY,
        OP_PING, OP_PONG, OP_CLOSE
    };

    // --- Type IDs (36 in spec tables; "27" is a typo per §5.10) ---
    public static final int T_BOOL = 16;
    public static final int T_INT2 = 21;
    public static final int T_INT4 = 23;
    public static final int T_INT8 = 20;
    public static final int T_FLOAT4 = 700;
    public static final int T_FLOAT8 = 701;
    public static final int T_TEXT = 25;
    public static final int T_VARCHAR = 1043;
    public static final int T_BPCHAR = 1042;
    public static final int T_NAME = 19;
    public static final int T_OID = 26;
    public static final int T_BYTEA = 17;
    public static final int T_UUID = 2950;
    public static final int T_DATE = 1082;
    public static final int T_TIME = 1083;
    public static final int T_TIMESTAMP = 1114;
    public static final int T_TIMESTAMPTZ = 1184;
    public static final int T_INTERVAL = 1186;
    public static final int T_NUMERIC = 1700;
    public static final int T_MONEY = 790;
    public static final int T_JSON = 114;
    public static final int T_JSONB = 3802;
    public static final int T_ARRAY = 2277;
    public static final int T_INET = 869;
    public static final int T_MACADDR = 829;
    public static final int T_CIDR = 650;
    public static final int T_VECTOR = 5000;
    public static final int T_TSVECTOR = 3614;
    public static final int T_DOCUMENT = 5100;
    public static final int T_GRAPH_NODE = 5300;
    public static final int T_GRAPH_EDGE = 5301;
    public static final int T_TS_POINT = 5400;
    public static final int T_TS_SERIES = 5401;
    public static final int T_GEO_POINT = 5500;
    public static final int T_GEO_PATH = 5501;
    public static final int T_GEO_POLYGON = 5502;
    public static final int T_GEO_MULTIPOINT = 5503;
    public static final int T_GEO_MULTIPOLYGON = 5504;

    public static final int[] ALL_TYPE_IDS = {
        T_BOOL, T_INT2, T_INT4, T_INT8, T_FLOAT4, T_FLOAT8,
        T_TEXT, T_VARCHAR, T_BPCHAR, T_NAME, T_OID, T_BYTEA, T_UUID,
        T_DATE, T_TIME, T_TIMESTAMP, T_TIMESTAMPTZ, T_INTERVAL,
        T_NUMERIC, T_MONEY, T_JSON, T_JSONB, T_ARRAY,
        T_INET, T_MACADDR, T_CIDR, T_VECTOR, T_TSVECTOR,
        T_DOCUMENT, T_GRAPH_NODE, T_GRAPH_EDGE,
        T_TS_POINT, T_TS_SERIES,
        T_GEO_POINT, T_GEO_PATH, T_GEO_POLYGON, T_GEO_MULTIPOINT, T_GEO_MULTIPOLYGON
    };

    // --- SQLSTATE codes ---
    public static final String SQLSTATE_FEATURE_NOT_SUPPORTED = "0A000";
    public static final String SQLSTATE_SYNTAX_ERROR = "42601";
    public static final String SQLSTATE_AUTH_FAILED = "28000";

    // --- Auth mechanisms ---
    public static final String AUTH_MECH_NONE = "NONE";
    public static final String AUTH_MECH_PLAIN = "PLAIN";
    public static final String AUTH_MECH_SCRAM_SHA_256 = "SCRAM-SHA-256";

    private static final Map<Integer, String> OPCODE_NAMES = new HashMap<>();
    private static final Map<Integer, String> TYPE_NAMES = new HashMap<>();
    static {
        OPCODE_NAMES.put(OP_CLIENT_HELLO, "CLIENT_HELLO");
        OPCODE_NAMES.put(OP_SERVER_READY, "SERVER_READY");
        OPCODE_NAMES.put(OP_AUTH_CHALLENGE, "AUTH_CHALLENGE");
        OPCODE_NAMES.put(OP_AUTH_RESPONSE, "AUTH_RESPONSE");
        OPCODE_NAMES.put(OP_AUTH_OK, "AUTH_OK");
        OPCODE_NAMES.put(OP_QUERY, "QUERY");
        OPCODE_NAMES.put(OP_EXT_QUERY, "EXT_QUERY");
        OPCODE_NAMES.put(OP_PARSE, "PARSE");
        OPCODE_NAMES.put(OP_BIND, "BIND");
        OPCODE_NAMES.put(OP_DATA_CHUNK, "DATA_CHUNK");
        OPCODE_NAMES.put(OP_ROWS_FINISHED, "ROWS_FINISHED");
        OPCODE_NAMES.put(OP_COMMAND_COMPLETE, "COMMAND_COMPLETE");
        OPCODE_NAMES.put(OP_ERROR, "ERROR");
        OPCODE_NAMES.put(OP_BEGIN, "BEGIN");
        OPCODE_NAMES.put(OP_COMMIT, "COMMIT");
        OPCODE_NAMES.put(OP_ROLLBACK, "ROLLBACK");
        OPCODE_NAMES.put(OP_COPY_IN, "COPY_IN");
        OPCODE_NAMES.put(OP_COPY_DONE, "COPY_DONE");
        OPCODE_NAMES.put(OP_COPY_FAIL, "COPY_FAIL");
        OPCODE_NAMES.put(OP_CANCEL_QUERY, "CANCEL_QUERY");
        OPCODE_NAMES.put(OP_PING, "PING");
        OPCODE_NAMES.put(OP_PONG, "PONG");
        OPCODE_NAMES.put(OP_CLOSE, "CLOSE");
        OPCODE_NAMES.put(OP_STREAM_CHUNK, "STREAM_CHUNK");
        OPCODE_NAMES.put(OP_STREAM_END, "STREAM_END");
        OPCODE_NAMES.put(OP_SERVER_PUSH, "SERVER_PUSH");

        TYPE_NAMES.put(T_BOOL, "BOOL");
        TYPE_NAMES.put(T_INT2, "INT2");
        TYPE_NAMES.put(T_INT4, "INT4");
        TYPE_NAMES.put(T_INT8, "INT8");
        TYPE_NAMES.put(T_FLOAT4, "FLOAT4");
        TYPE_NAMES.put(T_FLOAT8, "FLOAT8");
        TYPE_NAMES.put(T_TEXT, "TEXT");
        TYPE_NAMES.put(T_VARCHAR, "VARCHAR");
        TYPE_NAMES.put(T_BPCHAR, "BPCHAR");
        TYPE_NAMES.put(T_NAME, "NAME");
        TYPE_NAMES.put(T_OID, "OID");
        TYPE_NAMES.put(T_BYTEA, "BYTEA");
        TYPE_NAMES.put(T_UUID, "UUID");
        TYPE_NAMES.put(T_DATE, "DATE");
        TYPE_NAMES.put(T_TIME, "TIME");
        TYPE_NAMES.put(T_TIMESTAMP, "TIMESTAMP");
        TYPE_NAMES.put(T_TIMESTAMPTZ, "TIMESTAMPTZ");
        TYPE_NAMES.put(T_INTERVAL, "INTERVAL");
        TYPE_NAMES.put(T_NUMERIC, "NUMERIC");
        TYPE_NAMES.put(T_MONEY, "MONEY");
        TYPE_NAMES.put(T_JSON, "JSON");
        TYPE_NAMES.put(T_JSONB, "JSONB");
        TYPE_NAMES.put(T_ARRAY, "ARRAY");
        TYPE_NAMES.put(T_INET, "INET");
        TYPE_NAMES.put(T_MACADDR, "MACADDR");
        TYPE_NAMES.put(T_CIDR, "CIDR");
        TYPE_NAMES.put(T_VECTOR, "VECTOR");
        TYPE_NAMES.put(T_TSVECTOR, "TSVECTOR");
        TYPE_NAMES.put(T_DOCUMENT, "DOCUMENT");
        TYPE_NAMES.put(T_GRAPH_NODE, "GRAPH_NODE");
        TYPE_NAMES.put(T_GRAPH_EDGE, "GRAPH_EDGE");
        TYPE_NAMES.put(T_TS_POINT, "TS_POINT");
        TYPE_NAMES.put(T_TS_SERIES, "TS_SERIES");
        TYPE_NAMES.put(T_GEO_POINT, "GEO_POINT");
        TYPE_NAMES.put(T_GEO_PATH, "GEO_PATH");
        TYPE_NAMES.put(T_GEO_POLYGON, "GEO_POLYGON");
        TYPE_NAMES.put(T_GEO_MULTIPOINT, "GEO_MULTIPOINT");
        TYPE_NAMES.put(T_GEO_MULTIPOLYGON, "GEO_MULTIPOLYGON");
    }

    public static String opcodeName(int op) {
        String n = OPCODE_NAMES.get(op);
        return n != null ? n : String.format("OP_0x%02x", op & 0xFF);
    }

    public static String typeName(int typeId) {
        String n = TYPE_NAMES.get(typeId);
        return n != null ? n : String.format("TYPE_0x%04x", typeId & 0xFFFF);
    }

    public static boolean isKnownType(int typeId) {
        return TYPE_NAMES.containsKey(typeId);
    }

    public static int typeIdByName(String name) {
        for (Map.Entry<Integer, String> e : TYPE_NAMES.entrySet()) {
            if (e.getValue().equals(name)) return e.getKey();
        }
        throw new IllegalArgumentException("unknown type name: " + name);
    }

    private VBPOpcodes() {}
}
