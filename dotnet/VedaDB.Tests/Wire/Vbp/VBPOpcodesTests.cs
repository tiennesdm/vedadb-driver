// VedaDB .NET SDK — VBP wire layer tests
using System;
using Xunit;
using VedaDB.Wire.Vbp;

namespace VedaDB.Tests.Wire.Vbp
{
    public class VBPOpcodesTests
    {
        [Fact]
        public void MandatoryOpcodes_Are_23()
        {
            Assert.Equal(23, VBPOpcodes.MandatoryOpcodes.Length);
        }

        [Fact]
        public void AllTypeIds_Are_38()
        {
            // The spec prose says "27" but the tables list more (§5.10 typo).
            // Java POC has 38 (5 GEO_* at the end). We match.
            Assert.Equal(38, VBPTypeIds.AllTypeIds.Length);
        }

        [Fact]
        public void ClientHello_Is_0x01()
        {
            Assert.Equal((byte)0x01, VBPOpcodes.ClientHello);
        }

        [Fact]
        public void ServerReady_Is_0x02()
        {
            Assert.Equal((byte)0x02, VBPOpcodes.ServerReady);
        }

        [Fact]
        public void Ping_Is_0x16()
        {
            Assert.Equal((byte)0x16, VBPOpcodes.Ping);
        }

        [Fact]
        public void Pong_Is_0x17()
        {
            Assert.Equal((byte)0x17, VBPOpcodes.Pong);
        }

        [Fact]
        public void Close_Is_0x18()
        {
            Assert.Equal((byte)0x18, VBPOpcodes.Close);
        }

        [Fact]
        public void StreamChunk_Is_0x19()
        {
            Assert.Equal((byte)0x19, VBPOpcodes.StreamChunk);
        }

        [Fact]
        public void OpcodeName_KnownOpcodes()
        {
            Assert.Equal("CLIENT_HELLO", VBPOpcodes.OpcodeName(VBPOpcodes.ClientHello));
            Assert.Equal("SERVER_READY", VBPOpcodes.OpcodeName(VBPOpcodes.ServerReady));
            Assert.Equal("AUTH_OK", VBPOpcodes.OpcodeName(VBPOpcodes.AuthOk));
            Assert.Equal("QUERY", VBPOpcodes.OpcodeName(VBPOpcodes.Query));
            Assert.Equal("DATA_CHUNK", VBPOpcodes.OpcodeName(VBPOpcodes.DataChunk));
            Assert.Equal("COMMAND_COMPLETE", VBPOpcodes.OpcodeName(VBPOpcodes.CommandComplete));
            Assert.Equal("ERROR", VBPOpcodes.OpcodeName(VBPOpcodes.Error));
            Assert.Equal("PING", VBPOpcodes.OpcodeName(VBPOpcodes.Ping));
            Assert.Equal("PONG", VBPOpcodes.OpcodeName(VBPOpcodes.Pong));
        }

        [Fact]
        public void OpcodeName_Unknown_FormatsHex()
        {
            Assert.Equal("OP_0xFF", VBPOpcodes.OpcodeName(0xFF));
        }

        [Fact]
        public void TypeName_KnownTypes()
        {
            Assert.Equal("INT4", VBPTypeIds.TypeName(VBPTypeIds.Int4));
            Assert.Equal("TEXT", VBPTypeIds.TypeName(VBPTypeIds.Text));
            Assert.Equal("BOOL", VBPTypeIds.TypeName(VBPTypeIds.Bool));
            Assert.Equal("VECTOR", VBPTypeIds.TypeName(VBPTypeIds.Vector));
        }

        [Fact]
        public void TypeName_Unknown_FormatsHex()
        {
            Assert.Equal("TYPE_0x0000", VBPTypeIds.TypeName(0));
        }

        [Fact]
        public void IsTerminal_DetectsTerminalFrames()
        {
            Assert.True(VBPOpcodes.IsTerminal(VBPOpcodes.Error));
            Assert.True(VBPOpcodes.IsTerminal(VBPOpcodes.CommandComplete));
            Assert.True(VBPOpcodes.IsTerminal(VBPOpcodes.RowsFinished));
            Assert.True(VBPOpcodes.IsTerminal(VBPOpcodes.AuthOk));
            Assert.True(VBPOpcodes.IsTerminal(VBPOpcodes.ServerReady));
            Assert.True(VBPOpcodes.IsTerminal(VBPOpcodes.AuthChallenge));
            Assert.True(VBPOpcodes.IsTerminal(VBPOpcodes.Pong));
        }

        [Fact]
        public void IsTerminal_RejectsNonTerminal()
        {
            Assert.False(VBPOpcodes.IsTerminal(VBPOpcodes.Query));
            Assert.False(VBPOpcodes.IsTerminal(VBPOpcodes.Ping));
            Assert.False(VBPOpcodes.IsTerminal(VBPOpcodes.DataChunk));
            Assert.False(VBPOpcodes.IsTerminal(VBPOpcodes.ClientHello));
        }

        [Fact]
        public void IsKnownType_Known()
        {
            Assert.True(VBPTypeIds.IsKnown(VBPTypeIds.Int4));
            Assert.True(VBPTypeIds.IsKnown(VBPTypeIds.Text));
            Assert.True(VBPTypeIds.IsKnown(VBPTypeIds.Vector));
        }

        [Fact]
        public void IsKnownType_Unknown()
        {
            Assert.False(VBPTypeIds.IsKnown((ushort)0x9999));
        }

        [Fact]
        public void AuthMechanisms_Defined()
        {
            Assert.Equal("NONE", VBPOpcodes.AuthMechNone);
            Assert.Equal("PLAIN", VBPOpcodes.AuthMechPlain);
            Assert.Equal("SCRAM-SHA-256", VBPOpcodes.AuthMechScramSha256);
        }

        [Fact]
        public void SqlStateConstants_Defined()
        {
            Assert.Equal("0A000", VBPOpcodes.SqlStateFeatureNotSupported);
            Assert.Equal("42601", VBPOpcodes.SqlStateSyntaxError);
            Assert.Equal("28000", VBPOpcodes.SqlStateAuthFailed);
            Assert.Equal("08006", VBPOpcodes.SqlStateConnectionFailure);
        }
    }
}
