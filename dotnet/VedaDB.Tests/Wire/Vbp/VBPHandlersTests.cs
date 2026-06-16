// VedaDB .NET SDK — VBP wire layer tests
using System;
using Xunit;
using VedaDB.Wire.Vbp;

namespace VedaDB.Tests.Wire.Vbp
{
    public class VBPHandlersTests
    {
        [Fact]
        public void RegisteredCount_AtLeast_23()
        {
            Assert.True(VBPHandlers.RegisteredCount >= 23,
                $"expected >= 23 registered handlers, got {VBPHandlers.RegisteredCount}");
        }

        [Fact]
        public void AssertAllMandatoryRegistered_DoesNotThrow()
        {
            VBPHandlers.AssertAllMandatoryRegistered();
        }

        [Fact]
        public void Dispatch_Ping_Returns_Pong()
        {
            var req = new VBPFrame(0, VBPOpcodes.Ping, 0, new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 });
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.Pong, resp.Op);
        }

        [Fact]
        public void Dispatch_AuthResponse_Returns_AuthOk()
        {
            var req = new VBPFrame(0, VBPOpcodes.AuthResponse, 0, new byte[] { 0x00, (byte)'u', 0x00, (byte)'p' });
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.AuthOk, resp.Op);
        }

        [Fact]
        public void Dispatch_Query_Returns_CommandComplete()
        {
            var req = new VBPFrame(0, VBPOpcodes.Query, 0, VBPTypeCodec.QueryBody(1, "SELECT 1", null));
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.CommandComplete, resp.Op);
        }

        [Fact]
        public void Dispatch_Begin_Returns_CommandComplete()
        {
            var req = new VBPFrame(0, VBPOpcodes.Begin, 0, Array.Empty<byte>());
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.CommandComplete, resp.Op);
        }

        [Fact]
        public void Dispatch_Commit_Returns_CommandComplete()
        {
            var req = new VBPFrame(0, VBPOpcodes.Commit, 0, Array.Empty<byte>());
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.CommandComplete, resp.Op);
        }

        [Fact]
        public void Dispatch_Rollback_Returns_CommandComplete()
        {
            var req = new VBPFrame(0, VBPOpcodes.Rollback, 0, Array.Empty<byte>());
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.CommandComplete, resp.Op);
        }

        [Fact]
        public void Dispatch_CancelQuery_Returns_CommandComplete()
        {
            var req = new VBPFrame(0, VBPOpcodes.CancelQuery, 0, Array.Empty<byte>());
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.CommandComplete, resp.Op);
        }

        [Fact]
        public void Dispatch_CopyIn_Returns_Error()
        {
            var req = new VBPFrame(0, VBPOpcodes.CopyIn, 0, Array.Empty<byte>());
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.Error, resp.Op);
        }

        [Fact]
        public void Dispatch_Parse_Returns_CommandComplete()
        {
            var req = new VBPFrame(0, VBPOpcodes.Parse, 0, Array.Empty<byte>());
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.CommandComplete, resp.Op);
        }

        [Fact]
        public void Dispatch_Bind_Returns_CommandComplete()
        {
            var req = new VBPFrame(0, VBPOpcodes.Bind, 0, Array.Empty<byte>());
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.CommandComplete, resp.Op);
        }

        [Fact]
        public void Dispatch_Close_Returns_CommandComplete()
        {
            var req = new VBPFrame(0, VBPOpcodes.Close, 0, Array.Empty<byte>());
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.CommandComplete, resp.Op);
        }

        [Fact]
        public void Dispatch_ClientHello_Returns_Error_Stub()
        {
            var req = new VBPFrame(0, VBPOpcodes.ClientHello, 0, Array.Empty<byte>());
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.Error, resp.Op);
        }

        [Fact]
        public void Dispatch_ServerReadOnly_Returns_Error_Stub()
        {
            // SERVER_READY is server-to-client only — handler returns a stub error.
            var req = new VBPFrame(0, VBPOpcodes.ServerReady, 0, Array.Empty<byte>());
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(VBPOpcodes.Error, resp.Op);
        }

        [Fact]
        public void Dispatch_PreservesSeq()
        {
            var req = new VBPFrame(0xAB, VBPOpcodes.Ping, 0, new byte[8]);
            var resp = VBPHandlers.Dispatch(req);
            Assert.Equal(0xAB, resp.Seq);
        }
    }
}
