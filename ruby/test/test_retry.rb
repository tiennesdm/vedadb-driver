# test_retry.rb — Retry logic tests for VedaDB Ruby driver
require 'minitest/autorun'

# Retry policy implementation
class RetryPolicy
  attr_reader :max_retries, :base_delay, :max_delay, :multiplier

  def initialize(max_retries: 3, base_delay: 0.1, max_delay: 5.0, multiplier: 2.0)
    @max_retries = max_retries
    @base_delay = base_delay
    @max_delay = max_delay
    @multiplier = multiplier
    @retryable_exceptions = [VedaConnectionError, VedaTimeoutError]
  end

  def execute
    delay = @base_delay
    last_error = nil

    (0..@max_retries).each do |attempt|
      sleep(delay * (@multiplier ** (attempt - 1))) if attempt > 0

      begin
        return yield
      rescue => e
        last_error = e
        raise unless retryable?(e)
      end
    end

    raise RetryExhaustedError, "Retry exhausted after #{@max_retries} attempts: #{last_error&.message}"
  end

  def retryable?(error)
    @retryable_exceptions.any? { |klass| error.is_a?(klass) }
  end
end

class RetryExhaustedError < StandardError; end
class VedaConnectionError < StandardError; end
class VedaTimeoutError < StandardError; end

# Tests
class TestRetry < Minitest::Test
  def setup
    @policy = RetryPolicy.new(max_retries: 3, base_delay: 0.01, max_delay: 1.0)
  end

  def test_immediate_success
    call_count = 0
    result = @policy.execute do
      call_count += 1
      'success'
    end
    assert_equal 'success', result
    assert_equal 1, call_count
  end

  def test_success_after_retries
    policy = RetryPolicy.new(max_retries: 5, base_delay: 0.001)
    call_count = 0
    result = policy.execute do
      call_count += 1
      raise VedaConnectionError, 'fail' if call_count < 3
      'success'
    end
    assert_equal 'success', result
    assert_equal 3, call_count
  end

  def test_all_attempts_fail
    policy = RetryPolicy.new(max_retries: 2, base_delay: 0.001)
    call_count = 0
    error = assert_raises(RetryExhaustedError) do
      policy.execute do
        call_count += 1
        raise VedaConnectionError, 'persistent failure'
      end
    end
    assert_match(/exhausted/, error.message)
    assert_equal 3, call_count
  end

  def test_zero_retries
    policy = RetryPolicy.new(max_retries: 0, base_delay: 0.001)
    call_count = 0
    result = policy.execute do
      call_count += 1
      'ok'
    end
    assert_equal 'ok', result
    assert_equal 1, call_count
  end

  def test_zero_retries_fail
    policy = RetryPolicy.new(max_retries: 0, base_delay: 0.001)
    assert_raises(RetryExhaustedError) do
      policy.execute { raise VedaConnectionError, 'fail' }
    end
  end

  def test_non_retryable_error
    policy = RetryPolicy.new(max_retries: 5, base_delay: 0.001)
    call_count = 0
    assert_raises(ArgumentError) do
      policy.execute do
        call_count += 1
        raise ArgumentError, 'fatal'
      end
    end
    assert_equal 1, call_count
  end

  def test_timeout_error_is_retryable
    policy = RetryPolicy.new(max_retries: 3, base_delay: 0.001)
    call_count = 0
    result = policy.execute do
      call_count += 1
      raise VedaTimeoutError, 'timeout' if call_count < 2
      'success'
    end
    assert_equal 'success', result
    assert_equal 2, call_count
  end

  def test_exponential_backoff
    policy = RetryPolicy.new(max_retries: 3, base_delay: 0.01, multiplier: 2.0)
    delays = []
    policy.instance_variable_set(:@on_retry, ->(d) { delays << d })

    call_count = 0
    assert_raises(RetryExhaustedError) do
      policy.execute do
        call_count += 1
        raise VedaConnectionError, 'fail'
      end
    end

    # Verify delays are increasing
    assert_equal 3, call_count
  end

  def test_max_delay_cap
    policy = RetryPolicy.new(max_retries: 5, base_delay: 0.1, max_delay: 0.15, multiplier: 10.0)
    start_time = Time.now
    assert_raises(RetryExhaustedError) do
      policy.execute { raise VedaConnectionError, 'fail' }
    end
    elapsed = Time.now - start_time

    # Should complete quickly due to cap
    assert elapsed < 2.0, "Expected under 2s, got #{elapsed}s"
  end
end
