# frozen_string_literal: true

module VedaDB
  # Thread-safe connection pool for VedaDB.
  #
  # Usage:
  #   pool = VedaDB::Pool.new("localhost", 6380, max_size: 10)
  #   client = pool.acquire
  #   begin
  #     result = client.query("SELECT * FROM users;")
  #   ensure
  #     pool.release(client)
  #   end
  #   pool.close
  class Pool
    def initialize(host = "localhost", port = 6380, max_size: 10, timeout: 30)
      @host = host
      @port = port
      @max_size = max_size
      @timeout = timeout
      @idle = []
      @mutex = Mutex.new
      @active_count = 0
      @closed = false
    end

    # Acquire a client from the pool.
    def acquire
      @mutex.synchronize do
        raise Error, "Pool is closed" if @closed

        client = @idle.pop
        if client
          @active_count += 1
          return client
        end
      end

      client = Client.new(@host, @port, timeout: @timeout)
      @mutex.synchronize { @active_count += 1 }
      client
    end

    # Release a client back to the pool.
    def release(client)
      @mutex.synchronize do
        @active_count -= 1

        if @closed || @idle.size >= @max_size
          client.close
        else
          @idle.push(client)
        end
      end
    end

    # Execute a block with an auto-acquired/released client.
    def with
      client = acquire
      begin
        yield client
      ensure
        release(client)
      end
    end

    def active_count
      @mutex.synchronize { @active_count }
    end

    def idle_count
      @mutex.synchronize { @idle.size }
    end

    # Close all idle connections.
    def close
      @mutex.synchronize do
        @closed = true
        @idle.each(&:close)
        @idle.clear
      end
    end
  end
end
