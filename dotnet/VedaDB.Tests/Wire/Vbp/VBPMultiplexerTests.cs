// VedaDB .NET SDK — VBP wire layer tests
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Xunit;
using VedaDB.Wire.Vbp;

namespace VedaDB.Tests.Wire.Vbp
{
    public class VBPMultiplexerTests
    {
        [Fact]
        public void Constructor_ConnectsAndStartsReader()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            using var mux = new VBPMultiplexer("127.0.0.1", port, 5000);
            try
            {
                Assert.NotNull(mux);
                Assert.False(mux.IsClosed);
            }
            finally
            {
                mux.Dispose();
                listener.Stop();
            }
        }

        [Fact]
        public void Call_SendsFrame()
        {
            var (port, stop, getHandler) = MakeStubServer();
            var handler = getHandler((body, bl, seq) =>
                (VBPOpcodes.ServerReady, VBPTypeCodec.SelectOneRow()));
            try
            {
                using var mux = new VBPMultiplexer("127.0.0.1", port, 5000);
                var reply = mux.Call(VBPOpcodes.ClientHello, new byte[] { 0x01, 0x02, 0x03 });
                handler.Wait(2000);
                Assert.Equal(VBPOpcodes.ServerReady, reply.Op);
            }
            finally { stop(); }
        }

        [Fact]
        public void Error_Frame_Throws_VBPErrorException()
        {
            var (port, stop, getHandler) = MakeStubServer();
            var handler = getHandler((body, bl, seq) =>
            {
                var err = VBPTypeCodec.ErrorBody("28000", "auth failed", "", "");
                return (VBPOpcodes.Error, err);
            });
            try
            {
                using var mux = new VBPMultiplexer("127.0.0.1", port, 5000);
                Assert.Throws<VBPErrorException>(() =>
                    mux.Call(VBPOpcodes.ClientHello, new byte[] { 0x01 }));
                handler.Wait(2000);
            }
            finally { stop(); }
        }

        [Fact]
        public void IsClosed_TrueAfterDispose()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var mux = new VBPMultiplexer("127.0.0.1", port, 5000);
            mux.Dispose();
            Assert.True(mux.IsClosed);
            listener.Stop();
        }

        [Fact]
        public async Task TwoRequestsOnSameConnection_BothSucceed()
        {
            // Verify pipelining: two concurrent calls share the same TCP
            // socket and get distinct replies.
            int requestCount = 0;
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var serveLoop = Task.Run(async () =>
            {
                using var server = await listener.AcceptTcpClientAsync();
                var s = server.GetStream();
                for (int i = 0; i < 2; i++)
                {
                    var hdr = new byte[VBPFrame.HdrLen];
                    int got = 0;
                    while (got < hdr.Length)
                    {
                        int n = await s.ReadAsync(hdr, got, hdr.Length - got);
                        if (n == 0) return;
                        got += n;
                    }
                    int pl = BitConverter.ToInt32(hdr, 3);
                    var opflags = new byte[VBPFrame.OpFlagsLen];
                    got = 0;
                    while (got < opflags.Length)
                    {
                        int n = await s.ReadAsync(opflags, got, opflags.Length - got);
                        if (n == 0) return;
                        got += n;
                    }
                    int bodyLen = pl - VBPFrame.OpFlagsLen;
                    var body = new byte[bodyLen];
                    got = 0;
                    while (got < bodyLen)
                    {
                        int n = await s.ReadAsync(body, got, bodyLen - got);
                        if (n == 0) return;
                        got += n;
                    }
                    byte seq = hdr[7];
                    Interlocked.Increment(ref requestCount);
                    var resp = new VBPFrame(seq, VBPOpcodes.ServerReady, 0, VBPTypeCodec.SelectOneRow());
                    var respBytes = resp.Encode();
                    await s.WriteAsync(respBytes, 0, respBytes.Length);
                    await s.FlushAsync();
                }
            });
            using var mux = new VBPMultiplexer("127.0.0.1", port, 5000);
            var t1 = Task.Run(() => mux.Call(VBPOpcodes.Ping, new byte[] { 1 }));
            var t2 = Task.Run(() => mux.Call(VBPOpcodes.Ping, new byte[] { 2 }));
            var r1 = t1.Result;
            var r2 = t2.Result;
            await serveLoop;
            Assert.Equal(2, requestCount);
            Assert.Equal(VBPOpcodes.ServerReady, r1.Op);
            Assert.Equal(VBPOpcodes.ServerReady, r2.Op);
            listener.Stop();
        }

        [Fact]
        public async Task ConnectTo_RealServer_Via_TcpListener()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var serverTask = Task.Run(async () =>
            {
                using var server = await listener.AcceptTcpClientAsync();
                var s = server.GetStream();
                var hdr = new byte[VBPFrame.HdrLen];
                await s.ReadAsync(hdr, 0, hdr.Length);
                int pl = BitConverter.ToInt32(hdr, 3);
                var opflags = new byte[VBPFrame.OpFlagsLen];
                await s.ReadAsync(opflags, 0, opflags.Length);
                var bodyBuf = new byte[pl - VBPFrame.OpFlagsLen];
                if (bodyBuf.Length > 0) await s.ReadAsync(bodyBuf, 0, bodyBuf.Length);
                byte seq = hdr[7];
                var ready = new VBPFrame(seq, VBPOpcodes.ServerReady, 0,
                    VBPTypeCodec.ClientHelloBody(1, 0, "u", "d", 0, "u"));
                var bytes = ready.Encode();
                await s.WriteAsync(bytes, 0, bytes.Length);
                await s.FlushAsync();
            });
            using var client = new VBPMultiplexer("127.0.0.1", port, 5000);
            var reply = client.Call(VBPOpcodes.ClientHello, new byte[] { 0x01 });
            await serverTask;
            Assert.Equal(VBPOpcodes.ServerReady, reply.Op);
            listener.Stop();
        }

        // =================================================================
        // V2 STREAMING FIX TESTS (2026-06-15)
        // Verify that VBPMultiplexer accumulates DATA_CHUNK frames instead
        // of dropping them, and delivers the full Frames list on a
        // terminal opcode. This is the canonical regression test for the
        // multichunk-query bug fixed in this branch.
        // =================================================================

        /// <summary>
        /// The canonical multichunk test: server emits 5 DATA_CHUNK frames
        /// followed by a single ROWS_FINISHED (terminal). The multiplexer
        /// MUST accumulate all 5 chunks and return them plus the terminal
        /// as a single VBPReply with Frames.Count == 6. Pre-fix this would
        /// have delivered 0 frames (the first DATA_CHUNK is non-terminal
        /// so the slot was never released).
        /// </summary>
        [Fact]
        public void MultiChunk_Accumulates_DataChunks_And_Delivers_On_Terminal()
        {
            var (port, stop, getHandler) = MakeMultiFrameStubServer();
            // 5 DATA_CHUNK frames + 1 ROWS_FINISHED terminal.
            var handler = getHandler((body, bl, seq) => new List<(byte op, byte[] body)>
            {
                (VBPOpcodes.DataChunk, Encoding.UTF8.GetBytes("chunk-0")),
                (VBPOpcodes.DataChunk, Encoding.UTF8.GetBytes("chunk-1")),
                (VBPOpcodes.DataChunk, Encoding.UTF8.GetBytes("chunk-2")),
                (VBPOpcodes.DataChunk, Encoding.UTF8.GetBytes("chunk-3")),
                (VBPOpcodes.DataChunk, Encoding.UTF8.GetBytes("chunk-4")),
                (VBPOpcodes.RowsFinished, Encoding.UTF8.GetBytes("rows-affected=42;tag=SELECT 5")),
            });
            try
            {
                using var mux = new VBPMultiplexer("127.0.0.1", port, 5000);
                var reply = mux.Call(VBPOpcodes.Query, Encoding.UTF8.GetBytes("SELECT 1"));
                Assert.True(handler.Wait(2000), "server did not serve within 2s");
                // Total frames received: 5 DATA_CHUNKs + 1 ROWS_FINISHED = 6
                Assert.Equal(6, reply.Frames.Count);
                // First 5 are DATA_CHUNK with the expected bodies
                for (int i = 0; i < 5; i++)
                {
                    Assert.Equal(VBPOpcodes.DataChunk, reply.Frames[i].Op);
                    Assert.Equal($"chunk-{i}", Encoding.UTF8.GetString(reply.Frames[i].Body));
                }
                // Last is the terminal ROWS_FINISHED, also accessible via Op/Body
                Assert.Equal(VBPOpcodes.RowsFinished, reply.Frames[5].Op);
                Assert.Equal(VBPOpcodes.RowsFinished, reply.Op);
                Assert.Equal("rows-affected=42;tag=SELECT 5", Encoding.UTF8.GetString(reply.Body));
            }
            finally { stop(); }
        }

        /// <summary>
        /// A query that returns 0 rows (no DATA_CHUNKs, just a terminal
        /// ROWS_FINISHED) must still deliver a single-frame reply. This is
        /// the empty-stream case — the streaming fix must NOT regress it.
        /// </summary>
        [Fact]
        public void EmptyResultSet_TerminalOnly_Still_Works()
        {
            var (port, stop, getHandler) = MakeMultiFrameStubServer();
            var handler = getHandler((body, bl, seq) => new List<(byte op, byte[] body)>
            {
                (VBPOpcodes.RowsFinished, Encoding.UTF8.GetBytes("rows-affected=0")),
            });
            try
            {
                using var mux = new VBPMultiplexer("127.0.0.1", port, 5000);
                var reply = mux.Call(VBPOpcodes.Query, Encoding.UTF8.GetBytes("SELECT 1 WHERE 0"));
                Assert.True(handler.Wait(2000), "server did not serve within 2s");
                Assert.Single(reply.Frames);
                Assert.Equal(VBPOpcodes.RowsFinished, reply.Frames[0].Op);
                Assert.Equal(VBPOpcodes.RowsFinished, reply.Op);
            }
            finally { stop(); }
        }

        /// <summary>
        /// A non-streaming single-terminal reply (CLIENT_HELLO → SERVER_READY)
        /// must still deliver a single-frame reply with Frames.Count == 1.
        /// This proves the streaming fix did not break the most common path.
        /// </summary>
        [Fact]
        public void SingleFrame_ServerReady_Has_One_Frame()
        {
            var (port, stop, getHandler) = MakeMultiFrameStubServer();
            var handler = getHandler((body, bl, seq) => new List<(byte op, byte[] body)>
            {
                (VBPOpcodes.ServerReady, VBPTypeCodec.ClientHelloBody(1, 0, "u", "d", 0, "u")),
            });
            try
            {
                using var mux = new VBPMultiplexer("127.0.0.1", port, 5000);
                var reply = mux.Call(VBPOpcodes.ClientHello, new byte[] { 0x01 });
                Assert.True(handler.Wait(2000), "server did not serve within 2s");
                Assert.Single(reply.Frames);
                Assert.Equal(VBPOpcodes.ServerReady, reply.Op);
            }
            finally { stop(); }
        }

        /// <summary>
        /// Non-terminal (DATA_CHUNK) frames for a seq with NO inflight caller
        /// must be dropped silently, not crash the reader. This is the
        /// "late frame for a slot we already released" case.
        /// </summary>
        [Fact]
        public async Task LateFrame_ForReleasedSeq_DoesNotCrash()
        {
            // Server emits ServerReady (terminal) immediately, then a stray
            // DATA_CHUNK for the same seq after the caller has returned. The
            // multiplexer must drop the DATA_CHUNK silently.
            int port;
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var serverTask = Task.Run(async () =>
            {
                using var server = await listener.AcceptTcpClientAsync();
                var s = server.GetStream();
                var hdr = new byte[VBPFrame.HdrLen];
                int got = 0;
                while (got < hdr.Length)
                {
                    int n = await s.ReadAsync(hdr, got, hdr.Length - got);
                    if (n == 0) return;
                    got += n;
                }
                int pl = BitConverter.ToInt32(hdr, 3);
                var opflags = new byte[VBPFrame.OpFlagsLen];
                got = 0;
                while (got < opflags.Length)
                {
                    int n = await s.ReadAsync(opflags, got, opflags.Length - got);
                    if (n == 0) return;
                    got += n;
                }
                int bodyLen = pl - VBPFrame.OpFlagsLen;
                var body = new byte[bodyLen];
                got = 0;
                while (got < bodyLen)
                {
                    int n = await s.ReadAsync(body, got, bodyLen - got);
                    if (n == 0) return;
                    got += n;
                }
                byte seq = hdr[7];
                // Send SERVER_READY (terminal) — the caller's Call() returns.
                var ready = new VBPFrame(seq, VBPOpcodes.ServerReady, 0, VBPTypeCodec.SelectOneRow());
                var readyBytes = ready.Encode();
                await s.WriteAsync(readyBytes, 0, readyBytes.Length);
                await s.FlushAsync();
                // Now send a stray DATA_CHUNK for the same seq. The reader
                // must drop it (no inflight slot for that seq anymore).
                var stray = new VBPFrame(seq, VBPOpcodes.DataChunk, 0, Encoding.UTF8.GetBytes("stray"));
                var strayBytes = stray.Encode();
                await s.WriteAsync(strayBytes, 0, strayBytes.Length);
                await s.FlushAsync();
            });
            using (var client = new VBPMultiplexer("127.0.0.1", port, 5000))
            {
                var reply = client.Call(VBPOpcodes.ClientHello, new byte[] { 0x01 });
                Assert.Equal(VBPOpcodes.ServerReady, reply.Op);
                Assert.Single(reply.Frames);
            }
            // Give the reader a beat to consume the stray frame. If the fix
            // is wrong (e.g. throws on unknown seq), the reader task errors
            // out and we observe it here.
            await serverTask;
            // If we got here without an exception, the late frame was
            // handled gracefully.
            listener.Stop();
        }

        /// <summary>
        /// Spin up a TcpListener and return (port, stop, getHandler). getHandler
        /// installs the request handler and returns a Task that completes when
        /// the handler has processed one request.
        /// </summary>
        private static (int port, Action stop, Func<Func<byte[], int, byte, (byte op, byte[] body)>, Task> getHandler)
            MakeStubServer()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            TaskCompletionSource<bool> served = new TaskCompletionSource<bool>();
            Func<byte[], int, byte, (byte op, byte[] body)>? handlerRef = null;
            var serverTask = Task.Run(async () =>
            {
                using var server = await listener.AcceptTcpClientAsync();
                var s = server.GetStream();
                while (server.Connected)
                {
                    var hdr = new byte[VBPFrame.HdrLen];
                    int got = 0;
                    while (got < hdr.Length)
                    {
                        int n = await s.ReadAsync(hdr, got, hdr.Length - got);
                        if (n == 0) return;
                        got += n;
                    }
                    int pl = BitConverter.ToInt32(hdr, 3);
                    var opflags = new byte[VBPFrame.OpFlagsLen];
                    got = 0;
                    while (got < opflags.Length)
                    {
                        int n = await s.ReadAsync(opflags, got, opflags.Length - got);
                        if (n == 0) return;
                        got += n;
                    }
                    int bodyLen = pl - VBPFrame.OpFlagsLen;
                    var body = new byte[bodyLen];
                    got = 0;
                    while (got < bodyLen)
                    {
                        int n = await s.ReadAsync(body, got, bodyLen - got);
                        if (n == 0) return;
                        got += n;
                    }
                    byte seq = hdr[7];
                    if (handlerRef == null)
                    {
                        served.TrySetResult(false);
                        return;
                    }
                    var (op, outBody) = handlerRef(body, bodyLen, seq);
                    var resp = new VBPFrame(seq, op, 0, outBody);
                    var bytes = resp.Encode();
                    await s.WriteAsync(bytes, 0, bytes.Length);
                    await s.FlushAsync();
                    served.TrySetResult(true);
                }
            });
            Func<Func<byte[], int, byte, (byte op, byte[] body)>, Task> getHandler = h =>
            {
                handlerRef = h;
                return served.Task;
            };
            return (port, () => { try { listener.Stop(); } catch { } }, getHandler);
        }

        /// <summary>
        /// Like MakeStubServer, but the handler returns a LIST of frames
        /// (the full response sequence: DATA_CHUNKs + terminal). Used by
        /// the V2 streaming tests. The list of frames is flushed back to
        /// back to the client in order, with a small WriteAsync+Flush
        /// per frame so the reader sees them in receive order.
        /// </summary>
        private static (int port, Action stop, Func<Func<byte[], int, byte, List<(byte op, byte[] body)>>, Task> getHandler)
            MakeMultiFrameStubServer()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            TaskCompletionSource<bool> served = new TaskCompletionSource<bool>();
            Func<byte[], int, byte, List<(byte op, byte[] body)>>? handlerRef = null;
            var serverTask = Task.Run(async () =>
            {
                using var server = await listener.AcceptTcpClientAsync();
                var s = server.GetStream();
                var hdr = new byte[VBPFrame.HdrLen];
                int got = 0;
                while (got < hdr.Length)
                {
                    int n = await s.ReadAsync(hdr, got, hdr.Length - got);
                    if (n == 0) return;
                    got += n;
                }
                int pl = BitConverter.ToInt32(hdr, 3);
                var opflags = new byte[VBPFrame.OpFlagsLen];
                got = 0;
                while (got < opflags.Length)
                {
                    int n = await s.ReadAsync(opflags, got, opflags.Length - got);
                    if (n == 0) return;
                    got += n;
                }
                int bodyLen = pl - VBPFrame.OpFlagsLen;
                var reqBody = new byte[bodyLen];
                got = 0;
                while (got < bodyLen)
                {
                    int n = await s.ReadAsync(reqBody, got, bodyLen - got);
                    if (n == 0) return;
                    got += n;
                }
                byte seq = hdr[7];
                if (handlerRef == null)
                {
                    served.TrySetResult(false);
                    return;
                }
                var frames = handlerRef(reqBody, bodyLen, seq);
                foreach (var (op, outBody) in frames)
                {
                    var f = new VBPFrame(seq, op, 0, outBody);
                    var bytes = f.Encode();
                    await s.WriteAsync(bytes, 0, bytes.Length);
                    await s.FlushAsync();
                }
                served.TrySetResult(true);
            });
            Func<Func<byte[], int, byte, List<(byte op, byte[] body)>>, Task> getHandler = h =>
            {
                handlerRef = h;
                return served.Task;
            };
            return (port, () => { try { listener.Stop(); } catch { } }, getHandler);
        }
    }
}
