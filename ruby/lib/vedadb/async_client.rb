# frozen_string_literal: true

require 'concurrent'

module VedaDB
  # Async wrapper around VedaDB::Client using concurrent-ruby gem.
  # All methods return Concurrent::Promise or use thread pools.
  #
  # @example
  #   client = VedaDB::Client.new("localhost", 6380)
  #   async = VedaDB::AsyncClient.new(client)
  #
  #   promise = async.query("SELECT * FROM users;")
  #   promise.on_success { |result| puts result.rows }
  #   promise.wait
  class AsyncClient
    attr_reader :client, :executor

    def initialize(client, max_threads: 10)
      @client = client
      @executor = Concurrent::ThreadPoolExecutor.new(
        min_threads: 1,
        max_threads: max_threads,
        max_queue: 100,
        fallback_policy: :caller_runs
      )
      @promise_pool = Concurrent::CachedThreadPool.new
    end

    # Execute a query asynchronously, returning a Concurrent::Promise.
    def query(sql)
      Concurrent::Promise.execute(executor: @executor) do
        @client.query(sql)
      end
    end

    # Execute a DDL/DML statement asynchronously.
    def exec(sql)
      Concurrent::Promise.execute(executor: @executor) do
        @client.exec(sql)
      end
    end

    # Alias for exec.
    alias execute exec

    # Insert a row asynchronously.
    def insert(table, data)
      Concurrent::Promise.execute(executor: @executor) do
        @client.insert(table, data)
      end
    end

    # Select rows asynchronously.
    def select(table, columns: "*", where: nil, order_by: nil, limit: nil)
      Concurrent::Promise.execute(executor: @executor) do
        @client.select(table, columns: columns, where: where, order_by: order_by, limit: limit)
      end
    end

    # Ping asynchronously.
    def ping
      Concurrent::Promise.execute(executor: @executor) do
        @client.ping
      end
    end

    # Begin transaction asynchronously.
    def begin_transaction
      Concurrent::Promise.execute(executor: @executor) do
        @client.begin_transaction
      end
    end
    alias begin begin_transaction

    # Commit asynchronously.
    def commit
      Concurrent::Promise.execute(executor: @executor) do
        @client.commit
      end
    end

    # Rollback asynchronously.
    def rollback
      Concurrent::Promise.execute(executor: @executor) do
        @client.rollback
      end
    end

    # Execute a block inside a transaction asynchronously.
    def transaction
      Concurrent::Promise.execute(executor: @executor) do
        @client.transaction { yield(@client) }
      end
    end

    # Show tables asynchronously.
    def show_tables
      Concurrent::Promise.execute(executor: @executor) do
        @client.show_tables
      end
    end

    # Describe table asynchronously.
    def describe_table(table)
      Concurrent::Promise.execute(executor: @executor) do
        @client.describe_table(table)
      end
    end

    # Pipeline asynchronously.
    def pipeline
      Concurrent::Promise.execute(executor: @executor) do
        @client.pipeline { |p| yield(p) }
      end
    end

    # Bulk insert asynchronously.
    def bulk_insert(table, batch_size: 1000)
      Concurrent::Promise.execute(executor: @executor) do
        @client.bulk_insert(table, batch_size: batch_size) { |b| yield(b) }
      end
    end

    # Cursor asynchronously.
    def cursor(sql, params = nil, **opts)
      Concurrent::Promise.execute(executor: @executor) do
        @client.cursor(sql, params, **opts) { |c| yield(c) }
      end
    end

    # Change stream (async).
    def watch(table = nil)
      Concurrent::Promise.execute(executor: @executor) do
        @client.watch(table)
      end
    end

    # Close the async client and executor.
    def close
      @executor.shutdown
      @executor.wait_for_termination(timeout: 5)
      @promise_pool.shutdown
      @promise_pool.wait_for_termination(timeout: 5)
      @client.close
    end

    # Wait for all pending promises to complete.
    def wait_for_all(promises, timeout: 30)
      completed = promises.map { |p| p.wait(timeout) }
      failed = completed.select(&:rejected?)
      raise failed.first.reason unless failed.empty?
      completed.map(&:value)
    end
  end

  # Async connection pool using Concurrent::ThreadPoolExecutor.
  class AsyncPool
    attr_reader :config, :max_size, :timeout

    def initialize(config, max_size: 10, timeout: 30)
      @config = config
      @max_size = max_size
      @timeout = timeout
      @pool = Concurrent::ThreadPoolExecutor.new(
        min_threads: 1,
        max_threads: max_size,
        max_queue: max_size * 2,
        fallback_policy: :caller_runs
      )
      @clients = Concurrent::Array.new
      @semaphore = Concurrent::Semaphore.new(max_size)
    end

    # Acquire a client from the pool with timeout.
    def acquire
      acquired = @semaphore.try_acquire(@timeout)
      raise ConnectionError, "Pool exhausted: could not acquire client" unless acquired

      client = @clients.shift
      unless client
        client = Client.new(@config[:host], @config[:port], **@config)
      end
      yield client
    ensure
      @clients.push(client) if client
      @semaphore.release if acquired
    end

    # Execute a block with a pooled client asynchronously.
    def with_client
      Concurrent::Promise.execute(executor: @pool) do
        acquire { |client| yield(client) }
      end
    end

    # Query using a pooled client.
    def query(sql)
      with_client { |client| client.query(sql) }
    end

    # Execute using a pooled client.
    def exec(sql)
      with_client { |client| client.exec(sql) }
    end

    # Current pool stats.
    def stats
      {
        available: @clients.size,
        max_size: @max_size,
        active_threads: @pool.current_length,
        queue_size: @pool.scheduled_task_count - @pool.completed_task_count
      }
    end

    # Close all pooled connections.
    def close
      @clients.each(&:close)
      @clients.clear
      @pool.shutdown
      @pool.wait_for_termination(timeout: @timeout)
    end
  end
end
