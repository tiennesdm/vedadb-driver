# frozen_string_literal: true

module VedaDB
  # Streaming cursor for large result sets.
  #
  # Fetches rows incrementally via server-side cursors:
  #   cursor = db.cursor("SELECT * FROM large_table;")
  #   cursor.each do |row_hash|
  #     puts row_hash
  #   end
  #   cursor.close
  #
  # Enumerable mixin:
  #   cursor.map { |row| row["name"] }
  #   cursor.select { |row| row["age"].to_i > 21 }
  #   cursor.first(10)
  #
  # Block form:
  #   db.cursor("SELECT * FROM large_table;") do |c|
  #     c.each { |row| process(row) }
  #   end
  class Cursor
    include Enumerable

    attr_reader :sql, :params, :fetch_size, :position

    DEFAULT_FETCH_SIZE = 1000

    def initialize(client, sql, params = nil, fetch_size: DEFAULT_FETCH_SIZE)
      @client     = client
      @sql        = sql
      @params     = params
      @fetch_size = fetch_size
      @position   = 0
      @buffer     = []
      @exhausted  = false
      @closed     = false
      @cursor_id  = nil
    end

    # Iterate over every row as a Hash.
    #
    # @yieldparam row [Hash] row data keyed by column name
    def each
      return enum_for(:each) unless block_given?

      while (row = fetch_row)
        yield row
      end
    end

    # Iterate over raw row arrays (faster, no hash conversion).
    def each_row
      return enum_for(:each_row) unless block_given?

      while (row = fetch_raw_row)
        yield row
      end
    end

    # Fetch the next row as a Hash, or nil when exhausted.
    def fetch_row
      return nil if @closed || @exhausted

      ensure_buffer
      return nil if @buffer.empty?

      row = @buffer.shift
      @position += 1
      row.is_a?(Hash) ? row : array_to_hash(row)
    end

    # Fetch the next row as an Array, or nil when exhausted.
    def fetch_raw_row
      return nil if @closed || @exhausted

      ensure_buffer
      return nil if @buffer.empty?

      row = @buffer.shift
      @position += 1
      row.is_a?(Hash) ? hash_to_array(row) : row
    end

    # Fetch up to +n+ rows as an array of Hashes.
    def fetch_many(n = @fetch_size)
      rows = []
      n.times do
        row = fetch_row
        break unless row

        rows << row
      end
      rows
    end

    # Read all remaining rows into memory.
    def to_a
      each.to_a
    end

    # Get the first row, or nil.
    def first
      row = fetch_row
      row
    end

    # True if all rows have been consumed.
    def exhausted?
      @exhausted
    end

    # True if the cursor is closed.
    def closed?
      @closed
    end

    # Close the cursor and release server-side resources.
    def close
      return if @closed

      begin
        @client.query("CLOSE cursor_#{@cursor_id}") if @cursor_id
      rescue StandardError
        # ignore
      end

      @closed = true
      @buffer.clear
    end

    # Rewind to the beginning (re-executes the query).
    def rewind
      close if @cursor_id
      @closed    = false
      @exhausted = false
      @position  = 0
      @buffer.clear
      @cursor_id = nil
    end

    private

    def ensure_buffer
      fill_buffer if @buffer.empty? && !@exhausted
    end

    def fill_buffer
      if @cursor_id.nil?
        # First fetch: declare cursor + initial fetch
        declare_sql = if @params
                        "DECLARE cursor_#{cursor_name} CURSOR FOR #{interpolate(@sql, @params)}"
                      else
                        "DECLARE cursor_#{cursor_name} CURSOR FOR #{@sql}"
                      end
        @client.query(declare_sql)
        @cursor_id = cursor_name
      end

      result = @client.query("FETCH #{@fetch_size} FROM cursor_#{@cursor_id}")

      if result.rows.nil? || result.rows.empty?
        @exhausted = true
        return
      end

      @columns ||= result.columns
      @buffer.concat(result.to_hashes)

      @exhausted = true if result.rows.size < @fetch_size
    rescue StandardError => e
      @exhausted = true
      raise QueryError, "Cursor fetch failed: #{e.message}"
    end

    def cursor_name
      @cursor_name ||= "vedadb_cursor_#{object_id}_#{Time.now.to_i}"
    end

    def interpolate(sql, params)
      params.each do |p|
        repl = case p
               when nil then "NULL"
               when String then "'#{p.gsub("'", "''")}'"
               when true then "TRUE"
               when false then "FALSE"
               else p.to_s
               end
        sql = sql.sub("?", repl)
      end
      sql
    end

    def array_to_hash(row)
      return row unless @columns

      @columns.each_with_index.each_with_object({}) do |(col, i), h|
        h[col] = row[i]
      end
    end

    def hash_to_array(row)
      return row.values if row.is_a?(Hash)

      row
    end
  end
end
