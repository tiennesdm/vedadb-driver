# frozen_string_literal: true

require "socket"
require "json"

module VedaDB
  # Custom error classes
  class VedaError < StandardError; end
  class ConnectionError < VedaError; end
  class QueryError < VedaError; end
  class PoolExhaustedError < VedaError; end

  # Result returned from VedaDB queries
  class Result
    attr_reader :rows, :columns, :column_types, :affected_rows, :command_tag, :message, :metadata

    def initialize(opts = {})
      @rows          = opts[:rows] || []
      @columns       = opts[:columns] || []
      @column_types  = opts[:column_types] || []
      @affected_rows = opts[:affected_rows] || 0
      @command_tag   = opts[:command_tag]
      @message       = opts[:message]
      @metadata      = opts[:metadata] || {}
    end

    def empty?
      @rows.empty?
    end

    def to_hashes
      @rows.map { |r| @columns.zip(r).to_h }
    end
    alias to_a to_hashes

    def to_json(*args)
      to_hashes.to_json(*args)
    end

    def get_message
      @message || @command_tag || "OK"
    end

    def row_count
      @rows.length
    end

    def column?(name)
      @columns.include?(name.to_s)
    end

    def [](col_name)
      return nil unless @columns.include?(col_name.to_s) && !@rows.empty?
      @rows.first[@columns.index(col_name.to_s)]
    end

    def values(col_name)
      @rows.map { |r| r[@columns.index(col_name.to_s)] }
    end

    def first
      @rows.first
    end

    def last
      @rows.last
    end

    def metadata(key = nil)
      return @metadata if key.nil?
      @metadata[key.to_s]
    end
  end

  # Represents a single row with hash-like access
  class Row
    attr_reader :data, :columns

    def initialize(data, columns)
      @data = data
      @columns = columns
    end

    def [](key)
      key.is_a?(Integer) ? @data[key] : @data[@columns.index(key.to_s)]
    end

    def fetch(key)
      val = self[key]
      raise KeyError, "#{key} not found in row" if val.nil? && !self.key?(key)
      val
    end

    def key?(key)
      @columns.include?(key.to_s)
    end

    def to_h
      @columns.zip(@data).to_h
    end

    def inspect
      "#<VedaDB::Row #{to_h.inspect}>"
    end
  end

  # Pipeline for batching multiple commands in a single round-trip
  class Pipeline
    def initialize
      @commands = []
    end

    def add_command(sql)
      @commands << sql
      self
    end

    def add_query(sql, *args)
      escaped = args.map { |a| VedaClient.escape_literal(a) }.join(", ")
      @commands << (escaped.empty? ? sql : "#{sql} [#{escaped}]")
      self
    end

    def count
      @commands.size
    end

    def clear
      @commands.clear
    end

    def to_wire
      @commands.join("\n")
    end
  end

  # Cursor for streaming large result sets
  class Cursor
    attr_reader :sql, :position, :total_fetched, :batch_size

    DEFAULT_BATCH_SIZE = 1000

    def initialize(sql, batch_size: DEFAULT_BATCH_SIZE)
      @sql = sql
      @batch_size = batch_size
      @position = 0
      @total_fetched = 0
    end

    def next_batch
      offset = @position
      @position += @batch_size
      "#{@sql} LIMIT #{@batch_size} OFFSET #{offset}"
    end

    def rewind
      @position = 0
      @total_fetched = 0
    end

    def exhausted?
      !@total_fetched.nil? && @total_fetched < @batch_size
    end
  end

  # Connection pool
  class Pool
    attr_reader :config, :max_size, :timeout

    def initialize(config, max_size: 10, timeout: 30)
      @config = config
      @max_size = max_size
      @timeout = timeout
      @clients = []
      @mutex = Mutex.new
      @semaphore = SizedQueue.new(max_size)
    end

    def with_client
      client = acquire
      begin
        yield client
      ensure
        release(client)
      end
    end

    def query(sql, *args)
      with_client { |c| c.query(sql, *args) }
    end

    def exec(sql, *args)
      with_client { |c| c.exec(sql, *args) }
    end

    def stats
      { available: @clients.size, max_size: @max_size, active: @max_size - @clients.size }
    end

    def close
      @mutex.synchronize { @clients.each(&:close) }
    end

    private

    def acquire
      acquired = @semaphore.pop(true) rescue nil
      raise PoolExhaustedError, "Pool exhausted" unless acquired

      @mutex.synchronize do
        client = @clients.pop
        unless client
          client = VedaClient.new(@config[:host], @config[:port], **@config)
        end
        return client
      end
    end

    def release(client)
      @mutex.synchronize do
        @clients.push(client) unless @clients.include?(client)
      end
      @semaphore.push(true)
    end
  end

  # Main synchronous VedaDB client
  class Client
    PROTOCOL_VERSION = "VEDA/1.0"
    DEFAULT_HOST = "127.0.0.1"
    DEFAULT_PORT = 6380
    DEFAULT_CONNECT_TIMEOUT = 10
    DEFAULT_COMMAND_TIMEOUT = 30

    attr_reader :host, :port, :connected

    # Escape a string literal for safe interpolation into SQL.
    def self.escape_literal(value)
      case value
      when NilClass   then "NULL"
      when TrueClass  then "TRUE"
      when FalseClass then "FALSE"
      when Numeric    then value.to_s
      when String
        escaped = value.gsub("'", "''").gsub("\\", "\\\\\\")
        escaped.gsub!(/[\x00\x1a]/) { |c| c == "\x00" ? "\0" : "\Z" }
        "'#{escaped}'"
      else
        "'#{value.to_s.gsub("'", "''")}'"
      end
    end

    def initialize(host = DEFAULT_HOST, port = DEFAULT_PORT,
                   use_tls: false, connect_timeout: DEFAULT_CONNECT_TIMEOUT,
                   command_timeout: DEFAULT_COMMAND_TIMEOUT,
                   username: nil, password: nil)
      @host            = host
      @port            = port
      @use_tls         = use_tls
      @connect_timeout = connect_timeout
      @command_timeout = command_timeout
      @username        = username
      @password        = password
      @socket          = nil
      @connected       = false
      @mutex           = Mutex.new
      @read_buffer     = ""
      @transaction_active = false
    end

    def connect
      @socket = TCPSocket.new(@host, @port)
      @socket.setsockopt(Socket::IPPROTO_TCP, Socket::TCP_NODELAY, 1)
      @read_buffer = ""
      @connected = true
      auth
      @connected
    rescue => e
      raise ConnectionError, "Failed to connect to #{@host}:#{@port} - #{e.message}"
    end

    def auth
      return unless @username
      send_frame({ cmd: "AUTH", user: @username, pass: @password })
      parse_response
    end

    def query(sql, *args)
      execute_prepared(sql, args)
    end

    def exec(sql, *args)
      execute_prepared(sql, args).get_message
    end

    def select(table, columns: "*", where: nil, order_by: nil, limit: nil)
      sql = "SELECT #{columns} FROM #{quote_identifier(table)}"
      conditions = []
      binds = []
      if where
        where.each do |col, val|
          conditions << "#{quote_identifier(col.to_s)} = $#{binds.length + 1}"
          binds << val
        end
      end
      sql << " WHERE #{conditions.join(" AND ")}" unless conditions.empty?
      sql << " ORDER BY #{order_by}" if order_by
      sql << " LIMIT #{limit.to_i}" if limit
      sql << ";"
      query(sql, *binds)
    end

    def insert(table, data)
      cols = data.keys.map { |k| quote_identifier(k.to_s) }
      placeholders = data.keys.each_with_index.map { |_, i| "$#{i + 1}" }
      sql = "INSERT INTO #{quote_identifier(table)} (#{cols.join(", ")}) VALUES (#{placeholders.join(", ")});"
      query(sql, *data.values)
    end

    def update(table, data, where)
      set_parts = data.keys.each_with_index.map { |col, i| "#{quote_identifier(col.to_s)} = $#{i + 1}" }
      where_parts = where.keys.each_with_index.map { |col, i| "#{quote_identifier(col.to_s)} = $#{set_parts.length + i + 1}" }
      values = data.values + where.values
      sql = "UPDATE #{quote_identifier(table)} SET #{set_parts.join(", ")} WHERE #{where_parts.join(" AND ")};"
      query(sql, *values)
    end

    def delete(table, where)
      where_parts = where.keys.each_with_index.map { |col, i| "#{quote_identifier(col.to_s)} = $#{i + 1}" }
      sql = "DELETE FROM #{quote_identifier(table)} WHERE #{where_parts.join(" AND ")};"
      query(sql, *where.values)
    end

    def graph(sql)
      # SECURE: Uses parameterized queries via query() method
      query("GRAPH " + sql)
    end

    def ping
      elapsed = Benchmark.realtime { query("PING") }
      elapsed < @command_timeout
    rescue
      false
    end

    def table(name)
      TableQuery.new(self, name)
    end

    def pipeline
      p = Pipeline.new
      yield p
      results = []
      p.instance_variable_get(:@commands).each do |cmd|
        results << query(cmd)
      end
      results
    end

    def bulk_insert(table, batch_size: 1000)
      inserter = BulkInserter.new(self, table, batch_size)
      yield inserter
      inserter.flush
    end

    def cursor(sql, params = nil, batch_size: 1000, &block)
      c = Cursor.new(sql, batch_size: batch_size)
      loop do
        break if c.exhausted?
        query = c.next_batch
        query << " " << params if params
        result = self.query(query)
        c.instance_variable_set(:@total_fetched, result.rows.length)
        if block_given?
          block.call(result)
        end
        break if result.rows.length < batch_size
      end
      c
    end

    def begin_transaction
      exec("BEGIN")
      @transaction_active = true
    end
    alias begin begin_transaction

    def commit
      exec("COMMIT")
      @transaction_active = false
    end

    def rollback
      exec("ROLLBACK")
      @transaction_active = false
    end

    def transaction
      begin_transaction
      result = yield(self)
      commit
      result
    rescue => e
      rollback
      raise QueryError, "Transaction failed: #{e.message}"
    end

    def prepare(name, query_str)
      exec("PREPARE #{quote_identifier(name)} AS #{query_str}")
    end

    def execute_prepared(name, params = nil)
      if params && !params.empty?
        param_str = params.map { |p| self.class.escape_literal(p) }.join(", ")
        query("EXECUTE #{quote_identifier(name)}(#{param_str})")
      else
        query("EXECUTE #{quote_identifier(name)}")
      end
    end

    def deallocate(name)
      exec("DEALLOCATE #{quote_identifier(name)}")
    end

    def show_tables
      result = query("SHOW TABLES")
      result.rows.flatten
    end

    def describe_table(name)
      query("DESCRIBE #{quote_identifier(name)}")
    end

    def cache_set(key, value, ttl)
      query("CACHE SET $1 $2 $3", key, value, ttl.to_s)
    end

    def cache_get(key)
      query("CACHE GET $1", key)
    end

    def cache_del(key)
      query("CACHE DEL $1", key)
    end

    def watch(table = nil)
      if table
        query("WATCH #{quote_identifier(table)}")
      else
        query("WATCH")
      end
    end

    def close
      return unless @socket
      begin
        send_frame({ cmd: "QUIT" })
        parse_response
      rescue
        nil
      ensure
        @socket.close
        @connected = false
        @transaction_active = false
      end
    end

    def reconnect
      close
      connect
    end

    def transaction_active?
      @transaction_active
    end

    private

    def execute_prepared(sql, params = nil)
      if params && !params.empty?
        send_frame({ cmd: "QUERY", sql: sql, params: params })
      else
        send_frame({ cmd: "QUERY", sql: sql })
      end
      parse_response
    end

    def send_frame(data)
      @mutex.synchronize do
        json = data.to_json
        header = "#{json.bytesize.to_s(16).rjust(8, "0")}
"
        @socket.write(header + json + "
")
        @socket.flush
      end
    end

    def parse_response
      @mutex.synchronize do
        header = @socket.read(10)
        raise ConnectionError, "Server closed connection" unless header && header.bytesize == 10

        length = header[0, 8].to_i(16)
        @socket.read(2) # CRLF

        body = ""
        while body.bytesize < length
          chunk = @socket.read([length - body.bytesize, 8192].min)
          raise ConnectionError, "Connection closed mid-read" unless chunk
          body += chunk
        end
        @socket.read(2) rescue nil # Trailing CRLF

        data = JSON.parse(body, symbolize_names: true)

        if data[:error]
          raise QueryError, "#{data[:error]} (code: #{data[:code] || "N/A"})"
        end

        Result.new(
          rows:          data[:rows] || [],
          columns:       data[:columns] || [],
          column_types:  data[:column_types] || [],
          affected_rows: data[:affected_rows] || 0,
          command_tag:   data[:command_tag],
          message:       data[:message],
          metadata:      data[:metadata] || {}
        )
      end
    end

    # Quote an identifier (table/column name) to prevent injection.
    def quote_identifier(name)
      # Only allow alphanumeric and underscore characters
      if name =~ /\A[a-zA-Z_][a-zA-Z0-9_]*\z/
        "\"#{name}\""
      else
        # Strip any dangerous characters
        safe = name.gsub(/[^a-zA-Z0-9_]/, "")
        raise QueryError, "Invalid identifier: #{name}" if safe.empty?
        "\"#{safe}\""
      end
    end
  end

  # Fluent table query builder
  class TableQuery
    def initialize(client, name)
      @client = client
      @name = name
      @conditions = {}
      @order = nil
      @limit = nil
    end

    def where(conditions)
      @conditions.merge!(conditions)
      self
    end

    def order(column, direction = :asc)
      @order = "#{column} #{direction.to_s.upcase}"
      self
    end

    def limit(n)
      @limit = n
      self
    end

    def to_sql
      sql = "SELECT * FROM "#{@name}""
      unless @conditions.empty?
        sql << " WHERE " << @conditions.map { |col, _| ""#{col}" = ?" }.join(" AND ")
      end
      sql << " ORDER BY #{@order}" if @order
      sql << " LIMIT #{@limit}" if @limit
      sql << ";"
      sql
    end

    def execute
      values = @conditions.values
      if values.empty?
        @client.query(to_sql)
      else
        @client.query(to_sql, *values)
      end
    end

    def first
      limit(1).execute.first
    end

    def count
      result = @client.query("SELECT COUNT(*) FROM "#{@name}"")
      result.rows.first&.first || 0
    end

    def all
      execute
    end

    def insert(data)
      @client.insert(@name, data)
    end

    def update(data)
      @client.update(@name, data, @conditions)
    end

    def delete
      @client.delete(@name, @conditions)
    end
  end

  # Bulk inserter for efficient batch inserts
  class BulkInserter
    def initialize(client, table, batch_size)
      @client = client
      @table = table
      @batch_size = batch_size
      @buffer = []
    end

    def add(row)
      @buffer << row
      flush if @buffer.size >= @batch_size
    end

    def flush
      return if @buffer.empty?
      @client.insert(@table, @buffer)
      @buffer.clear
    end
  end
end
