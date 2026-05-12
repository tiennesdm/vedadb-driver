# frozen_string_literal: true

require "json"

module VedaDB
  # Change streams for real-time data change notifications.
  #
  # Watches a table (or all tables) and yields change events:
  #   db.watch("users").each do |event|
  #     puts "#{event['type']}: #{event['data']}"
  #   end
  #
  # Block form:
  #   db.watch("orders") do |stream|
  #     stream.each { |event| process(event) }
  #   end
  #
  # Filter by operation type:
  #   db.watch("logs").on(:insert) { |ev| puts "New log: #{ev}" }
  class ChangeStream
    include Enumerable

    attr_reader :client, :table, :filters, :resume_token

    def initialize(client, table = nil)
      @client        = client
      @table         = table
      @filters       = []
      @running       = false
      @handlers      = Hash.new { |h, k| h[k] = [] }
      @resume_token  = nil
      @mutex         = Mutex.new
      @buffer        = []
    end

    # Start watching and yield each change event.
    #
    # @yieldparam event [Hash] change event with keys: type, table, data, timestamp
    def each
      return enum_for(:each) unless block_given?

      @mutex.synchronize { @running = true }

      while @running
        events = poll_changes
        events.each do |event|
          @resume_token = event["token"] if event["token"]

          next unless @table.nil? || event["table"] == @table
          next unless @filters.empty? || @filters.include?(event["type"].to_sym)

          yield event
        end

        sleep 0.1 if events.empty?
      end
    end

    # Register a typed handler.
    #
    # @param type [Symbol] :insert, :update, :delete
    # @yieldparam event [Hash]
    def on(type, &block)
      @handlers[type.to_sym] << block
      self
    end

    # Add a filter for operation types.
    #
    # @param *types [Array<Symbol>] :insert, :update, :delete
    def filter(*types)
      @filters.concat(types.map(&:to_sym))
      self
    end

    # Start the stream in a background thread.
    #
    # @return [Thread] the background thread
    def start
      @mutex.synchronize { @running = true }

      @thread = Thread.new do
        each do |event|
          dispatch_handlers(event)
        end
      end

      @thread
    end

    # Stop the stream.
    def stop
      @mutex.synchronize { @running = false }
      @thread&.join(2)
    end

    # Is the stream currently running?
    def running?
      @mutex.synchronize { @running }
    end

    # Close the stream.
    def close
      stop
      @handlers.clear
      @buffer.clear
    end

    # Get the next single event (blocking).
    #
    # @return [Hash, nil]
    def next_event
      enum_for(:each).first
    end

    private

    def poll_changes
      sql = if @resume_token
              "WATCH #{'TABLE ' + @table if @table} TOKEN '#{@resume_token}'"
            else
              "WATCH #{'TABLE ' + @table if @table}"
            end

      result = @client.query(sql + ";")
      return [] unless result.rows && !result.rows.empty?

      result.rows.map do |row|
        parse_event(row)
      end
    rescue StandardError => e
      @running = false if e.is_a?(ConnectionError)
      []
    end

    def parse_event(row)
      {
        "type"      => row[0],
        "table"     => row[1],
        "data"      => parse_json(row[2]),
        "timestamp" => row[3],
        "token"     => row[4],
      }
    end

    def parse_json(str)
      return {} unless str

      JSON.parse(str)
    rescue JSON::ParserError
      str
    end

    def dispatch_handlers(event)
      type = event["type"]&.to_sym
      handlers = @mutex.synchronize { @handlers[type]&.dup }
      return unless handlers

      handlers.each do |handler|
        begin
          handler.call(event)
        rescue StandardError => e
          warn "[VedaDB::ChangeStream] handler error: #{e.message}"
        end
      end
    end
  end
end
