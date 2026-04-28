# frozen_string_literal: true

require_relative "vedadb/errors"
require_relative "vedadb/result"
require_relative "vedadb/client"
require_relative "vedadb/pool"

module VedaDB
  VERSION = "0.2.0"

  # Convenience method to create and connect a client.
  #
  #   VedaDB.connect("localhost", 6380) do |db|
  #     db.query("SELECT * FROM users;")
  #   end
  def self.connect(host = "localhost", port = 6380, timeout: 30, &block)
    Client.open(host, port, timeout: timeout, &block)
  end
end
