# frozen_string_literal: true

module VedaDB
  # Bulk inserter with automatic batching.
  #
  # Usage:
  #   bulk = db.bulk_insert("users", batch_size: 500)
  #   bulk.add({ id: 1, name: "Alice" })
  #   bulk.add({ id: 2, name: "Bob" })
  #   bulk.flush        # flush remaining rows
  #   bulk.close        # flush + cleanup
  #
  # Block form:
  #   db.bulk_insert("users") do |bulk|
  #     1000.times { |i| bulk.add(id: i, name: "user_#{i}") }
  #   end  # auto-flush + close
  class BulkInserter
    attr_reader :table, :batch_size, :total_inserted, :total_batches

    def initialize(client, table, batch_size = 1000)
      @client         = client
      @table          = table
      @batch_size     = batch_size
      @buffer         = []
      @columns        = nil
      @total_inserted = 0
      @total_batches  = 0
      @mutex          = Mutex.new
      @closed         = false
    end

    # Add a row hash to the buffer.  Flushes when buffer reaches batch_size.
    def add(row)
      raise Error, "BulkInserter is closed" if @closed

      @mutex.synchronize do
        @columns ||= row.keys
        @buffer << row.values
        flush_unlocked if @buffer.size >= @batch_size
      end
    end

    alias << add

    # Add multiple rows at once.
    def add_many(rows)
      rows.each { |row| add(row) }
    end

    # Manually flush the buffer.
    def flush
      @mutex.synchronize { flush_unlocked }
    end

    # Flush remaining rows and mark as closed.
    def close
      @mutex.synchronize do
        flush_unlocked
        @closed = true
      end
    end

    def closed?
      @mutex.synchronize { @closed }
    end

    # Current buffer size.
    def pending
      @mutex.synchronize { @buffer.size }
    end

    private

    def flush_unlocked
      return if @buffer.empty?

      columns = @columns.join(", ")
      values = @buffer.map do |row|
        "(#{row.map { |v| format_value(v) }.join(', ')})"
      end.join(", ")

      @client.query("INSERT INTO #{@table} (#{columns}) VALUES #{values}")

      @total_inserted += @buffer.size
      @total_batches  += 1
      @buffer.clear
    rescue => e
      raise QueryError, "Bulk insert failed: #{e.message}"
    end

    def format_value(value)
      case value
      when nil then "NULL"
      when String then "'#{value.gsub("'", "''")}'"
      when true then "TRUE"
      when false then "FALSE"
      else value.to_s
      end
    end
  end

  # Pipeline for sending multiple commands in one round-trip.
  #
  # Usage:
  #   pipe = db.pipeline
  #   pipe << "SELECT * FROM users;"
  #   pipe << "SELECT COUNT(*) FROM orders;"
  #   results = pipe.execute
  #   # => [Result<users>, Result<count>]
  #
  # Block form:
  #   results = db.pipeline do |p|
  #     p << "INSERT INTO logs VALUES (1, 'a');"
  #     p << "INSERT INTO logs VALUES (2, 'b');"
  #   end
  class Pipeline
    attr_reader :commands

    def initialize(client)
      @client   = client
      @commands = []
    end

    # Add a SQL command to the pipeline.
    def <<(sql)
      @commands << sql
      self
    end

    alias add <<

    # Add multiple commands.
    def add_many(sqls)
      sqls.each { |sql| @commands << sql }
      self
    end

    # Clear all queued commands.
    def clear
      @commands.clear
      self
    end

    # Execute all commands and return an array of Results.
    #
    # @return [Array<Result>]
    def execute
      return [] if @commands.empty?

      results = []

      if @client.respond_to?(:pipeline_execute)
        # Use native pipeline if the client supports it
        results = @client.pipeline_execute(@commands)
      else
        # Sequential fallback
        @commands.each do |sql|
          results << @client.query(sql)
        end
      end

      results
    rescue => e
      raise QueryError, "Pipeline execution failed: #{e.message}"
    ensure
      @commands.clear
    end

    # Number of queued commands.
    def size
      @commands.size
    end

    def empty?
      @commands.empty?
    end
  end
end
