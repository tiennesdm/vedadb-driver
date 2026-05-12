# frozen_string_literal: true

module VedaDB
  # Prometheus-compatible metrics collector.
  #
  # Emits text in the Prometheus exposition format:
  #   # HELP vedadb_queries_total Total queries executed
  #   # TYPE vedadb_queries_total counter
  #   vedadb_queries_total{status="success"} 42
  #
  # Usage:
  #   metrics = VedaDB::Metrics.new
  #   metrics.query_executed(0.015, success: true)
  #   puts metrics.render
  class Metrics
    DEFAULT_NAMESPACE = "vedadb"

    attr_reader :namespace

    def initialize(namespace: DEFAULT_NAMESPACE)
      @namespace = namespace
      @mutex = Mutex.new
      reset!
    end

    # Record a query execution.
    #
    # @param duration [Float]  execution time in seconds
    # @param success  [Boolean] whether the query succeeded
    def query_executed(duration:, success:)
      @mutex.synchronize do
        label = success ? "success" : "failure"
        @queries_total[label] += 1
        @query_duration_sum += duration
        @query_duration_count += 1
        bucket = duration_buckets.find { |b| duration <= b }
        bucket_key = bucket || "+Inf"
        @query_duration_buckets[bucket_key] += 1
      end
    end

    # Record a connection event.
    #
    # @param event [String] "open", "close", "error", "retry"
    def connection_event(event:)
      @mutex.synchronize do
        @connections_total[event.to_s] += 1
      end
    end

    # Record pool utilization.
    #
    # @param active [Integer] active connections
    # @param idle   [Integer] idle connections
    # @param max    [Integer] pool maximum
    def pool_gauge(active:, idle:, max:)
      @mutex.synchronize do
        @pool_active = active
        @pool_idle   = idle
        @pool_max    = max
      end
    end

    # Record a circuit breaker state change.
    def circuit_state(state:)
      @mutex.synchronize do
        @circuit_state = state.to_s
      end
    end

    # Record a failover event.
    def failover_event(from:, to:)
      @mutex.synchronize do
        @failovers_total += 1
        @failover_last_from = from
        @failover_last_to = to
      end
    end

    # Record cache hit/miss.
    def cache_access(hit:)
      @mutex.synchronize do
        if hit
          @cache_hits += 1
        else
          @cache_misses += 1
        end
      end
    end

    # Record bulk insert batch.
    def bulk_inserted(rows:)
      @mutex.synchronize do
        @bulk_rows_total += rows
        @bulk_batches_total += 1
      end
    end

    # Record pub/sub message.
    def pubsub_event(direction:, channel:)
      @mutex.synchronize do
        label = "#{direction}_#{channel}"
        @pubsub_total[label] += 1
      end
    end

    # Render all metrics in Prometheus exposition format.
    #
    # @return [String]
    def render
      @mutex.synchronize do
        lines = []

        # queries_total
        lines << counter("queries_total", "Total queries executed", @queries_total)

        # query_duration_seconds (histogram)
        lines << histogram("query_duration_seconds", "Query duration distribution",
                           @query_duration_sum, @query_duration_count,
                           @query_duration_buckets)

        # connections_total
        lines << counter("connections_total", "Total connection events", @connections_total)

        # pool_active gauge
        lines << gauge("pool_active_connections", "Active pool connections",
                       "pool" => @pool_active.to_s)
        lines << gauge("pool_idle_connections", "Idle pool connections",
                       "pool" => @pool_idle.to_s)
        lines << gauge("pool_max_connections", "Max pool connections",
                       "pool" => @pool_max.to_s)

        # circuit breaker state
        lines << gauge("circuit_breaker_state", "Circuit breaker state (0=closed,1=open,2=half)",
                       "state" => @circuit_state || "unknown")

        # failovers
        lines << counter("failovers_total", "Total failovers",
                         "failover" => @failovers_total.to_s)

        # cache
        lines << counter("cache_hits_total", "Total cache hits", "cache" => @cache_hits.to_s)
        lines << counter("cache_misses_total", "Total cache misses", "cache" => @cache_misses.to_s)

        # bulk
        lines << counter("bulk_rows_inserted_total", "Total bulk-inserted rows",
                         "bulk" => @bulk_rows_total.to_s)
        lines << counter("bulk_batches_total", "Total bulk batches",
                         "bulk" => @bulk_batches_total.to_s)

        # pubsub
        lines << counter("pubsub_messages_total", "Total pub/sub messages", @pubsub_total)

        lines.join("\n") + "\n"
      end
    end

    # Reset all counters and gauges.
    def reset!
      @mutex.synchronize do
        @queries_total = Hash.new(0)
        @query_duration_sum = 0.0
        @query_duration_count = 0
        @query_duration_buckets = duration_buckets.map { |b| [b.to_s, 0] }.to_h.merge("+Inf" => 0)
        @connections_total = Hash.new(0)
        @pool_active = 0
        @pool_idle = 0
        @pool_max = 0
        @circuit_state = "closed"
        @failovers_total = 0
        @failover_last_from = nil
        @failover_last_to = nil
        @cache_hits = 0
        @cache_misses = 0
        @bulk_rows_total = 0
        @bulk_batches_total = 0
        @pubsub_total = Hash.new(0)
      end
    end

    private

    def duration_buckets
      [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
    end

    def counter(name, help, labels = {})
      lines = []
      lines << "# HELP #{@namespace}_#{name} #{help}"
      lines << "# TYPE #{@namespace}_#{name} counter"

      if labels.is_a?(Hash)
        labels.each do |k, v|
          lines << "#{@namespace}_#{name}{label=\"#{k}\"} #{v}"
        end
      else
        labels.each do |k, v|
          lines << "#{@namespace}_#{name}{status=\"#{k}\"} #{v}"
        end
      end

      lines.join("\n")
    end

    def gauge(name, help, labels = {})
      lines = []
      lines << "# HELP #{@namespace}_#{name} #{help}"
      lines << "# TYPE #{@namespace}_#{name} gauge"

      labels.each do |k, v|
        lines << "#{@namespace}_#{name}{label=\"#{k}\"} #{v}"
      end

      lines.join("\n")
    end

    def histogram(name, help, sum, count, buckets)
      lines = []
      lines << "# HELP #{@namespace}_#{name} #{help}"
      lines << "# TYPE #{@namespace}_#{name} histogram"

      cumulative = 0
      buckets.sort_by { |k, _| k == "+Inf" ? Float::INFINITY : k.to_f }.each do |le, v|
        cumulative += v
        lines << "#{@namespace}_#{name}_bucket{le=\"#{le}\"} #{cumulative}"
      end

      lines << "#{@namespace}_#{name}_sum #{sum}"
      lines << "#{@namespace}_#{name}_count #{count}"
      lines.join("\n")
    end
  end
end
