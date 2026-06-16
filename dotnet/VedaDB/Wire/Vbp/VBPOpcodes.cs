// VedaDB .NET SDK — VBP wire layer
//
// Opcodes + type IDs per VBP_SPEC.md §3, §4, §5.
// The spec prose says "27 type IDs" — that's a typo per §5.10. We use the
// canonical 36 listed in the spec's type tables (matches the Go reference).

using System.Collections.Generic;

namespace VedaDB.Wire.Vbp
{
    public static class VBPOpcodes
    {
        // --- Connection lifecycle ---
        public const byte ClientHello     = 0x01;
        public const byte ServerReady     = 0x02;
        public const byte AuthChallenge   = 0x03;
        public const byte AuthResponse    = 0x04;
        public const byte AuthOk          = 0x05;

        // --- Query ---
        public const byte Query           = 0x06;
        public const byte ExtQuery        = 0x07;
        public const byte Parse           = 0x08;
        public const byte Bind            = 0x09;
        public const byte DataChunk       = 0x0A;
        public const byte RowsFinished    = 0x0B;
        public const byte CommandComplete = 0x0C;
        public const byte Error           = 0x0D;

        // --- Transaction ---
        public const byte Begin           = 0x0E;
        public const byte Commit          = 0x0F;
        public const byte Rollback        = 0x10;

        // --- Other ---
        public const byte CopyIn          = 0x11;
        public const byte CopyDone        = 0x12;
        public const byte CopyFail        = 0x13;
        public const byte CancelQuery     = 0x14;
        // 0x15 reserved
        public const byte Ping            = 0x16;
        public const byte Pong            = 0x17;
        public const byte Close           = 0x18;
        public const byte StreamChunk     = 0x19;
        public const byte StreamEnd       = 0x1A;
        public const byte ServerPush      = 0x1B;

        /// <summary>The 23 mandatory opcodes from VBP_SPEC.md §3.</summary>
        public static readonly byte[] MandatoryOpcodes = new byte[]
        {
            ClientHello, ServerReady, AuthChallenge, AuthResponse, AuthOk,
            Query, ExtQuery, Parse, Bind, DataChunk, RowsFinished,
            CommandComplete, Error, Begin, Commit, Rollback,
            CopyIn, CopyDone, CopyFail, CancelQuery,
            Ping, Pong, Close
        };

        // --- SQLSTATE codes ---
        public const string SqlStateFeatureNotSupported = "0A000";
        public const string SqlStateSyntaxError         = "42601";
        public const string SqlStateAuthFailed          = "28000";
        public const string SqlStateConnectionFailure   = "08006";

        // --- Auth mechanisms ---
        public const string AuthMechNone        = "NONE";
        public const string AuthMechPlain       = "PLAIN";
        public const string AuthMechScramSha256 = "SCRAM-SHA-256";

        private static readonly Dictionary<byte, string> OpNames = new Dictionary<byte, string>
        {
            { ClientHello,     "CLIENT_HELLO"     },
            { ServerReady,     "SERVER_READY"     },
            { AuthChallenge,   "AUTH_CHALLENGE"   },
            { AuthResponse,    "AUTH_RESPONSE"    },
            { AuthOk,          "AUTH_OK"          },
            { Query,           "QUERY"            },
            { ExtQuery,        "EXT_QUERY"        },
            { Parse,           "PARSE"            },
            { Bind,            "BIND"             },
            { DataChunk,       "DATA_CHUNK"       },
            { RowsFinished,    "ROWS_FINISHED"    },
            { CommandComplete, "COMMAND_COMPLETE" },
            { Error,           "ERROR"            },
            { Begin,           "BEGIN"            },
            { Commit,          "COMMIT"           },
            { Rollback,        "ROLLBACK"         },
            { CopyIn,          "COPY_IN"          },
            { CopyDone,        "COPY_DONE"        },
            { CopyFail,        "COPY_FAIL"        },
            { CancelQuery,     "CANCEL_QUERY"     },
            { Ping,            "PING"             },
            { Pong,            "PONG"             },
            { Close,           "CLOSE"            },
            { StreamChunk,     "STREAM_CHUNK"     },
            { StreamEnd,       "STREAM_END"       },
            { ServerPush,      "SERVER_PUSH"      },
        };

        public static string OpcodeName(byte op) =>
            OpNames.TryGetValue(op, out var n) ? n : $"OP_0x{op:X2}";

        public static bool IsTerminal(byte op) =>
            op == Error || op == CommandComplete || op == RowsFinished
            || op == AuthOk || op == ServerReady || op == AuthChallenge
            || op == Pong;
    }

    /// <summary>
    /// 36 canonical VBP v1 type IDs (per VBP_SPEC.md §5 tables; the spec prose
    /// "27" is a typo — see §5.10).
    /// </summary>
    public static class VBPTypeIds
    {
        public const ushort Bool         = 16;
        public const ushort Int2         = 21;
        public const ushort Int4         = 23;
        public const ushort Int8         = 20;
        public const ushort Float4       = 700;
        public const ushort Float8       = 701;
        public const ushort Text         = 25;
        public const ushort Varchar      = 1043;
        public const ushort Bpchar       = 1042;
        public const ushort Name         = 19;
        public const ushort Oid          = 26;
        public const ushort Bytea        = 17;
        public const ushort Uuid         = 2950;
        public const ushort Date         = 1082;
        public const ushort Time         = 1083;
        public const ushort Timestamp    = 1114;
        public const ushort Timestamptz  = 1184;
        public const ushort Interval     = 1186;
        public const ushort Numeric      = 1700;
        public const ushort Money        = 790;
        public const ushort Json         = 114;
        public const ushort Jsonb        = 3802;
        public const ushort Array        = 2277;
        public const ushort Inet         = 869;
        public const ushort Macaddr      = 829;
        public const ushort Cidr         = 650;
        public const ushort Vector       = 5000;
        public const ushort Tsvector     = 3614;
        public const ushort Document     = 5100;
        public const ushort GraphNode    = 5300;
        public const ushort GraphEdge    = 5301;
        public const ushort TsPoint      = 5400;
        public const ushort TsSeries     = 5401;
        public const ushort GeoPoint     = 5500;
        public const ushort GeoPath      = 5501;
        public const ushort GeoPolygon   = 5502;
        public const ushort GeoMultipoint   = 5503;
        public const ushort GeoMultipolygon = 5504;

        public static readonly ushort[] AllTypeIds = new ushort[]
        {
            Bool, Int2, Int4, Int8, Float4, Float8,
            Text, Varchar, Bpchar, Name, Oid, Bytea, Uuid,
            Date, Time, Timestamp, Timestamptz, Interval,
            Numeric, Money, Json, Jsonb, Array,
            Inet, Macaddr, Cidr, Vector, Tsvector,
            Document, GraphNode, GraphEdge,
            TsPoint, TsSeries,
            GeoPoint, GeoPath, GeoPolygon, GeoMultipoint, GeoMultipolygon
        };

        private static readonly Dictionary<ushort, string> Names = new Dictionary<ushort, string>
        {
            { Bool, "BOOL" }, { Int2, "INT2" }, { Int4, "INT4" }, { Int8, "INT8" },
            { Float4, "FLOAT4" }, { Float8, "FLOAT8" },
            { Text, "TEXT" }, { Varchar, "VARCHAR" }, { Bpchar, "BPCHAR" },
            { Name, "NAME" }, { Oid, "OID" }, { Bytea, "BYTEA" }, { Uuid, "UUID" },
            { Date, "DATE" }, { Time, "TIME" }, { Timestamp, "TIMESTAMP" },
            { Timestamptz, "TIMESTAMPTZ" }, { Interval, "INTERVAL" },
            { Numeric, "NUMERIC" }, { Money, "MONEY" }, { Json, "JSON" }, { Jsonb, "JSONB" },
            { Array, "ARRAY" },
            { Inet, "INET" }, { Macaddr, "MACADDR" }, { Cidr, "CIDR" },
            { Vector, "VECTOR" }, { Tsvector, "TSVECTOR" },
            { Document, "DOCUMENT" }, { GraphNode, "GRAPH_NODE" }, { GraphEdge, "GRAPH_EDGE" },
            { TsPoint, "TS_POINT" }, { TsSeries, "TS_SERIES" },
            { GeoPoint, "GEO_POINT" }, { GeoPath, "GEO_PATH" },
            { GeoPolygon, "GEO_POLYGON" }, { GeoMultipoint, "GEO_MULTIPOINT" },
            { GeoMultipolygon, "GEO_MULTIPOLYGON" }
        };

        public static string TypeName(ushort typeId) =>
            Names.TryGetValue(typeId, out var n) ? n : $"TYPE_0x{typeId:X4}";

        public static bool IsKnown(ushort typeId) => Names.ContainsKey(typeId);
    }
}
