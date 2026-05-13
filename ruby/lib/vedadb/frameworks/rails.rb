# frozen_string_literal: true

require 'active_record'

module VedaDB
  # Rails ActiveRecord adapter for VedaDB.
  #
  # @example config/database.yml
  #   development:
  #     adapter: vedadb
  #     host: localhost
  #     port: 6380
  #     database: myapp_dev
  module RailsAdapter
    class Adapter < ActiveRecord::ConnectionAdapters::AbstractAdapter
      ADAPTER_NAME = 'vedadb'.freeze

      def initialize(connection, logger = nil, config = {})
        super
        @veda_client = connection
      end

      # Raw query execution
      def execute(sql, name = nil)
        log(sql, name) { @veda_client.query(sql) }
      end

      def exec_query(sql, name = 'SQL', binds = [])
        log(sql, name) do
          result = @veda_client.query(sql)
          ActiveRecord::Result.new(result.columns || [], result.rows || [])
        end
      end

      def begin_db_transaction
        @veda_client.begin_transaction
      end

      def commit_db_transaction
        @veda_client.commit
      end

      def rollback_db_transaction
        @veda_client.rollback
      end

      def active?
        @veda_client.ping
      end

      def reconnect!
        @veda_client.reconnect
      end

      def disconnect!
        @veda_client.close
      end

      # Schema statements
      def tables(name = nil)
        result = @veda_client.show_tables
        result.is_a?(Array) ? result : []
      end

      def primary_key(table)
        'id'
      end

      def columns(table_name)
        result = @veda_client.describe_table(table_name)
        (result.columns || []).map do |col|
          ActiveRecord::ConnectionAdapters::Column.new(col, nil, nil)
        end
      end

      def quote_column_name(name)
        ""#{name.to_s.gsub('"', '""')}""
      end

      def quote_table_name(name)
        ""#{name.to_s.gsub('"', '""')}""
      end

      def quote(value)
        case value
        when String then "'#{value.gsub("'", "''")}'"
        when NilClass then 'NULL'
        when TrueClass then 'TRUE'
        when FalseClass then 'FALSE'
        else value.to_s
        end
      end
    end

    # Connection pool management for Rails
    class ConnectionPool
      attr_reader :config

      def initialize(config = {})
        @config = config
        @pool = []
        @max_size = config[:pool] || 5
        @mutex = Mutex.new
      end

      def connection
        @mutex.synchronize do
          client = @pool.find { |c| c.connected? }
          unless client
            raise ConnectionError, 'Pool exhausted' if @pool.size >= @max_size
            client = Client.new(
              @config[:host] || 'localhost',
              (@config[:port] || 6380).to_i,
              **@config.symbolize_keys
            )
            @pool << client
          end
          yield client if block_given?
          client
        end
      end

      def with_connection
        connection { |client| yield(client) }
      end

      def release(client)
        # In this simple implementation, connections stay in the pool
      end

      def clear_stale!
        @mutex.synchronize do
          @pool.reject! do |client|
            unless client.connected?
              client.close rescue nil
              true
            end
          end
        end
      end

      def disconnect!
        @mutex.synchronize do
          @pool.each { |c| c.close rescue nil }
          @pool.clear
        end
      end
    end
  end
end

# Register the adapter
ActiveRecord::ConnectionAdapters.register(
  'vedadb',
  'VedaDB::RailsAdapter::Adapter',
  'vedadb/frameworks/rails'
) if defined?(ActiveRecord::ConnectionAdapters.register)
