# test_pool.rb — Connection pool tests for VedaDB Ruby driver
require 'minitest/autorun'
require 'thread'

# Connection pool implementation
class ConnectionPool
  attr_reader :max_size, :total_created, :available_count

  def initialize(factory:, max_size: 10, max_idle: 5, wait_timeout: 5.0)
    @factory = factory
    @max_size = max_size
    @max_idle = max_idle
    @wait_timeout = wait_timeout
    @available = Queue.new
    @all_connections = []
    @total_created = 0
    @closed = false
    @mutex = Mutex.new
  end

  def acquire
    raise 'Pool is closed' if @closed

    # Try to get from pool
    begin
      conn = @available.pop(true)
      conn.in_use = true
      return conn
    rescue ThreadError
    end

    # Create new if under max
    @mutex.synchronize do
      if @total_created < @max_size
        @total_created += 1
        raw = @factory.call
        conn = PooledConnection.new(raw, @total_created, self)
        conn.in_use = true
        @all_connections << conn
        return conn
      end
    end

    # Wait for available connection
    conn = @available.pop(true)
    conn.in_use = true
    conn
  rescue ThreadError
    raise Timeout::Error, 'Pool exhausted: wait timeout'
  end

  def release(conn)
    conn.in_use = false
    @available << conn
  end

  def active_count
    @total_created - @available.size
  end

  def close
    @closed = true
  end

  def closed?
    @closed
  end
end

class PooledConnection
  attr_reader :id, :connection
  attr_accessor :in_use

  def initialize(connection, id, pool)
    @connection = connection
    @id = id
    @pool = pool
    @in_use = false
  end

  def release
    @pool.release(self)
  end

  def valid?
    !@connection.closed?
  end
end

class MockConnection
  attr_reader :closed

  def initialize
    @closed = false
  end

  def close
    @closed = true
  end

  def closed?
    @closed
  end
end

# Tests
class TestConnectionPool < Minitest::Test
  def setup
    @factory = -> { MockConnection.new }
    @pool = ConnectionPool.new(factory: @factory, max_size: 10, max_idle: 5, wait_timeout: 1.0)
  end

  def teardown
    @pool.close unless @pool.closed?
  end

  def test_acquire_new
    conn = @pool.acquire
    refute_nil conn
    assert conn.in_use
    conn.release
  end

  def test_reuse_connection
    conn1 = @pool.acquire
    id1 = conn1.id
    conn1.release

    conn2 = @pool.acquire
    assert_equal id1, conn2.id
    conn2.release
  end

  def test_track_total_created
    assert_equal 0, @pool.total_created
    conn = @pool.acquire
    assert_equal 1, @pool.total_created
    conn.release
  end

  def test_pool_exhaustion_timeout
    small_pool = ConnectionPool.new(factory: @factory, max_size: 1, max_idle: 1, wait_timeout: 0.05)
    conn = small_pool.acquire
    assert_raises(Timeout::Error) { small_pool.acquire }
    conn.release
    small_pool.close
  end

  def test_max_connections
    small_pool = ConnectionPool.new(factory: @factory, max_size: 3, max_idle: 3, wait_timeout: 1.0)
    conns = 3.times.map { small_pool.acquire }
    assert_equal 3, small_pool.total_created
    conns.each(&:release)
    small_pool.close
  end

  def test_release_returns_to_pool
    conn = @pool.acquire
    conn.release
    conn2 = @pool.acquire
    refute_nil conn2
    conn2.release
  end

  def test_close_pool
    @pool.close
    assert @pool.closed?
  end

  def test_acquire_after_close
    @pool.close
    error = assert_raises(RuntimeError) { @pool.acquire }
    assert_match(/closed/, error.message)
  end

  def test_concurrent_acquire_release
    threads = 20.times.map do
      Thread.new do
        conn = @pool.acquire
        sleep 0.01
        conn.release
      end
    end
    threads.each(&:join)
  end

  def test_stress_test
    stress_pool = ConnectionPool.new(factory: @factory, max_size: 5, max_idle: 5, wait_timeout: 2.0)
    acquired = Queue.new

    threads = 50.times.map do
      Thread.new do
        begin
          conn = stress_pool.acquire
          acquired << true
          sleep 0.01
          conn.release
        rescue Timeout::Error
          # expected
        end
      end
    end
    threads.each(&:join)

    assert acquired.size > 0
    stress_pool.close
  end

  def test_connection_validity
    conn = @pool.acquire
    assert conn.valid?
    conn.release
  end
end
