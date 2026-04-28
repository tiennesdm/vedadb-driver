# frozen_string_literal: true

module VedaDB
  class Result
    attr_reader :columns, :rows, :row_count, :message

    def initialize(columns:, rows:, row_count:, message:)
      @columns = columns
      @rows = rows
      @row_count = row_count
      @message = message
    end

    # Convert rows to an array of hashes keyed by column name.
    def to_hashes
      return [] if columns.nil? || rows.nil?

      rows.map do |row|
        columns.each_with_index.each_with_object({}) do |(col, i), hash|
          hash[col] = row[i]
        end
      end
    end

    # Get the first row as a hash, or nil if empty.
    def first
      hashes = to_hashes
      hashes.empty? ? nil : hashes[0]
    end

    # Extract values from a single column.
    def pluck(column)
      return [] if columns.nil? || rows.nil?

      idx = columns.index(column)
      return [] if idx.nil?

      rows.map { |row| row[idx] }
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
    end
  end
end
