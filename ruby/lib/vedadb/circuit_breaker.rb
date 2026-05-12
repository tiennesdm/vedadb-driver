# frozen_string_literal: true

module VedaDB
  # Circuit breaker pattern for resilient database calls.
  #
  # States:
  #   CLOSED   -> normal operation, failures are counted
  #   OPEN     -> all calls fail fast with CircuitOpenError
  #   HALF_OPEN-> after recovery_timeout, one probe call is allowed
  #
  # Usage:
  #   cb = VedaDB::CircuitBreaker.new(threshold: 5, recovery_timeout: 30)
  #   cb.call { client.query("SELECT 1;") }
  #
  #   cb.state  # => :closed | :open | :half_open
  #   cb.open?  # => true/false
  class CircuitBreaker
    STATE_CLOSED    = :closed
    STATE_OPEN      = :open
    STATE_HALF_OPEN = :half_open

    DEFAULT_THRESHOLD         = 5
    DEFAULT_RECOVERY_TIMEOUT  = 30.0 # seconds

    attr_reader :threshold, :recovery_timeout, :failures, :state, :last_failure_time

    def initialize(threshold: DEFAULT_THRESHOLD, recovery_timeout: DEFAULT_RECOVERY_TIMEOUT)
      @threshold        = threshold
      @recovery_timeout = recovery_timeout
      @failures         = 0
      @state            = STATE_CLOSED
      @last_failure_time = nil
      @mutex            = Mutex.new
    end

    # Execute a block through the circuit breaker.
    #
    # @raise [CircuitOpenError] if the circuit is OPEN
    # @raise any error from the block if it fails in HALF_OPEN
    def call
      @mutex.synchronize { check_state! }

      begin
        result = yield
        @mutex.synchronize { record_success }
        result
      rescue => e
        @mutex.synchronize { record_failure }
        raise e
      end
    end

    # Force the circuit open.
    def force_open!
      @mutex.synchronize do
        @state = STATE_OPEN
        @last_failure_time = Time.now
      end
    end

    # Force the circuit closed.
    def force_close!
      @mutex.synchronize { reset! }
    end

    # Current state symbol.
    def state
      @mutex.synchronize { @state }
    end

    def closed?    = state == STATE_CLOSED
    def open?      = state == STATE_OPEN
    def half_open? = state == STATE_HALF_OPEN

    # Statistics snapshot.
    def stats
      @mutex.synchronize do
        {
          state: @state,
          failures: @failures,
          threshold: @threshold,
          recovery_timeout: @recovery_timeout,
          last_failure_time: @last_failure_time,
        }
      end
    end

    # Reset to closed state with zero failures.
    def reset!
      @failures = 0
      @state = STATE_CLOSED
      @last_failure_time = nil
    end

    private

    def check_state!
      case @state
      when STATE_OPEN
        if Time.now - @last_failure_time >= @recovery_timeout
          @state = STATE_HALF_OPEN
        else
          raise CircuitOpenError,
                "Circuit breaker is OPEN (failures=#{@failures}, " \
                "retry in #{(@recovery_timeout - (Time.now - @last_failure_time)).round(1)}s)"
        end
      end
    end

    def record_success
      if @state == STATE_HALF_OPEN
        reset!
      else
        @failures = [@failures - 1, 0].max
      end
    end

    def record_failure
      @failures += 1
      @last_failure_time = Time.now

      if @failures >= @threshold || @state == STATE_HALF_OPEN
        @state = STATE_OPEN
      end
    end
  end
end
