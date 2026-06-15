// VedaDB .NET SDK — VBP wire layer
//
// 8-byte VBP frame header: 3B magic 'VDB' (0x56 0x44 0x42) + 4B LE payload_length + 1B seq.
// payload_length INCLUDES op + flags + body. Min payload = 2 (op + flags).
// Max payload = 64 MiB (matches Go reference).
//
// Wire layout (VBP_SPEC.md §2):
//   +--------+---------+-----+-----+-----+----------+...+
//   | 'VDB'  | len_le4 | seq | op  | flg |  body    |
//   +--------+---------+-----+-----+-----+----------+...+
//   | 3 B    | 4 B     | 1 B | 1 B | 1 B | (len-2)B |
//   +--------+---------+-----+-----+-----+----------+...+

using System;
using System.Buffers.Binary;

namespace VedaDB.Wire.Vbp
{
    public sealed class VBPFrame
    {
        public static readonly byte[] Magic = new byte[] { (byte)'V', (byte)'D', (byte)'B' };
        public const int MagicLen = 3;
        public const int LenLen = 4;
        public const int SeqLen = 1;
        public const int HdrLen = MagicLen + LenLen + SeqLen; // 8
        public const int OpLen = 1;
        public const int FlagsLen = 1;
        public const int OpFlagsLen = OpLen + FlagsLen; // 2
        public const int MaxFrameLen = 64 * 1024 * 1024; // 64 MiB

        public byte Seq { get; }
        public byte Op { get; }
        public byte Flags { get; }
        public byte[] Body { get; }

        public VBPFrame(byte seq, byte op, byte flags, byte[] body)
        {
            if (body == null) throw new ArgumentNullException(nameof(body));
            if (body.Length > MaxFrameLen - OpFlagsLen)
                throw new VBPOversizeException($"body too large: {body.Length}");
            Seq = seq;
            Op = op;
            Flags = flags;
            Body = body;
        }

        public int PayloadLength => OpFlagsLen + Body.Length;
        public int TotalLength => HdrLen + OpFlagsLen + Body.Length;

        /// <summary>Encode this frame to a fresh byte array (VBP_SPEC.md §2 wire layout).</summary>
        public byte[] Encode()
        {
            var outBuf = new byte[TotalLength];
            EncodeTo(outBuf, 0);
            return outBuf;
        }

        /// <summary>Encode into an existing buffer at <paramref name="offset"/>. Returns bytes written.</summary>
        public int EncodeTo(byte[] outBuf, int offset)
        {
            int p = offset;
            outBuf[p++] = Magic[0];
            outBuf[p++] = Magic[1];
            outBuf[p++] = Magic[2];
            int pl = PayloadLength;
            BinaryPrimitives.WriteInt32LittleEndian(outBuf.AsSpan(p, 4), pl);
            p += 4;
            outBuf[p++] = Seq;
            outBuf[p++] = Op;
            outBuf[p++] = Flags;
            if (Body.Length > 0)
            {
                Buffer.BlockCopy(Body, 0, outBuf, p, Body.Length);
                p += Body.Length;
            }
            return p - offset;
        }

        /// <summary>Decode a frame from <paramref name="buf"/> starting at <paramref name="offset"/>.</summary>
        public static VBPFrame Decode(byte[] buf, int offset)
        {
            if (buf == null) throw new ArgumentNullException(nameof(buf));
            if (buf.Length - offset < HdrLen)
                throw new VBPTruncatedException($"need at least {HdrLen} bytes");

            if (buf[offset] != Magic[0] || buf[offset + 1] != Magic[1] || buf[offset + 2] != Magic[2])
                throw new VBPBadMagicException($"bad magic at offset {offset}");

            int pl = BinaryPrimitives.ReadInt32LittleEndian(buf.AsSpan(offset + 3, 4));
            byte seq = buf[offset + 7];
            if (pl < OpFlagsLen)
                throw new VBPTruncatedException($"payload_length {pl} < {OpFlagsLen}");
            if (pl > MaxFrameLen)
                throw new VBPOversizeException($"payload_length {pl} > {MaxFrameLen}");

            int need = HdrLen + pl;
            if (buf.Length - offset < need)
                throw new VBPTruncatedException(
                    $"buffer truncated: need {need}, have {buf.Length - offset}");

            byte op = buf[offset + HdrLen];
            byte flags = buf[offset + HdrLen + 1];
            int bodyLen = pl - OpFlagsLen;
            byte[] body = new byte[bodyLen];
            if (bodyLen > 0)
                Buffer.BlockCopy(buf, offset + HdrLen + OpFlagsLen, body, 0, bodyLen);
            return new VBPFrame(seq, op, flags, body);
        }

        public override string ToString() =>
            $"Frame(seq={Seq}, op={VBPOpcodes.OpcodeName(Op)}, flags=0x{Flags:X2}, body_len={Body.Length})";

        public override bool Equals(object? obj)
        {
            if (obj is not VBPFrame other) return false;
            if (Seq != other.Seq || Op != other.Op || Flags != other.Flags) return false;
            if (Body.Length != other.Body.Length) return false;
            for (int i = 0; i < Body.Length; i++)
                if (Body[i] != other.Body[i]) return false;
            return true;
        }

        public override int GetHashCode() => Seq * 31 + Op;
    }
}
