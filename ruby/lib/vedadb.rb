# frozen_string_literal: true

require_relative "vedadb/version"
require_relative "vedadb/errors"
require_relative "vedadb/protocol"
require_relative "vedadb/result"
require_relative "vedadb/retry"
require_relative "vedadb/circuit_breaker"
require_relative "vedadb/health"
require_relative "vedadb/cache"
require_relative "vedadb/cursor"
require_relative "vedadb/bulk"
require_relative "vedadb/pubsub"
require_relative "vedadb/uri"
require_relative "vedadb/tls"
require_relative "vedadb/change_stream"
require_relative "vedadb/query_builder"
require_relative "vedadb/rw_split"
require_relative "vedadb/load_balancer"
require_relative "vedadb/metrics"
require_relative "vedadb/interceptor"
require_relative "vedadb/failover"
require_relative "vedadb/pool"
require_relative "vedadb/client"

module VedaDB
  # Convenience method to create and connect a client.
  #
  #   VedaDB.connect("localhost", 6380) do |db|
  #     db.query("SELECT * FROM users;")
  #   end
  #
  #   # With options
  #   VedaDB.connect("localhost", 6380, timeout: 10, tls: true) do |db|
  #     db.query("SELECT 1;")
  #   end
  def self.connect(host = "localhost", port = 6380, **config, &block)
    Client.open(host, port, **config, &block)
  end

  # Connect from a URI string.
  #
  #   VedaDB.connect_uri("vedadb://admin:pass@db.example.com:6380/mydb?tls=true")
  def self.connect_uri(uri_string, **extra_config, &block)
    Client.from_uri(uri_string, **extra_config, &block)
  end

  # Create a connection pool.
  #
  #   pool = VedaDB.pool("localhost", 6380, max_size: 10)
  #   pool.with_connection do |db|
  #     db.query("SELECT * FROM users;")
  #   end
  def self.pool(host = "localhost", port = 6380, **config)
    Pool.new(host, port, **config)
  end

  # Create a load-balanced cluster client.
  #
  #   nodes = [
  #     VedaDB::Client.new("db1", 6380),
  #     VedaDB::Client.new("db2", 6380),
  #   ]
  #   lb = VedaDB.load_balancer(nodes, strategy: :round_robin)
  #   lb.with { |db| db.query("SELECT 1;") }
  def self.load_balancer(nodes, **config)
    LoadBalancer.new(nodes, **config)
  end

  # Create a read/write splitter.
  #
  #   splitter = VedaDB.rw_split(
  #     primary: primary_client,
  #     replicas: [replica1, replica2]
  #   )
  def self.rw_split(primary:, replicas:, **config)
    RWSplit.new(primary: primary, replicas: replicas, **config)
  end

  # Create a failover manager.
  #
  #   nodes = [{ host: "db1", port: 6380 }, { host: "db2", port: 6380 }]
  #   fo = VedaDB.failover(nodes)
  #   client = fo.client
  def self.failover(nodes, **config)
    Failover.new(nodes, **config)
  end

  # Parse a VedaDB URI.
  def self.parse_uri(uri_string)
    URI.parse(uri_string)
  end

  # Build a VedaDB URI from a config hash.
  def self.build_uri(config = {})
    URI.build(config)
  end
end
