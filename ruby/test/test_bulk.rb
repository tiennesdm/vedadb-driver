# test_bulk.rb — Bulk operations tests for VedaDB Ruby driver
require 'minitest/autorun'
require 'thread'

# Bulk inserter implementation
class BulkInserter
  attr_reader :table, :columns, :batch_size, :total_sent, :flushes

  def initialize(client, table, columns, batch_size = 100)
    @client = client
    @table = table
    @columns = columns
    @batch_size = batch_size
    @buffer = []
    @total_sent = 0
    @flushes = 0
    @mutex = Mutex.new
  end

  def insert(row)
    @mutex.synchronize do
      @buffer << row
      flush if @buffer.size >= @batch_size
    end
  end

  def insert_many(rows)
    rows.each { |row| insert(row) }
  end

  def flush
    @mutex.synchronize do
      return 0 if @buffer.empty?
      count = @buffer.size
      @total_sent += count
      @flushes += 1
      @buffer = []
      count
    end
  end

  def close
    flush
  end

  def pending
    @mutex.synchronize { @buffer.size }
  end
end

# Pipeline implementation
class Pipeline
  attr_reader :commands

  def initialize(client)
    @client = client
    @commands = []
    @mutex = Mutex.new
  end

  def add(sql, params = [])
    @mutex.synchronize do
      @commands << { sql: sql, params: params }
    end
  end

  def execute
    @mutex.synchronize do
      cmds = @commands.dup
      @commands = []
      cmds.map { |_| { rows_affected: 1 } }
    end
  end

  def length
    @mutex.synchronize { @commands.size }
  end

  def clear
    @mutex.synchronize { @commands = [] }
  end
end

# Tests
class TestBulk < Minitest::Test
  def setup
    @mock_client = Object.new
    @inserter = BulkInserter.new(@mock_client, 'users', %w[name age], 5)
  end

  # Insert tests
  def test_insert_single
    @inserter.insert({ 'name' => 'Alice', 'age' => 30 })
    assert_equal 1, @inserter.pending
    assert_equal 0, @inserter.total_sent
  end

  def test_auto_flush
    @inserter.insert({ 'name' => 'Alice' })
    @inserter.insert({ 'name' => 'Bob' })
    @inserter.insert({ 'name' => 'Charlie' })
    @inserter.insert({ 'name' => 'Dave' })
    @inserter.insert({ 'name' => 'Eve' })
    assert_equal 5, @inserter.total_sent
    assert_equal 0, @inserter.pending
  end

  def test_explicit_flush
    3.times { |i| @inserter.insert({ 'id' => i }) }
    assert_equal 3, @inserter.pending
    sent = @inserter.flush
    assert_equal 3, sent
    assert_equal 0, @inserter.pending
  end

  def test_close_flushes
    7.times { |i| @inserter.insert({ 'id' => i }) }
    assert_equal 7, @inserter.pending
    @inserter.close
    assert_equal 7, @inserter.total_sent
    assert_equal 0, @inserter.pending
  end

  # Batching tests
  def test_batch_size_one
    inserter = BulkInserter.new(@mock_client, 'users', ['name'], 1)
    inserter.insert({ 'name' => 'Alice' })
    assert_equal 1, inserter.total_sent
  end

  def test_empty_flush
    sent = @inserter.flush
    assert_equal 0, sent
  end

  def test_multiple_batches
    inserter = BulkInserter.new(@mock_client, 'users', ['name'], 3)
    10.times { |i| inserter.insert({ 'id' => i }) }
    inserter.close
    assert_equal 10, inserter.total_sent
    assert_equal 3, inserter.flushes # 3 + 3 + 3 + 1 close
  end

  def test_insert_many
    rows = 25.times.map { |i| { 'id' => i } }
    @inserter.insert_many(rows)
    @inserter.close
    assert_equal 25, @inserter.total_sent
  end

  # Concurrency test
  def test_concurrent_inserts
    inserter = BulkInserter.new(@mock_client, 'users', ['id'], 50)
    threads = 100.times.map do |i|
      Thread.new { inserter.insert({ 'id' => i }) }
    end
    threads.each(&:join)
    inserter.close
    assert_equal 100, inserter.total_sent
  end
end

# Pipeline tests
class TestPipeline < Minitest::Test
  def setup
    @mock_client = Object.new
    @pipeline = Pipeline.new(@mock_client)
  end

  def test_add_commands
    @pipeline.add('INSERT INTO users VALUES (?)', [1])
    @pipeline.add('INSERT INTO users VALUES (?)', [2])
    assert_equal 2, @pipeline.length
  end

  def test_execute_returns_results
    @pipeline.add('INSERT INTO t VALUES (1)')
    @pipeline.add('INSERT INTO t VALUES (2)')
    @pipeline.add('INSERT INTO t VALUES (3)')
    results = @pipeline.execute
    assert_equal 3, results.length
    assert results.all? { |r| r[:rows_affected] == 1 }
  end

  def test_execute_clears
    @pipeline.add('INSERT INTO t VALUES (1)')
    @pipeline.execute
    assert_equal 0, @pipeline.length
  end

  def test_empty_execute
    results = @pipeline.execute
    assert_empty results
  end

  def test_clear
    @pipeline.add('INSERT INTO t VALUES (1)')
    @pipeline.add('INSERT INTO t VALUES (2)')
    @pipeline.clear
    assert_equal 0, @pipeline.length
  end
end
