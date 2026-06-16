// VedaDB .NET SDK — VBP wire layer tests
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
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
    }
}
