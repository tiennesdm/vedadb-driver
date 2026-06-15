// VedaDB .NET SDK — VBP wire layer tests
using System;
using System.Collections.Generic;
using System.Text;
using Xunit;
using VedaDB.Wire.Vbp;

namespace VedaDB.Tests.Wire.Vbp
{
    public class VBPTypeCodecTests
    {
        [Fact]
        public void EncodeBool_True()
        {
            var b = VBPTypeCodec.EncodeBool(true);
            Assert.Single(b);
            Assert.Equal(1, b[0]);
        }

        [Fact]
        public void EncodeBool_False()
        {
            var b = VBPTypeCodec.EncodeBool(false);
            Assert.Single(b);
            Assert.Equal(0, b[0]);
        }

        [Fact]
        public void EncodeInt2_LittleEndian()
        {
            var b = VBPTypeCodec.EncodeInt2((short)0x0102);
            Assert.Equal(2, b.Length);
            Assert.Equal(0x02, b[0]);
            Assert.Equal(0x01, b[1]);
        }

        [Fact]
        public void EncodeInt4_LittleEndian()
        {
            var b = VBPTypeCodec.EncodeInt4(0x01020304);
            Assert.Equal(new byte[] { 0x04, 0x03, 0x02, 0x01 }, b);
        }

        [Fact]
        public void EncodeInt8_LittleEndian()
        {
            long v = 0x0102030405060708L;
            var b = VBPTypeCodec.EncodeInt8(v);
            Assert.Equal(new byte[] { 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01 }, b);
        }

        [Fact]
        public void DecodeBool_True()
        {
            Assert.True(VBPTypeCodec.DecodeBool(new byte[] { 1 }));
            Assert.False(VBPTypeCodec.DecodeBool(new byte[] { 0 }));
        }

        [Fact]
        public void DecodeInt4_LittleEndian()
        {
            var b = VBPTypeCodec.EncodeInt4(0x12345678);
            Assert.Equal(0x12345678, VBPTypeCodec.DecodeInt4(b));
        }

        [Fact]
        public void DecodeInt8_LittleEndian()
        {
            long v = unchecked((long)0xDEADBEEFCAFEBABEUL);
            var b = VBPTypeCodec.EncodeInt8(v);
            Assert.Equal(v, VBPTypeCodec.DecodeInt8(b));
        }

        [Fact]
        public void EncodeText_Utf8_WithLengthPrefix()
        {
            var b = VBPTypeCodec.EncodeText("hi");
            Assert.Equal(6, b.Length);
            Assert.Equal(2, b[0]); // length 2 LE
            Assert.Equal((byte)'h', b[4]);
            Assert.Equal((byte)'i', b[5]);
        }

        [Fact]
        public void DecodeText_Utf8_WithLengthPrefix()
        {
            var b = VBPTypeCodec.EncodeText("hello");
            Assert.Equal("hello", VBPTypeCodec.DecodeText(b));
        }

        [Fact]
        public void EncodeDecodeUuid()
        {
            var g = Guid.NewGuid();
            var b = VBPTypeCodec.EncodeUuid(g);
            Assert.Equal(16, b.Length);
            var g2 = VBPTypeCodec.DecodeUuid(b);
            Assert.Equal(g, g2);
        }

        [Fact]
        public void InputEnvelope_NotNull_HasTypeId()
        {
            var b = VBPTypeCodec.InputEnvelope(VBPTypeIds.Int4, VBPTypeCodec.EncodeInt4(42));
            Assert.Equal(0, b[0]); // NULL_TAG_NOT_NULL
            Assert.Equal(23, b[1]); // INT4 type_id = 23 (LE)
            Assert.Equal(0, b[2]);
            // b[3..6] is u32 length (LE) = 4
            Assert.Equal(4, b[3]);
            // b[7..10] is the actual 4-byte int32 value (42 LE)
            Assert.Equal(42, b[7]);
        }

        [Fact]
        public void InputEnvelope_Null_Shorter()
        {
            var b = VBPTypeCodec.InputEnvelopeNull(VBPTypeIds.Int4);
            Assert.Equal(3, b.Length);
            Assert.Equal(1, b[0]); // NULL_TAG_NULL
            Assert.Equal(23, b[1]);
            Assert.Equal(0, b[2]);
        }

        [Fact]
        public void OutputEnvelopeRow_OneColumn()
        {
            var b = VBPTypeCodec.OutputEnvelopeRow(
                new ushort[] { VBPTypeIds.Int4 },
                new byte[][] { VBPTypeCodec.EncodeInt4(7) },
                0);
            // u32 n_cols=1, u32 null_bmp_bytes=1, u16 col_type=23, u8 bmp=0, u32 value=7
            Assert.Equal(15, b.Length);
            Assert.Equal(1, b[0]);
            Assert.Equal(1, b[4]);
            Assert.Equal(23, b[8]);
            Assert.Equal(0, b[10]);
            Assert.Equal(7, b[11]);
        }

        [Fact]
        public void SelectOneRow_Works()
        {
            var b = VBPTypeCodec.SelectOneRow();
            Assert.NotEmpty(b);
        }

        [Fact]
        public void RowsFinished_HasCorrectShape()
        {
            var b = VBPTypeCodec.RowsFinished(1, 2, new ushort[] { VBPTypeIds.Int4, VBPTypeIds.Text });
            Assert.Equal(12, b.Length); // 4 + 4 + 2*2
        }

        [Fact]
        public void CommandComplete_HasTagAndRows()
        {
            var b = VBPTypeCodec.CommandComplete("SELECT 1", 0);
            // 4 + len("SELECT 1") + 8 = 4 + 8 + 8 = 20
            Assert.Equal(20, b.Length);
            Assert.Equal(8, b[0]); // tag length LE
        }

        [Fact]
        public void ErrorBody_ParseErrorBody_RoundTrips()
        {
            var body = VBPTypeCodec.ErrorBody("28000", "auth failed", "detail", "hint");
            var p = VBPTypeCodec.ParseErrorBody(body);
            Assert.Equal("28000", p.SqlState);
            Assert.Equal("auth failed", p.Message);
            Assert.Equal("detail", p.Detail);
            Assert.Equal("hint", p.Hint);
        }

        [Fact]
        public void ErrorBody_Short_StillParses()
        {
            var p = VBPTypeCodec.ParseErrorBody(new byte[] { 0x30, 0x41, 0x30, 0x30, 0x30 });
            Assert.Equal("0A000", p.SqlState);
        }

        [Fact]
        public void ClientHelloBody_Shape()
        {
            var b = VBPTypeCodec.ClientHelloBody(1, 0, "admin", "main", (byte)0, "admin");
            // u16 version=1, u16 flags=0, u32 u_len=5 + "admin", u32 d_len=4 + "main", u8 actor=0, u32 a_len=5 + "admin"
            Assert.Equal(2 + 2 + 4 + 5 + 4 + 4 + 1 + 4 + 5, b.Length);
        }

        [Fact]
        public void ParseServerReady_AuthRequired_False()
        {
            var body = new byte[13];
            BitConverter.GetBytes(0x01020304).CopyTo(body, 0); // version
            BitConverter.GetBytes(0x00000010).CopyTo(body, 4); // caps
            body[8] = 0; // auth_required false
            BitConverter.GetBytes(0).CopyTo(body, 9); // nonce len 0
            var p = VBPTypeCodec.ParseServerReady(body);
            Assert.Equal(0x01020304, p.ServerVersion);
            Assert.Equal(0x10, p.ServerCaps);
            Assert.False(p.AuthRequired);
            Assert.Empty(p.Nonce);
        }

        [Fact]
        public void ParseAuthOk_AllFields()
        {
            var body = new byte[20];
            BitConverter.GetBytes(0xDEADBEEFL).CopyTo(body, 0);
            BitConverter.GetBytes(0xCAFEBABEL).CopyTo(body, 8);
            BitConverter.GetBytes(0x00000042).CopyTo(body, 16);
            var p = VBPTypeCodec.ParseAuthOk(body);
            Assert.Equal(0xDEADBEEFL, p.SessionTokenLo);
            Assert.Equal(0xCAFEBABEL, p.SessionTokenHi);
            Assert.Equal(0x42, p.ServerFlags);
        }

        [Fact]
        public void QueryBody_RoundTrips()
        {
            var b = VBPTypeCodec.QueryBody(42, "SELECT 1", null);
            var p = VBPTypeCodec.ParseQuery(b);
            Assert.Equal(42, p.QueryId);
            Assert.Equal("SELECT 1", p.Sql);
            Assert.Equal(0, p.NParams);
        }

        [Fact]
        public void QueryBody_WithParams()
        {
            var envs = new List<byte[]> { VBPTypeCodec.InputEnvelope(VBPTypeIds.Int4, VBPTypeCodec.EncodeInt4(7)) };
            var b = VBPTypeCodec.QueryBody(1, "SELECT ?", envs);
            var p = VBPTypeCodec.ParseQuery(b);
            Assert.Equal(1, p.NParams);
        }

        [Fact]
        public void ParseDataChunk_Int4Column()
        {
            var row = VBPTypeCodec.OutputEnvelopeRow(
                new ushort[] { VBPTypeIds.Int4 },
                new byte[][] { VBPTypeCodec.EncodeInt4(7) },
                0);
            var dc = VBPTypeCodec.ParseDataChunk(row);
            Assert.Equal(1, dc.NColumns);
            Assert.Single(dc.RowValues);
            Assert.Equal(7, dc.RowValues[0]);
        }

        [Fact]
        public void ParseDataChunk_NullColumn()
        {
            var row = VBPTypeCodec.OutputEnvelopeRow(
                new ushort[] { VBPTypeIds.Int4 },
                new byte[][] { null },
                0x01); // bit 0 = null
            var dc = VBPTypeCodec.ParseDataChunk(row);
            Assert.Single(dc.RowValues);
            Assert.Null(dc.RowValues[0]);
        }

        [Fact]
        public void ParseDataChunk_Empty()
        {
            var dc = VBPTypeCodec.ParseDataChunk(new byte[0]);
            Assert.Equal(0, dc.NColumns);
        }

        [Fact]
        public void LengthPrefixed_Zero()
        {
            var b = VBPTypeCodec.LengthPrefixed(Array.Empty<byte>());
            Assert.Equal(4, b.Length);
            Assert.Equal(0, b[0]);
        }
    }
}
