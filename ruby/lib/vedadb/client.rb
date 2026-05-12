# frozen_string_literal: true

require "socket"
require "json"
require "openssl"

module VedaDB
  # VedaDB Ruby client driver with full feature support.
  #
  # Usage:
  #   # Basic
  #   db = VedaDB::Client.new("localhost", 6380)
  #   result = db.query("SELECT * FROM users;")
  #   puts result.to_hashes
  #   db.close
  #
  #   # Block form (auto-close)
  #   VedaDB::Client.open("localhost", 6380) do |db|
  #     db.query("SELECT * FROM users;")
  #   end
  #
  #   # TLS + Auth
  #   db = VedaDB::Client.new("localhost", 6380,
  #                           tls: true, username: "admin", password: "secret")
  #
  #   # From URI
  #   db = VedaDB::Client.from_uri("vedadb://admin:secret@db.example.com:6380/mydb?tls=true")
  #
  #   # With all features
  #   db = VedaDB::Client.new("localhost", 6380,
  #                           retry: { max: 5 },
  #                           circuit_breaker: { threshold: 3 },
  #                           metrics: VedaDB::Metrics.new)
  class Client
    include Enumerable
    include Retryable

    attr_reader :host, :port, :timeout, :config

    def initialize(host = "localhost", port = 6380, **config)
      @host       = host
      @port       = port
      @timeout    = config[:timeout] || 30
      @tls        = config[:tls] || false
      @tls_verify = config.fetch(:tls_verify, true)
      @username   = config[:username]
      @password   = config[:password]
      @config     = config
      @mutex      = Mutex.new
      @connected  = false

      # Optional feature integrations
      @retry        = build_retry(config[:retry])
      @breaker      = build_circuit_breaker(config[:circuit_breaker])
      @metrics      = config[:metrics]
      @interceptor  = build_interceptor(config[:interceptors])

      connect
    end

    # ================================================================
    # Factory methods
    # ================================================================

    # Connect with a block for auto-close.
    def self.open(host = "localhost", port = 6380, **config)
      client = new(host, port, **config)
      if block_given?
        begin
          yield client
        ensure
          client.close
        end
      else
        client
      end
    end

    # Create a client from a VedaDB URI string.
    def self.from_uri(uri_string, **extra_config)
      config = VedaDB::URI.parse(uri_string)
      config.merge!(extra_config)

      Client.new(config[:host], config[:port], **config)
    rescue URIError => e
      raise ConnectionError, "Invalid URI: #{e.message}"
    end

    # Alias for URI-based connection.
    def self.connect(uri_string, **extra_config)
      from_uri(uri_string, **extra_config)
    end

    # ================================================================
    # Connection management
    # ================================================================

    def connect
      @mutex.synchronize do
        return if @connected

        do_connect
        @connected = true
      end
    end

    def connected?
      @connected
    end

    # Close the connection.
    def close
      return if @socket.nil? || @socket.closed?

      @mutex.synchronize do
        begin
          @socket.write(Protocol.quit_frame)
        rescue StandardError
          nil
        end
        @socket.close rescue nil
        @connected = false
      end
    end

    # Attempt to reconnect to the server.
    def reconnect(max_retries: 3)
      @mutex.synchronize { @connected = false }

      Retry.with(max: max_retries, base: 0.5) do
        do_connect
        @connected = true
      end
    end

    # TLS connection info (nil if not TLS).
    def tls_info
      TLS.info(@socket) if TLS.tls?(@socket)
    end

    # ================================================================
    # Query execution
    # ================================================================

    # Execute a VedaQL query and return a Result.
    def query(sql)
      run_with_features(operation: :query, sql: sql) do
        @mutex.synchronize do
          ensure_connected
          @socket.write(Protocol.encode(sql))
          frame = Protocol.read_frame(@socket)
          Protocol.to_result(Protocol.decode(frame))
        end
      end
    end

    # Execute a DDL/DML statement, returns the status message.
    def exec(sql)
      run_with_features(operation: :exec, sql: sql) do
        result = query(sql)
        result.message || "#{result.row_count} rows"
      end
    end

    alias execute exec

    # Insert a single row.
    def insert(table, data)
      cols = data.keys.join(", ")
      vals = data.values.map { |v| Protocol.format_value(v) }.join(", ")
      query("INSERT INTO #{table} (#{cols}) VALUES (#{vals});")
    end

    # Select with keyword arguments.
    def select(table, columns: "*", where: nil, order_by: nil, limit: nil)
      qb = QueryBuilder.new(self, table)
      qb.select(columns.split(", ").map(&:strip)) unless columns == "*"
      qb.where(where) if where
      qb.order(order_by) if order_by
      qb.limit(limit) if limit
      qb.execute
    end

    # Update rows.
    def update(table, set, where: nil)
      qb = QueryBuilder.new(self, table)
      qb.where(where) if where
      qb.update(set)
    end

    # Delete rows.
    def delete(table, where: nil)
      qb = QueryBuilder.new(self, table)
      qb.where(where) if where
      qb.delete
    end

    # Prepared statements.
    def prepare(name, query_str)
      query("PREPARE #{name} AS #{query_str}")
    end

    def execute_prepared(name, *args)
      args.each_with_index do |a, i|
        if a.is_a?(String) && a.include?("\0")
          raise QueryError, "vedadb: prepared arg #{i} contains NUL byte"
        end
      end
      query("EXECUTE #{name} (#{Protocol.bind_params(args)})")
    end

    def deallocate(name)
      query("DEALLOCATE #{name}")
    end

    # ================================================================
    # Enumerable
    # ================================================================

    def each(&block)
      return enum_for(:each) unless block_given?

      cursor("SELECT * FROM #{@last_table || 'users'}") do |c|
        c.each(&block)
      end
    end

    # ================================================================
    # Transactions
    # ================================================================

    def begin_transaction
      query("BEGIN")
    end
    alias begin begin_transaction

    def commit
      query("COMMIT")
    end

    def rollback
      query("ROLLBACK")
    end

    # Execute a block inside a transaction.
    def transaction
      self.begin
      result = yield(self)
      self.commit
      result
    rescue => e
      self.rollback
      raise e
    end

    # ================================================================
    # Metadata
    # ================================================================

    def show_tables
      result = query("SHOW TABLES;")
      return [] if result.rows.nil?

      result.rows.map(&:first)
    end

    def describe_table(table)
      query("DESCRIBE #{table};")
    end

    # ================================================================
    # Health
    # ================================================================

    def ping
      query("SELECT 1;")
      true
    rescue StandardError
      false
    end

    # ================================================================
    # Cache operations
    # ================================================================

    def cache_set(key, value, ttl = 0)
      val = if value.is_a?(Hash) || value.is_a?(Array)
              "'#{JSON.generate(value)}'"
            else
              "'#{value}'"
            end
      sql = "CACHE SET '#{key}' #{val}"
      sql += " TTL #{ttl}" if ttl > 0
      query(sql + ";")
    end

    def cache_get(key)
      query("CACHE GET '#{key}';")
    end

    def cache_del(key)
      query("CACHE DEL '#{key}';")
    end

    def cache_keys(pattern = "*")
      query("CACHE KEYS '#{pattern}';")
    end

    # ================================================================
    # Search & Graph
    # ================================================================

    def search(table, search_query, fuzzy: 0)
      sql = "SEARCH #{table} MATCH '#{search_query}'"
      sql += " FUZZY #{fuzzy}" if fuzzy > 0
      query(sql + ";")
    end

    def graph_add_node(id, label, props = {})
      sql = "GRAPH ADD NODE '#{id}' LABEL '#{label}'"
      sql += " PROPERTIES '#{JSON.generate(props)}'" unless props.empty?
      query(sql + ";")
    end

    def graph_add_edge(from_id, to_id, edge_type)
      query("GRAPH ADD EDGE '#{from_id}' -> '#{to_id}' TYPE '#{edge_type}';")
    end

    def graph_bfs(start, depth: 3)
      query("GRAPH BFS '#{start}' DEPTH #{depth};")
    end

    # ================================================================
    # Feature factory methods
    # ================================================================

    # Create a pipeline for batching queries.
    def pipeline
      pipe = Pipeline.new(self)
      return pipe unless block_given?

      begin
        yield pipe
        pipe.execute
      end
    end

    # Create a bulk inserter.
    def bulk_insert(table, batch_size: 1000)
      bulk = BulkInserter.new(self, table, batch_size)
      return bulk unless block_given?

      begin
        yield bulk
      ensure
        bulk.close
      end
    end

    # Create a streaming cursor.
    def cursor(sql, params = nil, **opts)
      c = Cursor.new(self, sql, params, **opts)
      return c unless block_given?

      begin
        yield c
      ensure
        c.close
      end
    end

    # Create a Pub/Sub handler.
    def pubsub
      PubSub.new(self)
    end

    # Watch a table for changes.
    def watch(table = nil)
      ChangeStream.new(self, table)
    end

    # Create a query builder for a table.
    def table(name)
      QueryBuilder.new(self, name)
    end

    # ================================================================
    # Metrics & Interceptors
    # ================================================================

    def use(interceptor)
      (@interceptor ||= Interceptor.new).use(interceptor)
      self
    end

    def metrics
      @metrics
    end

    def circuit_breaker
      @breaker
    end

    # ================================================================
    # Multi-node helpers
    # ================================================================

    # Insert multiple rows in a single statement.
    def insert_many(table, columns, rows)
      vals = rows.map do |r|
        "(#{r.map { |v| "'#{v.to_s.gsub("'", "''")}'" }.join(', ')})"
      end.join(", ")
      query("INSERT INTO #{table} (#{columns.join(', ')}) VALUES #{vals}")
    end

    private

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def do_connect
      @socket = TCPSocket.new(@host, @port)
      @socket.setsockopt(Socket::SOL_SOCKET, Socket::SO_RCVTIMEO,
                         [@timeout, 0].pack("l_2"))
      @socket.setsockopt(Socket::SOL_SOCKET, Socket::SO_SNDTIMEO,
                         [@timeout, 0].pack("l_2"))

      # Read and discard welcome banner
      banner = @socket.gets
      Protocol.parse_welcome(banner) if banner

      # STARTTLS upgrade
      if @tls
        @socket.write(Protocol.encode("STARTTLS"))
        response = Protocol.read_frame(@socket)
        data = Protocol.decode(response)
        raise TLSError, "STARTTLS failed: #{data['error']}" if data["error"]

        @socket = TLS.upgrade(@socket, host: @host, verify: @tls_verify)
      end

      # AUTH
      if @username
        @socket.write(Protocol.encode_command(:auth, @username, @password))
        response = Protocol.read_frame(@socket)
        data = Protocol.decode(response)
        raise AuthError, "Authentication failed: #{data['error']}" if data["error"]
      end

      @metrics&.connection_event(event: "open")
    rescue Errno::ECONNREFUSED => e
      raise ConnectionError, "Connection refused to #{@host}:#{@port} — #{e.message}"
    rescue SocketError => e
      raise ConnectionError, "Cannot resolve #{@host}: #{e.message}"
    rescue OpenSSL::SSL::SSLError => e
      raise TLSError, "TLS error: #{e.message}"
    end

    def ensure_connected
      unless @connected
        raise ConnectionError, "Not connected to #{@host}:#{@port}"
      end
    end

    # ------------------------------------------------------------------
    # Feature wiring
    # ------------------------------------------------------------------

    def build_retry(config)
      return nil unless config

      cfg = config.is_a?(Hash) ? config : {}
      Retry.new(
        max:   cfg[:max]   || Retry::DEFAULT_MAX,
        base:  cfg[:base]  || Retry::DEFAULT_BASE,
        on:    cfg[:on]    || [ConnectionError]
      )
    end

    def build_circuit_breaker(config)
      return nil unless config

      cfg = config.is_a?(Hash) ? config : {}
      CircuitBreaker.new(
        threshold:        cfg[:threshold]        || CircuitBreaker::DEFAULT_THRESHOLD,
        recovery_timeout: cfg[:recovery_timeout] || CircuitBreaker::DEFAULT_RECOVERY_TIMEOUT
      )
    end

    def build_interceptor(list)
      return nil unless list

      ix = Interceptor.new
      Array(list).each { |i| ix.use(i) }
      ix
    end

    # Run the operation through retry, circuit breaker, and interceptors.
    def run_with_features(env = {})
      op = proc { yield }

      # Interceptor chain (outermost)
      if @interceptor
        op = proc { @interceptor.run(env) { yield } }
      end

      # Circuit breaker
      if @breaker
        breaker = @breaker
        op = proc { breaker.call { op.call } }
      end

      # Retry (innermost — closest to the actual call)
      if @retry
        retryer = @retry
        op = proc { retryer.call { op.call } }
      end

      op.call
    end
  end
end
