# test_circuit.rb — Circuit breaker tests for VedaDB Ruby driver
require 'minitest/autorun'

# Circuit breaker implementation
class CircuitBreaker
  attr_reader :failure_threshold, :success_threshold, :timeout

  def initialize(failure_threshold: 5, success_threshold: 3, timeout: 30.0)
    @failure_threshold = failure_threshold
    @success_threshold = success_threshold
    @timeout = timeout
    @state = :closed
    @failure_count = 0
    @success_count = 0
    @last_failure_time = nil
    @half_open_calls = 0
    @half_open_max = 1
    @mutex = Mutex.new
  end

  def state
    @mutex.synchronize { @state }
  end

  def allow?
    @mutex.synchronize do
      case @state
      when :closed
        return true
      when :open
        if Time.now - @last_failure_time > @timeout
          @state = :half_open
          @half_open_calls = 0
          @success_count = 0
          return true
        end
        return false
      when :half_open
        if @half_open_calls < @half_open_max
          @half_open_calls += 1
          return true
        end
        return false
      end
    end
  end

  def record_success
    @mutex.synchronize do
      case @state
      when :half_open
        @success_count += 1
        if @success_count >= @success_threshold
          @state = :closed
          @failure_count = 0
          @half_open_calls = 0
        end
      when :closed
        @failure_count = 0
      end
    end
  end

  def record_failure
    @mutex.synchronize do
      @last_failure_time = Time.now
      if @state == :half_open
        @state = :open
        @half_open_calls = 0
        return
      end
      @failure_count += 1
      if @failure_count >= @failure_threshold
        @state = :open
      end
    end
  end

  def execute
    raise CircuitBreakerOpenError, 'Circuit breaker is OPEN' unless allow?
    begin
      result = yield
      record_success
      result
    rescue => e
      record_failure
      raise e
    end
  end

  def reset
    @mutex.synchronize do
      @state = :closed
      @failure_count = 0
      @success_count = 0
      @half_open_calls = 0
    end
  end
end

class CircuitBreakerOpenError < StandardError; end

# Tests
class TestCircuitBreaker < Minitest::Test
  def setup
    @cb = CircuitBreaker.new(failure_threshold: 5, success_threshold: 3, timeout: 30.0)
  end

  # Closed state tests
  def test_initial_state
    assert_equal :closed, @cb.state
  end

  def test_allows_when_closed
    assert @cb.allow?
  end

  def test_execute_success
    result = @cb.execute { 'success' }
    assert_equal 'success', result
  end

  def test_reset_failure_on_success
    @cb.record_failure
    @cb.record_failure
    @cb.record_success
    assert_equal :closed, @cb.state
  end

  # Open state tests
  def test_opens_after_threshold
    cb = CircuitBreaker.new(failure_threshold: 3)
    cb.record_failure
    cb.record_failure
    assert_equal :closed, cb.state
    cb.record_failure
    assert_equal :open, cb.state
  end

  def test_rejects_when_open
    cb = CircuitBreaker.new(failure_threshold: 1, timeout: 60.0)
    cb.record_failure
    refute cb.allow?
  end

  def test_execute_when_open
    cb = CircuitBreaker.new(failure_threshold: 1, timeout: 60.0)
    cb.record_failure
    error = assert_raises(CircuitBreakerOpenError) { cb.execute { 'no' } }
    assert_match(/OPEN/, error.message)
  end

  def test_exact_threshold
    cb = CircuitBreaker.new(failure_threshold: 3)
    cb.record_failure
    cb.record_failure
    assert_equal :closed, cb.state
    cb.record_failure
    assert_equal :open, cb.state
  end

  # Half-open tests
  def test_half_open_after_timeout
    cb = CircuitBreaker.new(failure_threshold: 1, timeout: 0.05)
    cb.record_failure
    assert_equal :open, cb.state
    sleep 0.1
    assert cb.allow?
    assert_equal :half_open, cb.state
  end

  def test_closes_after_half_open_success
    cb = CircuitBreaker.new(failure_threshold: 5, success_threshold: 1, timeout: 0.01)
    cb.record_failure
    sleep 0.02
    cb.allow?
    cb.record_success
    assert_equal :closed, cb.state
  end

  def test_reopens_after_half_open_failure
    cb = CircuitBreaker.new(failure_threshold: 5, timeout: 0.01)
    cb.record_failure
    sleep 0.02
    cb.allow?
    cb.record_failure
    assert_equal :open, cb.state
  end

  def test_multiple_successes_required
    cb = CircuitBreaker.new(failure_threshold: 5, success_threshold: 3, timeout: 0.01)
    cb.record_failure

    sleep 0.02
    cb.allow?
    cb.record_success
    assert_equal :half_open, cb.state

    sleep 0.02
    cb.allow?
    cb.record_success
    assert_equal :half_open, cb.state

    sleep 0.02
    cb.allow?
    cb.record_success
    assert_equal :closed, cb.state
  end

  # Recovery tests
  def test_full_recovery
    cb = CircuitBreaker.new(failure_threshold: 2, success_threshold: 1, timeout: 0.01)

    assert_equal :closed, cb.state

    cb.record_failure
    cb.record_failure
    assert_equal :open, cb.state

    sleep 0.02
    assert cb.allow?
    assert_equal :half_open, cb.state

    cb.record_success
    assert_equal :closed, cb.state
  end

  # Reset test
  def test_manual_reset
    cb = CircuitBreaker.new(failure_threshold: 1)
    cb.record_failure
    assert_equal :open, cb.state
    cb.reset
    assert_equal :closed, cb.state
    assert cb.allow?
  end

  # Concurrency test
  def test_concurrent_failures
    cb = CircuitBreaker.new(failure_threshold: 100)
    threads = 50.times.map do
      Thread.new { cb.record_failure }
    end
    threads.each(&:join)
    assert_equal :open, cb.state
  end

  def test_concurrent_allows_when_open
    cb = CircuitBreaker.new(failure_threshold: 1, timeout: 60.0)
    cb.record_failure
    results = []
    mutex = Mutex.new
    threads = 20.times.map do
      Thread.new do
        allowed = cb.allow?
        mutex.synchronize { results << allowed }
      end
    end
    threads.each(&:join)
    assert results.all? { |r| r == false }
  end
end
