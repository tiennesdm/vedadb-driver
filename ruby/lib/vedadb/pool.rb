# frozen_string_literal: true

require "thread"

module VedaDB
  # Thread-safe connection pool for VedaDB.
  #
  # Usage:
  #   pool = VedaDB::Pool.new("localhost", 6380, max_size: 10)
  #
  #   # with_connection block (recommended)
  #   pool.with_connection do |client|
  #     result = client.query("SELECT * FROM users;")
  #   end
  #
  #   # Manual acquire/release
  #   client = pool.acquire
  #   begin
  #     result = client.query("SELECT * FROM users;")
  #   ensure
  #     pool.release(client)
  #   end
  #
  #   # Pool stats
  #   puts pool.stats
  #   pool.close
  class Pool
    attr_reader :host, :port, :max_size, :timeout, :created_count

    def initialize(host = "localhost", port = 6380, max_size: 10, timeout: 30,
                   tls: false, username: nil, password: nil)
      @host           = host
      @port           = port
      @max_size       = max_size
      @timeout        = timeout
      @tls            = tls
      @username       = username
      @password       = password
      @idle           = []
      @mutex          = Mutex.new
      @condition      = ConditionVariable.new
      @active_count   = 0
      @created_count  = 0
      @closed         = false
      @wait_timeout   = 5.0
    end

    # Acquire a client from the pool.
    #
    # @return [Client]
    # @raise [PoolError] if the pool is closed or exhausted
    def acquire
      deadline = Time.now + @wait_timeout

      @mutex.synchronize do
        raise PoolError, "Pool is closed" if @closed

        loop do
          # Return an idle client if available
          client = @idle.pop
          if client
            @active_count += 1
            return client
          end

          # Create a new client if under max_size
          if @created_count < @max_size
            @active_count  += 1
            @created_count += 1
            return create_client
          end

          # Wait for a client to be released
          remaining = deadline - Time.now
          raise PoolError, "Pool exhausted (max_size=#{@max_size})" if remaining <= 0

          @condition.wait(@mutex, remaining)
        end
      end
    end

    # Release a client back to the pool.
    #
    # @param client [Client]
    def release(client)
      @mutex.synchronize do
        @active_count -= 1

        if @closed
          client.close
        elsif !client.ping
          # Don't return dead connections to the pool
          @created_count -= 1
          client.close
        else
          @idle.push(client)
          @condition.signal
        end
      end
    end

    # Execute a block with an auto-acquired/released client.
    #
    # @yieldparam client [Client]
    # @return block's return value
    def with(&block)
      client = acquire
      begin
        yield client
      ensure
        release(client)
      end
    end

    # Alias for with — connection pool standard naming.
    alias with_connection with

    # Execute a query using a pooled client.
    def query(sql)
      with { |client| client.query(sql) }
    end

    # Execute a statement using a pooled client.
    def exec(sql)
      with { |client| client.exec(sql) }
    end

    # Ping the pool (checks an idle connection).
    def ping
      with(&:ping)
    rescue StandardError
      false
    end

    def active_count
      @mutex.synchronize { @active_count }
    end

    def idle_count
      @mutex.synchronize { @idle.size }
    end

    # Pool statistics.
    def stats
      @mutex.synchronize do
        {
          max_size: @max_size,
          active: @active_count,
          idle: @idle.size,
          created: @created_count,
          available: @max_size - @active_count,
          closed: @closed,
        }
      end
    end

    # Shrink the pool to +target+ idle connections.
    def shrink(target = 0)
      @mutex.synchronize do
        while @idle.size > target
          client = @idle.pop
          client&.close
          @created_count -= 1
        end
      end
    end

    # Reap (close) connections that fail a health check.
    def reap
      @mutex.synchronize do
        @idle.reject! do |client|
          begin
            client.ping
            false
          rescue StandardError
            client.close rescue nil
            @created_count -= 1
            true
          end
        end
      end
    end

    # Close all connections and mark the pool as closed.
    def close
      @mutex.synchronize do
        @closed = true
        @idle.each(&:close)
        @idle.clear
        @active_count = 0
        @created_count = 0
        @condition.broadcast
      end
    end

    def closed?
      @mutex.synchronize { @closed }
    end

    private

    def create_client
      Client.new(@host, @port,
                 timeout: @timeout,
                 tls: @tls,
                 username: @username,
                 password: @password)
    end
  end
end
