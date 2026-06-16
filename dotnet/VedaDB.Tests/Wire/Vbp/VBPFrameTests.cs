// VedaDB .NET SDK — VBP wire layer tests
using System;
using System.Buffers.Binary;
using System.Linq;
using Xunit;
using VedaDB.Wire.Vbp;

namespace VedaDB.Tests.Wire.Vbp
{
    public class VBPFrameTests
    {
        [Fact]
        public void Encode_ProducesCorrectMagic()
        {
            var frame = new VBPFrame(0x07, VBPOpcodes.ClientHello, 0x00, new byte[] { 1, 2, 3, 4 });
            var bytes = frame.Encode();
            Assert.Equal(0x56, bytes[0]); // 'V'
            Assert.Equal(0x44, bytes[1]); // 'D'
            Assert.Equal(0x42, bytes[2]); // 'B'
        }

        [Fact]
        public void Encode_ProducesLittleEndianLength()
        {
            // body length 5 → payload_length = 2 + 5 = 7
            var frame = new VBPFrame(0, VBPOpcodes.Ping, 0, new byte[] { 1, 2, 3, 4, 5 });
            var bytes = frame.Encode();
            int pl = BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(3, 4));
            Assert.Equal(7, pl);
        }

        [Fact]
        public void EncodeDecode_RoundTrips()
        {
            var body = new byte[] { 0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02 };
            var orig = new VBPFrame(0x42, VBPOpcodes.Query, 0x10, body);
            var bytes = orig.Encode();
            var decoded = VBPFrame.Decode(bytes, 0);
            Assert.Equal(orig.Seq, decoded.Seq);
            Assert.Equal(orig.Op, decoded.Op);
            Assert.Equal(orig.Flags, decoded.Flags);
            Assert.Equal(body, decoded.Body);
        }

        [Fact]
        public void EncodeDecode_EmptyBody()
        {
            var orig = new VBPFrame(0xFF, VBPOpcodes.Pong, 0x00, Array.Empty<byte>());
            var bytes = orig.Encode();
            var decoded = VBPFrame.Decode(bytes, 0);
            Assert.Equal(orig.Seq, decoded.Seq);
            Assert.Equal(orig.Op, decoded.Op);
            Assert.Equal(orig.Flags, decoded.Flags);
            Assert.Empty(decoded.Body);
        }

        [Fact]
        public void EncodeDecode_MaxLength()
        {
            var body = new byte[1024];
            for (int i = 0; i < body.Length; i++) body[i] = (byte)(i & 0xFF);
            var orig = new VBPFrame(0, VBPOpcodes.DataChunk, 0, body);
            var bytes = orig.Encode();
            var decoded = VBPFrame.Decode(bytes, 0);
            Assert.Equal(body, decoded.Body);
        }

        [Fact]
        public void Decode_BadMagic_Throws()
        {
            var bytes = new byte[] { 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00 };
            var ex = Assert.Throws<VBPBadMagicException>(() => VBPFrame.Decode(bytes, 0));
            Assert.Equal(VBPProtocolError.BadMagic, ex.Code);
        }

        [Fact]
        public void Decode_Truncated_Throws()
        {
            // Only 4 bytes — not enough for the 8-byte header.
            var bytes = new byte[] { 0x56, 0x44, 0x42, 0x00 };
            Assert.Throws<VBPTruncatedException>(() => VBPFrame.Decode(bytes, 0));
        }

        [Fact]
        public void Decode_PayloadLengthTooSmall_Throws()
        {
            // payload_length = 1 (less than OpFlagsLen=2)
            var bytes = new byte[] { 0x56, 0x44, 0x42, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00 };
            Assert.Throws<VBPTruncatedException>(() => VBPFrame.Decode(bytes, 0));
        }

        [Fact]
        public void Decode_PayloadLengthOversize_Throws()
        {
            // payload_length = 100 MB
            var bytes = new byte[8 + 2];
            bytes[0] = 0x56; bytes[1] = 0x44; bytes[2] = 0x42;
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(3, 4), 100 * 1024 * 1024);
            Assert.Throws<VBPOversizeException>(() => VBPFrame.Decode(bytes, 0));
        }

        [Fact]
        public void Decode_BufferShorterThanPayload_Throws()
        {
            // 8B header says payload_length=10, but we only have 4B body
            var bytes = new byte[] { 0x56, 0x44, 0x42, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04 };
            Assert.Throws<VBPTruncatedException>(() => VBPFrame.Decode(bytes, 0));
        }

        [Fact]
        public void EncodeTo_IntoBuffer_Works()
        {
            var frame = new VBPFrame(0x01, VBPOpcodes.Ping, 0x00, new byte[] { 9, 8, 7 });
            var buf = new byte[frame.TotalLength + 4];
            int written = frame.EncodeTo(buf, 4);
            Assert.Equal(frame.TotalLength, written);
            // The first 4 bytes should be untouched (default 0).
            Assert.Equal(0, buf[0]);
            // Frame should decode correctly from offset 4.
            var decoded = VBPFrame.Decode(buf, 4);
            Assert.Equal(frame.Op, decoded.Op);
            Assert.Equal(frame.Seq, decoded.Seq);
            Assert.Equal(frame.Body, decoded.Body);
        }

        [Fact]
        public void ToString_ContainsOpcodeName()
        {
            var frame = new VBPFrame(0, VBPOpcodes.Ping, 0, new byte[] { 1 });
            var s = frame.ToString();
            Assert.Contains("PING", s);
        }

        [Fact]
        public void Equals_Works()
        {
            var a = new VBPFrame(1, VBPOpcodes.Ping, 0, new byte[] { 1, 2, 3 });
            var b = new VBPFrame(1, VBPOpcodes.Ping, 0, new byte[] { 1, 2, 3 });
            var c = new VBPFrame(1, VBPOpcodes.Ping, 0, new byte[] { 1, 2 });
            Assert.Equal(a, b);
            Assert.NotEqual(a, c);
            Assert.False(a.Equals(null));
            Assert.False(a.Equals("not a frame"));
        }

        [Fact]
        public void Constructor_OversizeBody_Throws()
        {
            var body = new byte[VBPFrame.MaxFrameLen];
            Assert.Throws<VBPOversizeException>(() =>
                new VBPFrame(0, VBPOpcodes.DataChunk, 0, body));
        }

        [Fact]
        public void Constructor_NullBody_Throws()
        {
            Assert.Throws<ArgumentNullException>(() =>
                new VBPFrame(0, VBPOpcodes.Ping, 0, null!));
        }
    }
}
