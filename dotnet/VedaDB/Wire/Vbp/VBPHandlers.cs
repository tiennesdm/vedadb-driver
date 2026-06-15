// VedaDB .NET SDK — VBP wire layer
//
// Handler stub registry for all 23 mandatory opcodes. The v1 driver is a
// *transport* demonstrator — most handlers are stubs that return
// "feature not supported" ERROR frames. CLIENT_HELLO → SERVER_READY-style
// stub, AUTH_RESPONSE → AUTH_OK stub, QUERY → COMMAND_COMPLETE stub,
// PING → PONG, CLOSE → close.

using System;
using System.Collections.Generic;

namespace VedaDB.Wire.Vbp
{
    public static class VBPHandlers
    {
        /// <summary>Handler signature: (mux, body, seq) → response frame.</summary>
        public delegate VBPFrame HandlerFn(VBPMultiplexer? mux, byte[] body, byte seq);

        public static readonly IReadOnlyDictionary<byte, HandlerFn> Handlers =
            new Dictionary<byte, HandlerFn>
            {
                { VBPOpcodes.ClientHello,     HandleClientHello },
                { VBPOpcodes.ServerReady,     HandleServerOnly   },
                { VBPOpcodes.AuthChallenge,   HandleServerOnly   },
                { VBPOpcodes.AuthResponse,    HandleAuthResponse },
                { VBPOpcodes.AuthOk,          HandleServerOnly   },

                { VBPOpcodes.Query,           HandleQuery        },
                { VBPOpcodes.ExtQuery,        HandleExtQuery     },
                { VBPOpcodes.Parse,           HandleParse        },
                { VBPOpcodes.Bind,            HandleBind         },
                { VBPOpcodes.DataChunk,       HandleServerOnly   },
                { VBPOpcodes.RowsFinished,    HandleServerOnly   },
                { VBPOpcodes.CommandComplete, HandleServerOnly   },
                { VBPOpcodes.Error,           HandleServerOnly   },

                { VBPOpcodes.Begin,           HandleCommandComplete },
                { VBPOpcodes.Commit,          HandleCommandComplete },
                { VBPOpcodes.Rollback,        HandleCommandComplete },

                { VBPOpcodes.CopyIn,          HandleStub },
                { VBPOpcodes.CopyDone,        HandleStub },
                { VBPOpcodes.CopyFail,        HandleStub },
                { VBPOpcodes.CancelQuery,     HandleCommandComplete },
                { VBPOpcodes.Ping,            HandlePing },
                { VBPOpcodes.Pong,            HandleServerOnly   },
                { VBPOpcodes.Close,           HandleClose },
            };

        public static int RegisteredCount => Handlers.Count;

        public static void AssertAllMandatoryRegistered()
        {
            foreach (byte op in VBPOpcodes.MandatoryOpcodes)
            {
                if (!Handlers.ContainsKey(op))
                    throw new InvalidOperationException(
                        $"missing handler for opcode {VBPOpcodes.OpcodeName(op)}");
            }
        }

        public static VBPFrame Dispatch(VBPFrame request)
        {
            if (!Handlers.TryGetValue(request.Op, out var h))
                return StubError(request.Seq, request.Op);
            return h(null, request.Body, request.Seq);
        }

        // ============================================================
        // Real handlers
        // ============================================================

        private static VBPFrame HandleClientHello(VBPMultiplexer? mux, byte[] body, byte seq) =>
            StubError(seq, VBPOpcodes.ClientHello);

        private static VBPFrame HandleServerOnly(VBPMultiplexer? mux, byte[] body, byte seq) =>
            StubError(seq, -1);

        private static VBPFrame HandleAuthResponse(VBPMultiplexer? mux, byte[] body, byte seq) =>
            new VBPFrame(seq, VBPOpcodes.AuthOk, 0, VBPTypeCodec.CommandComplete("AUTH_OK", 0));

        private static VBPFrame HandleQuery(VBPMultiplexer? mux, byte[] body, byte seq) =>
            new VBPFrame(seq, VBPOpcodes.CommandComplete, 0, VBPTypeCodec.CommandComplete("SELECT 1", 0));

        private static VBPFrame HandleExtQuery(VBPMultiplexer? mux, byte[] body, byte seq) =>
            StubError(seq, VBPOpcodes.ExtQuery);

        private static VBPFrame HandleParse(VBPMultiplexer? mux, byte[] body, byte seq) =>
            new VBPFrame(seq, VBPOpcodes.CommandComplete, 0, VBPTypeCodec.CommandComplete("PARSE", 0));

        private static VBPFrame HandleBind(VBPMultiplexer? mux, byte[] body, byte seq) =>
            new VBPFrame(seq, VBPOpcodes.CommandComplete, 0, VBPTypeCodec.CommandComplete("BIND", 0));

        private static VBPFrame HandleCommandComplete(VBPMultiplexer? mux, byte[] body, byte seq) =>
            new VBPFrame(seq, VBPOpcodes.CommandComplete, 0, VBPTypeCodec.CommandComplete("OK", 0));

        private static VBPFrame HandlePing(VBPMultiplexer? mux, byte[] body, byte seq) =>
            new VBPFrame(seq, VBPOpcodes.Pong, 0, Array.Empty<byte>());

        private static VBPFrame HandleClose(VBPMultiplexer? mux, byte[] body, byte seq)
        {
            mux?.Close();
            return new VBPFrame(seq, VBPOpcodes.CommandComplete, 0, VBPTypeCodec.CommandComplete("CLOSE", 0));
        }

        private static VBPFrame HandleStub(VBPMultiplexer? mux, byte[] body, byte seq) =>
            StubError(seq, -1);

        private static VBPFrame StubError(byte seq, int op)
        {
            string msg = op < 0
                ? "vbp v1 driver: opcode is server-to-client only"
                : $"vbp v1 driver: opcode {VBPOpcodes.OpcodeName((byte)op)} not implemented (v2)";
            return new VBPFrame(seq, VBPOpcodes.Error, 0,
                VBPTypeCodec.ErrorBody(VBPOpcodes.SqlStateFeatureNotSupported, msg, "", ""));
        }
    }
}
