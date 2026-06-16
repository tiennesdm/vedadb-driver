# frozen_string_literal: true

# vbp/handlers.rb — VBP opcode handler stubs.

require_relative 'frame'
require_relative 'opcodes'

module VedaDB
  module Wire
    module VBP
      module Handlers
        module_function

        def err_frame(sqlstate, message, op)
          msg_buf = message.b
          body = String.new(capacity: 5 + 4 + msg_buf.bytesize + 4 + 4, encoding: Encoding::BINARY)
          body << sqlstate[0, 5].ljust(5, ' ').b
          body << [msg_buf.bytesize].pack('V')
          body << msg_buf
          body << [0].pack('V')
          body << [0].pack('V')
          Frame.new(0, op, 0, body)
        end

        def stub(op)
          err_frame('0A000', "vbp v1 driver: opcode #{VBP.opcode_name(op)} not implemented (v2)", OP_ERROR)
        end

        def handle_client_hello(_body = ''.b)
          sr_body = String.new(capacity: 13 + 16, encoding: Encoding::BINARY)
          sr_body << [0x000A0000].pack('V')
          sr_body << [0x0000001F].pack('V')
          sr_body << [0].pack('C')
          sr_body << [16].pack('V')
          sr_body << "\0" * 16
          [Frame.new(0, OP_SERVER_READY, 0, sr_body),
           Frame.new(0, OP_AUTH_OK, 0, "\0".b * 20)]
        end

        def handle_auth_response(_body = ''.b)
          [Frame.new(0, OP_AUTH_OK, 0, "\0".b * 20)]
        end

        def handle_query(_body = ''.b)
          [data_chunk_int(0, 1),
           rows_finished(0, 1, 'SELECT 1'),
           command_complete(0, 0)]
        end

        def handle_ping(_mux, body)
          [Frame.new(0, OP_PONG, 0, body[0, 8].dup)]
        end

        def handle_close; []; end
        def handle_begin; [command_complete(0, 1)]; end
        def handle_commit; [command_complete(0, 0)]; end
        def handle_rollback; [command_complete(0, 0)]; end
        def handle_ext_query; [stub(OP_EXT_QUERY)]; end
        def handle_parse; [command_complete(0, 0)]; end
        def handle_bind; [command_complete(0, 0)]; end
        def handle_copy_in; [stub(OP_COPY_IN)]; end
        def handle_copy_done; [command_complete(0, 0)]; end
        def handle_copy_fail; [command_complete(0, 0)]; end
        def handle_cancel_query; [command_complete(0, 0)]; end

        def data_chunk_int(seq, value)
          body = String.new(capacity: 4 + 4 + 2 + 2 + 1 + 4, encoding: Encoding::BINARY)
          body << [1].pack('V')
          body << [1].pack('V')
          body << [1].pack('v')
          body << [T_INT4].pack('v')
          body << [0].pack('C')
          body << [value].pack('l<')
          Frame.new(seq, OP_DATA_CHUNK, 0, body)
        end

        def rows_finished(seq, rows_affected, tag)
          tag_buf = tag.b
          body = String.new(capacity: 8 + 4 + tag_buf.bytesize + 4, encoding: Encoding::BINARY)
          body << [rows_affected].pack('Q<')
          body << [tag_buf.bytesize].pack('V')
          body << tag_buf
          body << [0].pack('V')
          Frame.new(seq, OP_ROWS_FINISHED, 0, body)
        end

        def command_complete(seq, status)
          Frame.new(seq, OP_COMMAND_COMPLETE, 0, [status & 0xFF].pack('C'))
        end

        def handle_data_chunk
          [err_frame('42601', 'DATA_CHUNK is server-to-client', OP_ERROR)]
        end
        def handle_rows_finished
          [err_frame('42601', 'ROWS_FINISHED is server-to-client', OP_ERROR)]
        end
        def handle_command_complete
          [err_frame('42601', 'COMMAND_COMPLETE is server-to-client', OP_ERROR)]
        end
        def handle_error
          [err_frame('42601', 'ERROR is server-to-client', OP_ERROR)]
        end
        def handle_auth_challenge
          [err_frame('42601', 'AUTH_CHALLENGE is server-to-client', OP_ERROR)]
        end
        def handle_server_ready
          [err_frame('42601', 'SERVER_READY is server-to-client', OP_ERROR)]
        end
        def handle_pong
          [err_frame('42601', 'PONG is server-to-client', OP_ERROR)]
        end

        HANDLERS = {
          OP_CLIENT_HELLO => method(:handle_client_hello),
          OP_AUTH_RESPONSE => method(:handle_auth_response),
          OP_QUERY => method(:handle_query),
          OP_PING => method(:handle_ping),
          OP_CLOSE => method(:handle_close),
          OP_BEGIN => method(:handle_begin),
          OP_COMMIT => method(:handle_commit),
          OP_ROLLBACK => method(:handle_rollback),
          OP_EXT_QUERY => method(:handle_ext_query),
          OP_PARSE => method(:handle_parse),
          OP_BIND => method(:handle_bind),
          OP_COPY_IN => method(:handle_copy_in),
          OP_COPY_DONE => method(:handle_copy_done),
          OP_COPY_FAIL => method(:handle_copy_fail),
          OP_CANCEL_QUERY => method(:handle_cancel_query),
          OP_DATA_CHUNK => method(:handle_data_chunk),
          OP_ROWS_FINISHED => method(:handle_rows_finished),
          OP_COMMAND_COMPLETE => method(:handle_command_complete),
          OP_ERROR => method(:handle_error),
          OP_AUTH_CHALLENGE => method(:handle_auth_challenge),
          OP_SERVER_READY => method(:handle_server_ready),
          OP_PONG => method(:handle_pong),
          OP_AUTH_OK => ->(_b = ''.b) { [] }
        }.freeze

        def assert_all_registered
          missing = MANDATORY_OPCODES.reject { |op| HANDLERS.key?(op) }
          raise "missing handlers for: #{missing.map { |o| opcode_name(o) }.join(', ')}" unless missing.empty?
        end
      end
    end
  end
end
