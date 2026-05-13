# frozen_string_literal: true

module VedaDB
  # ChangeStream subscribes to table changes (CDC) from VedaDB.
  #
  # @example
  #   stream = client.watch("users", operations: ["INSERT", "UPDATE"], resume_from_lsn: 12345)
  #   stream.each do |event|
  #     puts "#{event["operation"]} on #{event["table"]}"
  #   end
  class ChangeStream
    attr_reader :client, :table, :operations, :resume_from_lsn, :last_lsn

    def initialize(client, table = nil, **options)
      @client = client
      @table = table
      @operations = (options[:operations] || []).map(&:to_s).map(&:upcase)
      @resume_from_lsn = options[:resume_from_lsn] || 0
      @include_before = options[:include_before] || false
      @poll_interval = options[:poll_interval] || 0.1
      @last_lsn = @resume_from_lsn
      @active = false
      @mutex = Mutex.new
      @listeners = []
    end

    def on_event(&block)
      @listeners << block
    end

    def start
      @mutex.synchronize do
        return self if @active
        @active = true
      end
      @thread = Thread.new { run_loop }
      self
    end

    def stop
      @mutex.synchronize { @active = false }
      @thread&.join(2)
      self
    end

    def active?
      @mutex.synchronize { @active }
    end

    def each
      raise ArgumentError, "Block required" unless block_given?
      start unless active?
      loop do
        break unless active?
        event = poll
        break unless event
        yield event
      end
    end

    def poll(timeout: 5)
      start unless active?
      deadline = Time.now + timeout
      loop do
        return nil if Time.now > deadline
        return nil unless active?
        result = @client.query(build_sql)
        (result.rows || []).each do |row|
          event = parse_row(row, result.columns)
          next if event.nil? || !matches_filter?(event)
          @last_lsn = event["lsn"] || 0
          @listeners.each { |l| l.call(event) rescue nil }
          return event
        end
        sleep(@poll_interval)
      end
    end

    def resume_token
      { lsn: @last_lsn, table: @table, time: Time.now.to_i }.to_json
    end

    def resume_from_token(token)
      parsed = JSON.parse(token)
      @resume_from_lsn = parsed["lsn"] || 0
      @last_lsn = @resume_from_lsn
      @table = parsed["table"] if parsed["table"]
      self
    end

    private

    def run_loop
      while active?
        begin
          result = @client.query(build_sql)
          (result.rows || []).each do |row|
            event = parse_row(row, result.columns)
            next if event.nil? || !matches_filter?(event)
            @last_lsn = event["lsn"] || 0
            @listeners.each { |l| l.call(event) rescue nil }
          end
          sleep(@poll_interval)
        rescue => e
          sleep(1)
        end
      end
    end

    def build_sql
      sql = "WATCH"
      sql << " "#{@table}"" if @table
      sql << " RESUME LSN #{@resume_from_lsn}" if @resume_from_lsn > 0
      unless @operations.empty?
        sql << " FILTER (#{@operations.join(",")})"
      end
      sql << ";"
      sql
    end

    def parse_row(row, columns)
      return nil if row.nil? || columns.nil?
      event = {}
      columns.each_with_index do |col, i|
        event[col] = row[i] if i < row.length
      end
      event["operation"] ? event : nil
    end

    def matches_filter?(event)
      return true if @operations.empty?
      op = (event["operation"] || "").to_s.upcase
      @operations.include?(op)
    end
  end
end
