# frozen_string_literal: true

# vbp/connection.rb — Public VBP connection API.
#
#   conn = VBPConnection.new(host: '127.0.0.1', port: 6380,
#                            user: 'admin', password: 'secret',
#                            database: 'main', timeout: 30,
#                            mechanism: 'PLAIN')
#   conn.connect
#   result = conn.execute('SELECT 1')
#   conn.close

require 'socket'

require_relative 'frame'
require_relative 'opcodes'
require_relative 'auth'
require_relative 'multiplexer'
require_relative 'result'
require_relative 'exception'

module VedaDB
  module Wire
    module VBP
      class VBPConnection
        attr_reader :host, :port, :user, :database, :timeout, :mechanism

        def initialize(host: '127.0.0.1', port: DEFAULT_VBP_PORT, user: 'admin',
                       password: '', database: 'main', timeout: 30,
                       mechanism: nil)
          @host = host
          @port = port
          @user = user
          @password = password.to_s
          @database = database
          @timeout = timeout
          @mechanism = mechanism
          @socket = nil
          @mux = nil
          @connected = false
          @mutex = Mutex.new
        end

        def connect
          @mutex.synchronize do
            return self if @connected
            @socket = TCPSocket.new(@host, @port)
            @socket.setsockopt(Socket::IPPROTO_TCP, Socket::TCP_NODELAY, 1)
            @mux = Multiplexer.new(@socket)
            @mux.start
            if skip_hello?
              # v1 dev server (simple handler) — skip CLIENT_HELLO + AUTH.
              @connected = true
              return self
            end
            hello_body = client_hello_body
            frames = @mux.call(OP_CLIENT_HELLO, hello_body, timeout: @timeout)
            ready = frames.find { |f| f.op == OP_SERVER_READY }
            unless ready
              @socket&.close
              raise VBPAuthError.new(SQLSTATE_PROTOCOL_VIOLATION, 'no SERVER_READY in client_hello reply')
            end
            auth_ok = frames.find { |f| f.op == OP_AUTH_OK }
            if auth_ok.nil?
              VBP.perform_handshake(@mux, mechanism: mechanism_key,
                                    username: @user, password: @password)
            end
            @connected = true
            self
          end
        end

        # When targeting the v1 dev server (which only supports
        # QUERY/PING/CLOSE), skip the CLIENT_HELLO + AUTH handshake.
        def skip_hello?
          ENV['VEDADB_VBP_SKIP_HELLO'] == '1' ||
            (defined?(@options) && @options[:skip_hello])
        end

        def close
          @mutex.synchronize do
            return unless @connected
            begin
              @socket&.write(encode(0, OP_CLOSE, 0, ''.b))
            rescue StandardError
              # ignore
            end
            @mux&.close
            @connected = false
          end
        end

        def execute(sql, _params = [])
          raise 'not connected' unless @connected
          body = query_body(sql)
          frames = @mux.call(OP_QUERY, body, timeout: @timeout)
          parse_query_reply(frames)
        end

        def ping(nonce = nil)
          raise 'not connected' unless @connected
          nonce ||= SecureRandom.random_bytes(8)
          frames = @mux.call(OP_PING, nonce, timeout: @timeout)
          pong = frames.find { |f| f.op == OP_PONG }
          pong ? pong.body : nil
        end

        def connected?
          @connected
        end

        def encode(*args)
          VBP.encode(*args)
        end

        private

        def mechanism_key
          m = @mechanism
          return m if m && !m.empty?
          ENV['VEDADB_VBP_MECH'] || AUTH_MECH_PLAIN
        end

        def client_hello_body
          # Body: u16 proto_version=1, u16 client_flags=0, u32 user_len, user,
          #       u32 db_len, db, u8 actor_kind=0, u32 actor_id_len=0
          user_b = @user.to_s.b
          db_b = @database.to_s.b
          body = String.new(capacity: 2 + 2 + 4 + user_b.bytesize + 4 + db_b.bytesize + 1 + 4,
                            encoding: Encoding::BINARY)
          body << [1].pack('v')      # u16 protocol version = 1
          body << [0].pack('v')      # u16 client flags
          body << [user_b.bytesize].pack('V')
          body << user_b
          body << [db_b.bytesize].pack('V')
          body << db_b
          body << [0].pack('C')      # u8 actor_kind
          body << [0].pack('V')      # u32 actor_id_len
          body
        end

        def query_body(sql)
          # v1 dev server: u32 query_id, u32 text_len, str text, u16 param_count=0
          sql_b = sql.to_s.b
          body = String.new(capacity: 4 + 4 + sql_b.bytesize + 2, encoding: Encoding::BINARY)
          body << [0].pack('V') # query_id
          body << [sql_b.bytesize].pack('V')
          body << sql_b
          body << [0].pack('v') # param_count
          body
        end

        def parse_query_reply(frames)
          result = VBPResult.new
          frames.each do |f|
            case f.op
            when OP_DATA_CHUNK
              if f.body.bytesize >= 13
                value = f.body.byteslice(13, 4).unpack1('l<')
                result.rows << [value]
                result.columns = ['?column?']
                result.column_types = [T_INT4]
              end
            when OP_ROWS_FINISHED
              if f.body.bytesize >= 12
                result.rows_affected = f.body.byteslice(0, 8).unpack1('Q<')
                tag_len = f.body.byteslice(8, 4).unpack1('V')
                result.command_tag = f.body.byteslice(12, tag_len).force_encoding(Encoding::UTF_8)
              end
            when OP_ERROR
              sqlstate = f.body.byteslice(0, 5)&.force_encoding(Encoding::US_ASCII) || '08P01'
              msg_len = f.body.bytesize >= 9 ? f.body.byteslice(5, 4).unpack1('V') : 0
              msg = f.body.byteslice(9, msg_len)&.force_encoding(Encoding::UTF_8) || ''
              raise VBPRuntimeError.new(sqlstate, msg)
            end
          end
          result
        end
      end
    end
  end
end
