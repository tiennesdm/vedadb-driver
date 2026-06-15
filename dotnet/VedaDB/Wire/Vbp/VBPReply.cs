// VedaDB .NET SDK — VBP wire layer
//
// VBPReply: the result of VBPMultiplexer.Call. Wraps the terminal frame
// (Op, Body, Flags, Seq) plus the full list of frames received for this
// in-flight request, in order. For a single-frame reply (CLIENT_HELLO →
// SERVER_READY, PING → PONG, AUTH_RESPONSE → AUTH_OK, ROWS_FINISHED-only
// SELECT, etc.) Frames.Count == 1 and Terminal == Frames[0]. For a
// multi-frame streaming reply (DATA_CHUNK × N + ROWS_FINISHED +
// COMMAND_COMPLETE) Frames contains all frames in receive order and
// Terminal is the last (the COMMAND_COMPLETE / ROWS_FINISHED).
//
// V2 STREAMING FIX: this wrapper exists so the multiplexer can deliver
// ALL frames (not just the first terminal) for queries that emit
// DATA_CHUNKs. The Op/Body/Seq/Flags properties are pass-through to the
// terminal frame for backward compatibility with call sites that only
// needed the single-frame shape.

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace VedaDB.Wire.Vbp
{
    public sealed class VBPReply
    {
        private readonly ReadOnlyCollection<VBPFrame> _frames;

        public VBPReply(IList<VBPFrame> frames)
        {
            if (frames == null) throw new ArgumentNullException(nameof(frames));
            if (frames.Count == 0) throw new ArgumentException("frames must be non-empty", nameof(frames));
            _frames = new ReadOnlyCollection<VBPFrame>(frames);
        }

        /// <summary>The terminal frame (the one whose dispatch released the
        /// inflight slot). For single-frame replies this is the only frame.</summary>
        public VBPFrame Terminal => _frames[_frames.Count - 1];

        /// <summary>Every frame received for this in-flight request, in order.
        /// For streaming queries this includes N × DATA_CHUNK + ROWS_FINISHED
        /// + COMMAND_COMPLETE. For non-streaming replies (HELLO, PING, AUTH)
        /// Count == 1.</summary>
        public ReadOnlyCollection<VBPFrame> Frames => _frames;

        // ---- Pass-through properties (proxy to Terminal) ----
        // These preserve the pre-v2 single-frame call shape:
        //   var reply = mux.Call(op, body);
        //   if (reply.Op == VBPOpcodes.ServerReady) { ... use reply.Body ... }
        public byte Seq => Terminal.Seq;
        public byte Op => Terminal.Op;
        public byte Flags => Terminal.Flags;
        public byte[] Body => Terminal.Body;
    }
}
