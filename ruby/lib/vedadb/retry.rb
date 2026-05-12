# frozen_string_literal: true

module VedaDB
  # Retry with exponential backoff and jitter.
  #
  # Usage:
  #   retryer = VedaDB::Retry.new(max: 5, base: 0.1, max_delay: 5.0)
  #   retryer.call { client.query("SELECT 1;") }
  #
  # Block form (gem-like API):
  #   VedaDB::Retry.with(max: 3, base: 0.1) do |r|
  #     r.call { client.query("SELECT * FROM users;") }
  #   end
  #
  # Retryable mixin:
  #   include VedaDB::Retryable
  #   retryable(on: VedaDB::ConnectionError, max: 3) { client.query(sql) }
  class Retry
    DEFAULT_MAX       = 3
    DEFAULT_BASE      = 0.1      # 100 ms
    DEFAULT_MAX_DELAY = 30.0     # 30 seconds
    JITTER_FACTOR     = 0.25     # +/- 25%

    attr_reader :max, :base, :max_delay, :attempts, :last_error

    # @param max       [Integer] maximum number of retry attempts
    # @param base      [Float]   initial delay in seconds
    # @param max_delay [Float]   cap on delay (exponential backoff)
    # @param on        [Array<Class>] exception classes to retry on
    def initialize(max: DEFAULT_MAX, base: DEFAULT_BASE, max_delay: DEFAULT_MAX_DELAY, on: [ConnectionError])
      @max       = max
      @base      = base
      @max_delay = max_delay
      @on        = Array(on)
      @attempts  = 0
      @last_error = nil
    end

    # Execute a block with retry logic.
    #
    # @yield block to execute with retries
    # @return the block's return value
    # @raise [RetryExhaustedError] if all attempts fail
    def call
      @attempts = 0
      @last_error = nil

      loop do
        @attempts += 1
        begin
          return yield
        rescue *@on => e
          @last_error = e
          raise RetryExhaustedError, "Failed after #{@max} attempts: #{e.message}" if @attempts >= @max

          sleep(delay_for(@attempts))
        end
      end
    end

    # Convenience class method.
    def self.with(max: DEFAULT_MAX, base: DEFAULT_BASE, max_delay: DEFAULT_MAX_DELAY, on: [ConnectionError])
      retryer = new(max: max, base: base, max_delay: max_delay, on: on)
      retryer.call { yield(retryer) }
    end

    # Calculate delay for the nth attempt (1-indexed).
    def delay_for(attempt)
      exp = @base * (2**attempt)
      capped = [exp, @max_delay].min
      jitter = capped * JITTER_FACTOR * (rand - 0.5) * 2
      [capped + jitter, 0].max
    end

    # True if the last call exhausted all retries.
    def exhausted?
      @attempts >= @max
    end

    # Reset state.
    def reset!
      @attempts = 0
      @last_error = nil
    end
  end

  # Mixin module for retryable method decoration.
  #
  #   class MyClient
  #     include VedaDB::Retryable
  #
  #     def query(sql)
  #       retryable { perform_query(sql) }
  #     end
  #   end
  module Retryable
    # Execute block with automatic retry.
    #
    # @param on  [Array<Class>] exception classes to catch
    # @param max [Integer]      maximum attempts
    # @param base [Float]       initial backoff in seconds
    def retryable(on: [ConnectionError], max: Retry::DEFAULT_MAX, base: Retry::DEFAULT_BASE)
      Retry.new(max: max, base: base, on: on).call { yield }
    end
  end
end
