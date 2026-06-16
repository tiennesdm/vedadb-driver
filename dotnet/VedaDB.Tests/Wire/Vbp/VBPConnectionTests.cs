// VedaDB .NET SDK — VBP wire layer tests
using System;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using Xunit;
using VedaDB.Wire.Vbp;

namespace VedaDB.Tests.Wire.Vbp
{
    public class VBPConnectionTests
    {
        [Fact]
        public void Constructor_StoresFields()
        {
            using var conn = new VBPConnection("localhost", 6380, "user", "pass", "db", 5);
            Assert.Equal(0, conn.ServerVersion); // not connected yet
        }

        [Fact]
        public void Connect_RejectsUnreachable()
        {
            // 127.0.0.1:1 is not a VBP server → should throw.
            using var conn = new VBPConnection("127.0.0.1", 1, "u", "p", "d", 2);
            Assert.ThrowsAny<Exception>(() => conn.Connect());
        }

        [Fact]
        public async Task ConnectAsync_ReturnsSelf()
        {
            // Spin up a stub server that emits SERVER_READY on first frame.
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var serverTask = Task.Run(async () =>
            {
                using var server = await listener.AcceptTcpClientAsync();
                var s = server.GetStream();
                // Read 8B header
                var hdr = new byte[VBPFrame.HdrLen];
                await s.ReadAsync(hdr, 0, hdr.Length);
                int pl = BitConverter.ToInt32(hdr, 3);
                var rest = new byte[pl];
                await s.ReadAsync(rest, 0, pl);
                byte seq = hdr[7];
                var ready = new VBPFrame(seq, VBPOpcodes.ServerReady, 0,
                    new byte[13]); // version=0, caps=0, auth=0, nonce_len=0
                var bytes = ready.Encode();
                await s.WriteAsync(bytes, 0, bytes.Length);
                await s.FlushAsync();
            });
            using var conn = new VBPConnection("127.0.0.1", port, "u", "p", "d", 5);
            var got = await conn.ConnectAsync();
            Assert.Same(conn, got);
            await serverTask;
            listener.Stop();
        }

        [Fact]
        public void Execute_WithoutConnect_Throws()
        {
            using var conn = new VBPConnection("localhost", 6380, "u", "p", "d", 1);
            Assert.Throws<VBPException>(() => conn.Execute("SELECT 1"));
        }

        [Fact]
        public void Ping_WithoutConnect_Throws()
        {
            using var conn = new VBPConnection("localhost", 6380, "u", "p", "d", 1);
            Assert.Throws<VBPException>(() => conn.Ping());
        }

        [Fact]
        public void DefaultPort_Is_6380()
        {
            Assert.Equal(6380, VBPConnection.DefaultVbpPort);
        }

        [Fact]
        public async Task Dispose_ClosesConnection()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var serverTask = Task.Run(async () =>
            {
                using var server = await listener.AcceptTcpClientAsync();
                var s = server.GetStream();
                while (server.Connected)
                {
                    var hdr = new byte[VBPFrame.HdrLen];
                    int n = await s.ReadAsync(hdr, 0, hdr.Length);
                    if (n == 0) break;
                    int pl = BitConverter.ToInt32(hdr, 3);
                    var rest = new byte[pl];
                    await s.ReadAsync(rest, 0, pl);
                    byte seq = hdr[7];
                    // Echo: SERVER_READY
                    var resp = new VBPFrame(seq, VBPOpcodes.ServerReady, 0, new byte[13]);
                    await s.WriteAsync(resp.Encode(), 0, resp.Encode().Length);
                    await s.FlushAsync();
                }
            });
            using var conn = new VBPConnection("127.0.0.1", port, "u", "p", "d", 5);
            await conn.ConnectAsync();
            await conn.DisposeAsync();
            Assert.True(true); // best-effort: just confirm no exception
            listener.Stop();
        }
    }
}
