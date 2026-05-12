# frozen_string_literal: true

require "json"

module VedaDB
  # Encapsulates the result of a VedaDB query.
  #
  # Attributes:
  #   columns   — Array<String> column names
  #   rows      — Array<Array>  raw row data
  #   row_count — Integer       number of rows
  #   message   — String        server status message
  #
  # Methods:
  #   to_hashes  — rows as array of hashes
  #   first      — first row as hash, or nil
  #   pluck(col) — extract single column values
  #   empty?     — true if no rows
  #   each       — iterate over hash rows (Enumerable)
  class Result
    include Enumerable

    attr_reader :columns, :rows, :row_count, :message

    def initialize(columns:, rows:, row_count:, message:)
      @columns   = columns
      @rows      = rows
      @row_count = row_count
      @message   = message
    end

    # Iterate over rows as hashes.
    def each
      return enum_for(:each) unless block_given?

      to_hashes.each { |h| yield h }
    end

    # Convert rows to an array of hashes keyed by column name.
    def to_hashes
      return [] if columns.nil? || rows.nil?

      rows.map { |row| row_to_hash(row) }
    end

    # Get the first row as a hash, or nil if empty.
    def first
      hashes = to_hashes
      hashes.empty? ? nil : hashes[0]
    end

    # Extract values from a single column.
    def pluck(column)
      return [] if columns.nil? || rows.nil?

      idx = columns.index(column.to_s)
      return [] if idx.nil?

      rows.map { |row| row[idx] }
    end

    # True if the result has no rows.
    def empty?
      rows.nil? || rows.empty?
    end

    # Number of rows.
    def size
      rows&.size || 0
    end

    alias length size

    # Access a row by index.
    def [](index)
      to_hashes[index]
    end

    # Convert to a simple inspection string.
    def inspect
      "#<VedaDB::Result columns=#{columns.inspect} row_count=#{row_count}>"
    end

    # Convert rows to JSON string.
    def to_json(*args)
      to_hashes.to_json(*args)
    end

    # Build a Result from a raw Hash (e.g. parsed JSON).
    def self.from_hash(hash)
      new(
        columns:   hash["columns"],
        rows:      hash["rows"],
        row_count: hash["row_count"] || 0,
        message:   hash["message"]
      )
    end

    # Parse a JSON response string from VedaDB.
    def self.parse(json)
      data = JSON.parse(json)

      if data.key?("error")
        raise QueryError, data["error"]
      end

      new(
        columns: data["columns"],
        rows: data["rows"],
        row_count: data["row_count"] || 0,
        message: data["message"]
      )
    rescue JSON::ParserError => e
      raise ConnectionError, "Invalid JSON from server: #{e.message}"
    end

    private

    def row_to_hash(row)
      columns.each_with_index.each_with_object({}) do |(col, i), hash|
        hash[col] = row[i]
      end
    end
  end
end
