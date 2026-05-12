# frozen_string_literal: true

module VedaDB
  # Periodic health checker for VedaDB connections.
  #
  # Usage:
  #   health = VedaDB::Health.new(client, interval: 5, timeout: 3)
  #   health.start
  #   sleep 20
  #   puts health.healthy?  # => true / false
  #   health.stop
  #
  # Block callback:
  #   health.on_change { |status, info| puts "Health: #{status}" }
  class Health
    attr_reader :client, :interval, :timeout, :checks, :failures

    def initialize(client, interval: 5, timeout: 3)
      @client   = client
      @interval = interval
      @timeout  = timeout
      @checks   = 0
      @failures = 0
      @healthy  = false
      @running  = false
      @mutex    = Mutex.new
      @thread   = nil
      @on_change_callbacks = []
    end

    # Start the health-check thread.
    def start
      @mutex.synchronize do
        return if @running

        @running = true
      end

      @thread = Thread.new do
        while @running
          perform_check
          sleep @interval
        end
      end

      self
    end

    # Stop the health-check thread.
    def stop
      @mutex.synchronize { @running = false }
      @thread&.join(@timeout + 1)
      self
    end

    # Perform a single health check synchronously.
    def check
      perform_check
      healthy?
    end

    # Is the connection currently healthy?
    def healthy?
      @mutex.synchronize { @healthy }
    end

    # Register a callback for status changes.
    #
    # @yieldparam status [Boolean] new health status
    # @yieldparam info   [Hash]    check metadata
    def on_change(&block)
      @on_change_callbacks << block
    end

    # Health statistics.
    def stats
      @mutex.synchronize do
        {
          checks: @checks,
          failures: @failures,
          healthy: @healthy,
          uptime_ratio: @checks > 0 ? ((@checks - @failures).to_f / @checks).round(4) : 1.0,
        }
      end
    end

    private

    def perform_check
      @mutex.synchronize { @checks += 1 }

      begin
        ok = false
        Timeout.timeout(@timeout) do
          ok = @client.ping
        end

        was_healthy = @mutex.synchronize do
          old = @healthy
          @healthy = ok
          old
        end

        notify_change(was_healthy, true) if was_healthy != true
      rescue StandardError => e
        was_healthy = @mutex.synchronize do
          old = @healthy
          @healthy = false
          @failures += 1
          old
        end

        notify_change(was_healthy, false, e.message) if was_healthy != false
      end
    end

    def notify_change(was_healthy, now_healthy, error_message = nil)
      info = { checks: @checks, failures: @failures, error: error_message }
      @on_change_callbacks.each { |cb| cb.call(now_healthy, info) }
    end
  end
end
