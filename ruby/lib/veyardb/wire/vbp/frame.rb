# frozen_string_literal: true

# vbp/frame.rb — VBP frame I/O.
#
# Wire format (VBP_SPEC.md §2):
#
#   +--------+---------+-----+-----+-----+----------+...+
#   | 'VDB'  | len_le4 | seq | op  | flg |  body    |
#   +--------+---------+-----+-----+-----+----------+...+
#   | 3 B    | 4 B     | 1 B | 1 B | 1 B | (len-2)B |
#   +--------+---------+-----+-----+-----+----------+...+
#
#  * Magic is ASCII bytes 'V', 'D', 'B' (0x56 0x44 0x42).
#  * `len_le4` is the payload length (op + flags + body), little-endian u32.
#  * `seq` is u8 (0-255), wraps at 256.
#  * `op` is u8 (see opcodes.rb).
#  * `flags` is u8 (zero in v1).
#  * `body` length is `len_le4 - 2`.
#
# Pure stdlib: String#unpack, Array#pack. No third-party deps.

require_relative 'protocol_error'

module VedaDB
  module Wire
    module VBP
      MAGIC = 'VDB'.b.freeze
      MAGIC_LEN = 3
      LEN_LEN = 4
      SEQ_LEN = 1
      HDR_LEN = 8
      OP_LEN = 1
      FLAGS_LEN = 1
      OPFLAGS_LEN = 2

      DEFAULT_VBP_PORT = 6380
      MAX_FRAME_LEN = 64 * 1024 * 1024

      Frame = Struct.new(:seq, :op, :flags, :body) do
        def to_s
          "Frame(seq=#{seq}, op=0x#{op.to_s(16).rjust(2, '0')}, " \
            "flags=0x#{flags.to_s(16).rjust(2, '0')}, body_len=#{body.bytesize})"
        end

        def terminal?
          VBP.terminal_opcode?(op)
        end
      end

      module_function

      # Encode a frame to a binary String.
      def encode(seq, op, flags, body = ''.b)
        raise RangeError, "seq out of range: #{seq}" unless seq.is_a?(Integer) && seq >= 0 && seq <= 0xFF
        raise RangeError, "op out of range: #{op}" unless op.is_a?(Integer) && op >= 0 && op <= 0xFF
        raise RangeError, "flags out of range: #{flags}" unless flags.is_a?(Integer) && flags >= 0 && flags <= 0xFF
        body = body.b
        payload_len = OPFLAGS_LEN + body.bytesize
        raise VBPOversize, "payload #{payload_len} > MAX #{MAX_FRAME_LEN}" if payload_len > MAX_FRAME_LEN
        out = String.new(capacity: HDR_LEN + OPFLAGS_LEN + body.bytesize, encoding: Encoding::BINARY)
        out << MAGIC
        out << [payload_len].pack('V')
        out << [seq].pack('C')
        out << [op].pack('C')
        out << [flags].pack('C')
        out << body
        out
      end

      # A frame parser that consumes bytes incrementally.
      class StreamDecoder
        def initialize
          @buf = String.new(encoding: Encoding::BINARY)
          @offset = 0
        end

        attr_reader :offset

        def feed(bytes)
          bytes = bytes.b
          if @offset == 0
            @buf << bytes
          else
            @buf = @buf[@offset..] << bytes
            @offset = 0
          end
          self
        end

        def try_decode
          if @offset + HDR_LEN > @buf.bytesize
            return nil
          end
          unless @buf.byteslice(@offset, MAGIC_LEN) == MAGIC
            if @buf.bytesize - @offset < MAGIC_LEN
              return nil
            end
            got = @buf.byteslice(@offset, MAGIC_LEN).unpack1('H*')
            raise VBPBadMagic, "bad magic: expected 564442, got #{got}"
          end
          payload_len = @buf.byteslice(@offset + MAGIC_LEN, LEN_LEN).unpack1('V')
          if payload_len < OPFLAGS_LEN
            raise VBPTruncated, "payload_length #{payload_len} < #{OPFLAGS_LEN}"
          end
          if payload_len > MAX_FRAME_LEN
            raise VBPOversize, "payload_length #{payload_len} > MAX #{MAX_FRAME_LEN}"
          end
          total_len = HDR_LEN + payload_len
          if @offset + total_len > @buf.bytesize
            return nil
          end
          seq = @buf.getbyte(@offset + MAGIC_LEN + LEN_LEN)
          op = @buf.getbyte(@offset + HDR_LEN)
          flags = @buf.getbyte(@offset + HDR_LEN + 1)
          body_start = @offset + HDR_LEN + OPFLAGS_LEN
          body_end = @offset + total_len
          body = @buf.byteslice(body_start, body_end - body_start)
          @offset += total_len
          Frame.new(seq, op, flags, body.dup.force_encoding(Encoding::BINARY))
        end
      end
    end
  end
end
