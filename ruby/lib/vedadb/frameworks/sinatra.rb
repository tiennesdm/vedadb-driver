# frozen_string_literal: true

module VedaDB
  # Sinatra extension for VedaDB.
  #
  # @example
  #   require 'sinatra'
  #   require 'vedadb'
  #   require 'vedadb/frameworks/sinatra'
  #
  #   register VedaDB::Sinatra
  #
  #   configure do
  #     set :vedadb_host, 'localhost'
  #     set :vedadb_port, 6380
  #   end
  #
  #   get '/users' do
  #     result = vedadb.query("SELECT * FROM users;")
  #     json result.to_hashes
  #   end
  module Sinatra
    def self.registered(app)
      app.helpers Helpers

      app.before do
        @veda_client ||= VedaDB::Client.new(
          app.settings.vedadb_host || 'localhost',
          (app.settings.vedadb_port || 6380).to_i,
          **(app.settings.respond_to?(:vedadb_config) ? app.settings.vedadb_config : {})
        )
      end

      app.after do
        # Connection stays alive for reuse
      end
    end

    module Helpers
      # Access the VedaDB client.
      def vedadb
        @veda_client
      end

      # Execute inside a transaction.
      def vedadb_transaction
        vedadb.transaction { yield(vedadb) }
      end

      # Get a query builder for a table.
      def vedadb_table(name)
        vedadb.table(name)
      end

      # Release the client on error.
      def vedadb_close
        @veda_client&.close
      end
    end
  end
end
