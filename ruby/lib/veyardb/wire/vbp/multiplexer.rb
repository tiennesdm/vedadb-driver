# frozen_string_literal: true

# vbp/multiplexer.rb — VBP multiplexed connection (with streaming fix).
#
# Single TCP connection carrying many concurrent in-flight requests
# keyed by 1-byte sequence id.
#
# Streaming-fix (CRITICAL): a single request may receive multiple
# DATA_CHUNK frames before the terminal frame (ROWS_FINISHED or
# COMMAND_COMPLETE). The fix distinguishes terminal vs non-terminal:
#
#   * DATA_CHUNK is NON-terminal: ACCUMULATE into the inflight entry,
#     do NOT remove the slot.
#   * ROWS_FINISHED, COMMAND_COMPLETE, ERROR are TERMINAL: REMOVE the
#     inflight slot and deliver the accumulated frames.
#   * AUTH_OK, PONG are also terminal (single-frame responses).

require 'socket'
require 'thread'

require_relative 'frame'
require_relative 'opcodes'

module VedaDB
  module Wire
    module VBP
      class VBPError < StandardError
        attr_reader :sqlstate, :detail, :hint

        def initialize(sqlstate, message, detail = '', hint = '')
          @sqlstate = sqlstate
          @detail = detail
          @hint = hint
          super("[#{sqlstate}] #{message}")
        end
      end

      class Multiplexer
        def initialize(socket)
          unless socket.respond_to?(:readpartial) || socket.respond_to?(:read_nonblock)
            raise TypeError, 'Multiplexer requires a socket-like object'
          end
          @socket = socket
          @mutex = Mutex.new
          @cv = ConditionVariable.new
          @closing = false
          @closed = false
          @decoder = StreamDecoder.new
          @inflight = {}
          @next_seq = 1
          @last_call_seq = 0
          @reader_thread = nil
        end

        def start
          return if @reader_thread
          @reader_thread = Thread.new do
            begin
              reader_loop
            rescue StandardError => e
              warn "vbp reader thread crashed: #{e.class}: #{e.message}"
              e.backtrace.first(5).each { |l| warn "  #{l}" }
            end
          end
        end

        def call(op, body, opts = {})
          body = body.b
          seq = alloc
          entry = { frames: [], error: nil, done: false }
          @mutex.synchronize do
            @inflight[seq] = entry
            @last_call_seq = seq
            begin
              @socket.write(VBP.encode(seq, op, 0, body))
            rescue StandardError => e
              @inflight.delete(seq)
              @cv.broadcast
              raise e
            end
          end
          timeout = opts[:timeout]
          deadline = timeout ? Time.now + timeout : nil
          @mutex.synchronize do
            until entry[:done]
              remaining = deadline ? deadline - Time.now : nil
              if remaining && remaining <= 0
                entry[:done] = true
                @inflight.delete(seq)
                err = VBPError.new('57014',
                  format('vbp call op=0x%02X seq=%d timed out', op, seq))
                raise err
              end
              @cv.wait(@mutex, remaining || 0.1)
            end
            raise entry[:error] if entry[:error]
            return entry[:frames]
          end
        end

        def close
          @mutex.synchronize do
            return if @closed
            @closing = true
            @closed = true
            err = VBPConnectionClosed.new('connection closed')
            @inflight.each do |_seq, entry|
              entry[:error] = err
              entry[:done] = true
            end
            @inflight.clear
            @cv.broadcast
          end
          begin
            @socket.close
          rescue StandardError
            # ignore
          end
          @reader_thread&.join(0.5)
        end

        private

        def alloc
          @mutex.synchronize do
            start_seq = @next_seq
            256.times do
              seq = @next_seq
              @next_seq = (@next_seq + 1) & 0xFF
              next if seq.zero?
              return seq unless @inflight.key?(seq)
              break if @next_seq == start_seq
            end
            raise VBPProtocolError, 'all 256 sequence ids are in flight'
          end
        end

        def reader_loop
          loop do
            break if @closed
            begin
              chunk = @socket.readpartial(4096)
            rescue EOFError, IOError, Errno::ECONNRESET, Errno::EPIPE
              break
            rescue StandardError
              break
            end
            handle_chunk(chunk)
          end
          fail_all(VBPConnectionClosed.new('peer closed'))
        end

        def handle_chunk(chunk)
          @decoder.feed(chunk)
          loop do
            frame = @decoder.try_decode
            break unless frame
            dispatch_frame(frame)
          end
        rescue VBPProtocolError => e
          fail_all(e)
          close
        end

        # Streaming fix: this is the dispatcher that distinguishes
        # terminal vs non-terminal opcodes. The fix is in the
        # `terminal_opcode?` check below — DATA_CHUNK is non-terminal.
        def dispatch_frame(frame)
          target_seq = frame.seq
          @mutex.synchronize do
            entry = @inflight[target_seq]
            if !entry && target_seq.zero? && @last_call_seq > 0
              entry = @inflight[@last_call_seq]
            end
            return unless entry
            if frame.op == OP_ERROR
              sqlstate, message = parse_error_frame(frame)
              entry[:error] = VBPError.new(sqlstate, message)
              entry[:done] = true
              seq = @inflight.key?(target_seq) ? target_seq : @last_call_seq
              @inflight.delete(seq)
              @cv.broadcast
              return
            end
            entry[:frames] << frame
            # Streaming fix: DATA_CHUNK (0x0A) is NON-terminal.
            if terminal_opcode?(frame.op)
              entry[:done] = true
              seq = @inflight.key?(target_seq) ? target_seq : @last_call_seq
              @inflight.delete(seq)
              @cv.broadcast
            end
          end
        end

        def terminal_opcode?(op)
          op == OP_ROWS_FINISHED ||
            op == OP_COMMAND_COMPLETE ||
            op == OP_AUTH_OK ||
            op == OP_PONG ||
            op == OP_SERVER_READY ||
            op == OP_ERROR
        end

        def fail_all(err)
          @mutex.synchronize do
            @inflight.each do |_seq, entry|
              entry[:error] = err
              entry[:done] = true
            end
            @inflight.clear
            @cv.broadcast
          end
        end

        def parse_error_frame(frame)
          body = frame.body
          if body.bytesize < 9
            return [SQLSTATE_PROTOCOL_VIOLATION, 'malformed error frame']
          end
          sqlstate = body.byteslice(0, 5).force_encoding(Encoding::US_ASCII)
          msg_len = body.byteslice(5, 4).unpack1('V')
          message = body.byteslice(9, msg_len).force_encoding(Encoding::UTF_8)
          [sqlstate, message]
        end
      end
    end
  end
end
