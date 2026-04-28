# frozen_string_literal: true

require "socket"
require "json"
require "openssl"

module VedaDB
  # VedaDB Ruby client driver.
  #
  # Usage:
  #   db = VedaDB::Client.new("localhost", 6380)
  #   result = db.query("SELECT * FROM users;")
  #   puts result.to_hashes
  #   db.close
  #
  # Block syntax:
  #   VedaDB::Client.open("localhost", 6380) do |db|
  #     db.query("SELECT * FROM users;")
  #   end
  #
  # TLS + Auth:
  #   db = VedaDB::Client.new("localhost", 6380, tls: true, username: "admin", password: "secret")
  class Client
    attr_reader :host, :port

    def initialize(host = "localhost", port = 6380, timeout: 30, tls: false, tls_verify: true, username: nil, password: nil)
      @host = host
      @port = port
      @timeout = timeout
      @tls = tls
      @tls_verify = tls_verify
      @username = username
      @password = password
      @mutex = Mutex.new

      connect
    end

    # Connect with a block for auto-close.
    def self.open(host = "localhost", port = 6380, timeout: 30, tls: false, tls_verify: true, username: nil, password: nil)
      client = new(host, port, timeout: timeout, tls: tls, tls_verify: tls_verify, username: username, password: password)
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

    # Execute a VedaQL query.
    def query(sql)
      @mutex.synchronize do
        @socket.write(sql + "\n")

        response = @socket.gets
        raise ConnectionError, "Connection closed" if response.nil?

        Result.parse(response.strip)
      end
    end

    # Execute a DDL/DML statement, returns the status message.
    def exec(sql)
      result = query(sql)
      result.message || "#{result.row_count} rows"
    end

    # Insert a row into a table.
    def insert(table, data)
      cols = data.keys.join(", ")
      vals = data.values.map { |v| format_value(v) }.join(", ")
      exec("INSERT INTO #{table} (#{cols}) VALUES (#{vals});")
    end

    # Select rows from a table.
    def select(table, columns: "*", where: nil, order_by: nil, limit: nil)
      sql = "SELECT #{columns} FROM #{table}"
      sql += " WHERE #{where}" if where
      sql += " ORDER BY #{order_by}" if order_by
      sql += " LIMIT #{limit}" if limit
      query(sql + ";")
    end

    # Update rows in a table.
    def update(table, set, where: nil)
      set_clause = set.map { |k, v| "#{k} = #{format_value(v)}" }.join(", ")
      sql = "UPDATE #{table} SET #{set_clause}"
      sql += " WHERE #{where}" if where
      exec(sql + ";")
    end

    # Delete rows from a table.
    def delete(table, where: nil)
      sql = "DELETE FROM #{table}"
      sql += " WHERE #{where}" if where
      exec(sql + ";")
    end

    # Create a prepared statement on the server.
    def prepare(name, query_str)
      result = query("PREPARE #{name} AS #{query_str}")
      result.message
    end

    # Execute a previously prepared statement with arguments.
    def execute_prepared(name, *args)
      quoted = args.map { |a| format_value(a.is_a?(String) ? a : a.to_s) }.join(", ")
      query("EXECUTE #{name} (#{quoted})")
    end

    # Remove a prepared statement from the server.
    def deallocate(name)
      result = query("DEALLOCATE #{name}")
      result.message
    end

    # List all tables.
    def show_tables
      result = query("SHOW TABLES;")
      return [] if result.rows.nil?
      result.rows.map { |row| row[0] }
    end

    # Health check.
    def ping
      query("SHOW TABLES;")
      true
    rescue StandardError
      false
    end

    # -- transactions --------------------------------------------------------

    # Start a transaction.
    def begin
      query("BEGIN")
    end

    # Commit the current transaction.
    def commit
      query("COMMIT")
    end

    # Roll back the current transaction.
    def rollback
      query("ROLLBACK")
    end

    # Execute a block inside a transaction.
    # On success the transaction is committed; on error it is rolled back.
    def transaction
      self.begin
      result = yield(self)
      self.commit
      result
    rescue => e
      self.rollback
      raise e
    end

    # -- batch insert --------------------------------------------------------

    # Insert multiple rows in a single statement.
    def insert_many(table, columns, rows)
      vals = rows.map { |r| "(#{r.map { |v| "'#{v.to_s.gsub("'", "''")}'" }.join(', ')})" }.join(', ')
      query("INSERT INTO #{table} (#{columns.join(', ')}) VALUES #{vals}")
    end

    # -- cache ---------------------------------------------------------------

    # Set a cache key with an optional TTL (seconds).
    def cache_set(key, value, ttl = 0)
      val = value.is_a?(Hash) || value.is_a?(Array) ? JSON.generate(value) : "'#{value}'"
      sql = "CACHE SET '#{key}' #{val}"
      sql += " TTL #{ttl}" if ttl > 0
      query(sql + ";")
    end

    # Get a cache value.
    def cache_get(key)
      query("CACHE GET '#{key}';")
    end

    # Delete a cache key.
    def cache_del(key)
      query("CACHE DEL '#{key}';")
    end

    # List cache keys matching a pattern.
    def cache_keys(pattern = "*")
      query("CACHE KEYS '#{pattern}';")
    end

    # -- search --------------------------------------------------------------

    # Full-text search on a table.
    def search(table, search_query, fuzzy = 0)
      sql = "SEARCH #{table} MATCH '#{search_query}'"
      sql += " FUZZY #{fuzzy}" if fuzzy > 0
      query(sql + ";")
    end

    # -- graph ---------------------------------------------------------------

    # Add a node to the graph.
    def graph_add_node(id, label, props = {})
      sql = "GRAPH ADD NODE '#{id}' LABEL '#{label}'"
      sql += " PROPERTIES #{JSON.generate(props)}" unless props.empty?
      query(sql + ";")
    end

    # Add an edge between two nodes.
    def graph_add_edge(from_id, to_id, edge_type)
      query("GRAPH ADD EDGE '#{from_id}' -> '#{to_id}' TYPE '#{edge_type}';")
    end

    # Breadth-first search from a start node.
    def graph_bfs(start, depth = 3)
      query("GRAPH BFS '#{start}' DEPTH #{depth};")
    end

    # -- auto-reconnect ------------------------------------------------------

    # Attempt to reconnect to the server.
    def reconnect(max_retries = 3)
      max_retries.times do |i|
        begin
          connect
          return true
        rescue => e
          sleep(i + 1)
        end
      end
      raise ConnectionError, "Failed to reconnect after #{max_retries} attempts"
    end

    # Close the connection.
    def close
      return if @socket.nil? || @socket.closed?

      @socket.write("QUIT\n") rescue nil
      @socket.close rescue nil
    end

    private

    def connect
      @socket = TCPSocket.new(@host, @port)
      @socket.setsockopt(Socket::SOL_SOCKET, Socket::SO_RCVTIMEO,
        [@timeout, 0].pack("l_2"))
      @socket.setsockopt(Socket::SOL_SOCKET, Socket::SO_SNDTIMEO,
        [@timeout, 0].pack("l_2"))

      # Read and discard welcome banner
      @socket.gets

      # STARTTLS upgrade
      if @tls
        @socket.write("STARTTLS\n")
        response = @socket.gets
        raise ConnectionError, "Connection closed during STARTTLS" if response.nil?

        data = JSON.parse(response.strip)
        raise ConnectionError, "STARTTLS failed: #{data['error']}" if data["error"]

        ssl_context = OpenSSL::SSL::SSLContext.new
        if @tls_verify
          ssl_context.verify_mode = OpenSSL::SSL::VERIFY_PEER
        else
          ssl_context.verify_mode = OpenSSL::SSL::VERIFY_NONE
        end

        ssl_socket = OpenSSL::SSL::SSLSocket.new(@socket, ssl_context)
        ssl_socket.hostname = @host
        ssl_socket.connect
        @socket = ssl_socket
      end

      # AUTH
      if @username
        @socket.write("AUTH #{@username} #{@password}\n")
        response = @socket.gets
        raise ConnectionError, "Connection closed during AUTH" if response.nil?

        data = JSON.parse(response.strip)
        raise AuthError, "Authentication failed: #{data['error']}" if data["error"]
      end
    end

    # SQL-standard single-quote doubling. Earlier revisions used
    # `gsub("'", "\\\\'")` which produced backslash-escaped quotes (`\'`)
    # — that is a MySQL-ism that VedaDB does not accept and that turns
    # `O'Brien` into the syntax error `'O\'Brien'`.
    def format_value(value)
      case value
      when nil then "NULL"
      when String then "'#{value.gsub("'", "''")}'"
      when true then "TRUE"
      when false then "FALSE"
      else value.to_s
      end
    end
  end

  # ConnectionError, QueryError, TimeoutError live in errors.rb. Defining
  # them here a second time as `< StandardError` raises
  # "superclass mismatch for class ConnectionError" because errors.rb
  # already inherits them from VedaDB::Error. AuthError was the only
  # one missing — add it to the canonical hierarchy instead.
  class AuthError < Error; end
end
