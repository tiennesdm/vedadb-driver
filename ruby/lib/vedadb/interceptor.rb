# frozen_string_literal: true

module VedaDB
  # Middleware / interceptor pipeline for VedaDB operations.
  #
  # Each interceptor implements `#call(env, &block)` where `env` is a Hash
  # with keys like :operation, :sql, :client, :start_time, etc.
  #
  # Built-in interceptors:
  #   VedaDB::Interceptor::Logging   -> logs every query
  #   VedaDB::Interceptor::Timing    -> records timing metrics
  #   VedaDB::Interceptor::Retry     -> adds retry logic
  #   VedaDB::Interceptor::Circuit   -> wraps with circuit breaker
  #   VedaDB::Interceptor::Cache     -> query-level caching
  #   VedaDB::Interceptor::Validate  -> validates SQL before sending
  #
  # Usage:
  #   client = VedaDB::Client.new("localhost", 6380)
  #   client.use VedaDB::Interceptor::Logging.new(logger: Logger.new($stdout))
  #   client.use VedaDB::Interceptor::Timing.new(metrics: my_metrics)
  class Interceptor
    attr_reader :interceptors

    def initialize
      @interceptors = []
    end

    # Register an interceptor.  Interceptors are invoked in registration order.
    def use(interceptor)
      @interceptors << interceptor
      self
    end

    # Remove all interceptors.
    def clear
      @interceptors.clear
      self
    end

    # Execute a block through the full interceptor chain.
    #
    # @param env [Hash] operation context
    # @yield the actual operation
    # @return the block's return value
    def run(env = {})
      chain = build_chain(@interceptors.dup, proc { yield })
      chain.call(env)
    end

    private

    def build_chain(interceptors, final)
      interceptors.reverse.reduce(final) do |nxt, interceptor|
        proc { |env| interceptor.call(env, &nxt) }
      end
    end

    # ------------------------------------------------------------------
    # Built-in interceptors
    # ------------------------------------------------------------------

    # Log every query at INFO level.
    class Logging
      def initialize(logger: nil, level: :info)
        @logger = logger || default_logger
        @level  = level
      end

      def call(env)
        sql = env[:sql] || env[:query]
        @logger.public_send(@level) { "[VedaDB] #{env[:operation]} | #{sql}" }
        yield env
      rescue StandardError => e
        @logger.error { "[VedaDB] ERROR #{env[:operation]}: #{e.class}: #{e.message}" }
        raise
      end

      private

      def default_logger
        require "logger"
        Logger.new($stdout)
      end
    end

    # Record timing for every operation.
    class Timing
      def initialize(metrics: nil, callback: nil)
        @metrics  = metrics
        @callback = callback
      end

      def call(env)
        start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        result = yield env
        duration = Process.clock_gettime(Process::CLOCK_MONOTONIC) - start

        env[:duration] = duration
        @metrics&.query_executed(duration: duration, success: true)
        @callback&.call(env.merge(success: true))

        result
      rescue StandardError => e
        duration = Process.clock_gettime(Process::CLOCK_MONOTONIC) - start if start
        env[:duration] = duration
        @metrics&.query_executed(duration: duration || 0, success: false)
        @callback&.call(env.merge(success: false, error: e))
        raise
      end
    end

    # Retry failed operations.
    class Retry
      def initialize(max: 3, base: 0.1, on: [ConnectionError])
        @retry = VedaDB::Retry.new(max: max, base: base, on: on)
      end

      def call(env)
        @retry.call { yield env }
      end
    end

    # Circuit breaker wrapper.
    class Circuit
      def initialize(breaker: nil)
        @breaker = breaker || VedaDB::CircuitBreaker.new
      end

      def call(env)
        @breaker.call { yield env }
      end
    end

    # Query-level caching interceptor.
    class Cache
      def initialize(cache_store, ttl: 60)
        @cache = cache_store
        @ttl   = ttl
      end

      def call(env)
        sql = env[:sql] || env[:query]

        unless sql && sql.match?(/^\s*SELECT/i)
          return yield env
        end

        key = "vedadb:query:#{Digest::SHA256.hexdigest(sql)}"
        cached = @cache.get(key)
        return cached if cached

        result = yield env
        @cache.set(key, result, @ttl)
        result
      end
    end

    # Validate SQL before sending.
    class Validate
      def initialize
        @forbidden = %w[DROP DATABASE SHUTDOWN EXEC xp_ sp_]
      end

      def call(env)
        sql = env[:sql] || env[:query]

        if sql
          @forbidden.each do |pattern|
            if sql.upcase.include?(pattern)
              raise QueryError, "Forbidden SQL pattern detected: #{pattern}"
            end
          end
        end

        yield env
      end
    end

    # Metrics collection interceptor.
    class MetricsCollector
      def initialize(metrics)
        @metrics = metrics
      end

      def call(env)
        @metrics.connection_event(event: "open") if env[:operation] == :connect

        start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        result = yield env
        duration = Process.clock_gettime(Process::CLOCK_MONOTONIC) - start

        @metrics.query_executed(duration: duration, success: true)
        result
      rescue StandardError
        @metrics.query_executed(duration: 0, success: false)
        raise
      end
    end
  end
end
