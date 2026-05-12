# frozen_string_literal: true

module VedaDB
  # Load balancer across multiple VedaDB nodes.
  #
  # Strategies:
  #   :round_robin   — cycle through nodes
  #   :random        — pick a random node
  #   :least_conn    — node with fewest active connections
  #   :hash          — consistent hashing by key
  #
  # Usage:
  #   nodes = [
  #     VedaDB::Client.new("db1", 6380),
  #     VedaDB::Client.new("db2", 6380),
  #     VedaDB::Client.new("db3", 6380),
  #   ]
  #   lb = VedaDB::LoadBalancer.new(nodes, strategy: :round_robin)
  #   client = lb.next
  #   client.query("SELECT * FROM users;")
  class LoadBalancer
    STRATEGIES = %i[round_robin random least_conn hash].freeze

    attr_reader :nodes, :strategy, :node_count

    def initialize(nodes, strategy: :round_robin)
      raise ArgumentError, "At least one node required" if nodes.nil? || nodes.empty?

      @nodes      = nodes.dup.freeze
      @strategy   = strategy
      @node_count = nodes.size
      @index      = 0
      @mutex      = Mutex.new
      @active     = Hash.new(0) # node_index -> active connection count
      @health     = Array.new(nodes.size, true)
      @stats      = { total: 0, failures: 0 }
    end

    # Get the next node according to the strategy.
    #
    # @return [Client]
    def next(key = nil)
      node = pick_node(key)
      track_active(node)
      node
    end

    # Yield a block with an auto-released node.
    def with(key = nil)
      node = next(key)
      begin
        yield node
      ensure
        release(node)
      end
    end

    # Mark a node as unhealthy.
    def mark_unhealthy(node)
      idx = @nodes.index(node)
      @mutex.synchronize { @health[idx] = false } if idx
    end

    # Mark a node as healthy.
    def mark_healthy(node)
      idx = @nodes.index(node)
      @mutex.synchronize { @health[idx] = true } if idx
    end

    # List healthy nodes.
    def healthy_nodes
      @mutex.synchronize do
        @nodes.each_with_index.select { |_, i| @health[i] }.map(&:first)
      end
    end

    # List unhealthy nodes.
    def unhealthy_nodes
      @mutex.synchronize do
        @nodes.each_with_index.reject { |_, i| @health[i] }.map(&:first)
      end
    end

    # Health check all nodes.
    def health_check
      @nodes.each_with_index do |node, i|
        begin
          node.ping
          mark_healthy(node)
        rescue StandardError
          mark_unhealthy(node)
        end
      end
    end

    # Statistics.
    def stats
      @mutex.synchronize do
        @stats.dup.merge(
          total_nodes: @node_count,
          healthy: @health.count(true),
          unhealthy: @health.count(false),
          active_connections: @active.values.sum
        )
      end
    end

    # Close all node connections.
    def close
      @nodes.each(&:close)
    end

    private

    def pick_node(key)
      case @strategy
      when :round_robin then round_robin
      when :random      then random_node
      when :least_conn  then least_connections
      when :hash        then hash_strategy(key)
      else
        round_robin
      end
    end

    def round_robin
      @mutex.synchronize do
        healthy = healthy_indices
        raise ConnectionError, "No healthy nodes available" if healthy.empty?

        idx = healthy[@index % healthy.size]
        @index += 1
        @nodes[idx]
      end
    end

    def random_node
      healthy = healthy_indices
      raise ConnectionError, "No healthy nodes available" if healthy.empty?

      @nodes[healthy.sample]
    end

    def least_connections
      healthy = healthy_indices
      raise ConnectionError, "No healthy nodes available" if healthy.empty?

      @mutex.synchronize do
        idx = healthy.min_by { |i| @active[i] }
        @nodes[idx]
      end
    end

    def hash_strategy(key)
      raise ArgumentError, "Hash strategy requires a key" if key.nil?

      healthy = healthy_indices
      raise ConnectionError, "No healthy nodes available" if healthy.empty?

      idx = healthy[key.hash % healthy.size]
      @nodes[idx]
    end

    def healthy_indices
      @mutex.synchronize do
        @health.each_index.select { |i| @health[i] }
      end
    end

    def track_active(node)
      idx = @nodes.index(node)
      @mutex.synchronize { @active[idx] += 1 } if idx
    end

    def release(node)
      idx = @nodes.index(node)
      @mutex.synchronize { @active[idx] = [0, @active[idx] - 1].max } if idx
    end
  end
end
