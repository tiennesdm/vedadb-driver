# frozen_string_literal: true

module VedaDB
  # Multi-node failover with automatic leader election.
  #
  # Usage:
  #   nodes = [
  #     { host: "db1", port: 6380 },
  #     { host: "db2", port: 6380 },
  #     { host: "db3", port: 6380 },
  #   ]
  #   fo = VedaDB::Failover.new(nodes, connect_timeout: 5, retry_interval: 3)
  #   client = fo.client  # => connected to leader
  #   fo.leader           # => { host: "db1", port: 6380 }
  #   fo.followers        # => [{ host: "db2", ... }, { host: "db3", ... }]
  #   fo.failover!
  class Failover
    attr_reader :nodes, :connect_timeout, :retry_interval, :leader_index

    def initialize(nodes, connect_timeout: 5, retry_interval: 3)
      @nodes           = nodes.dup
      @connect_timeout = connect_timeout
      @retry_interval  = retry_interval
      @leader_index    = 0
      @clients         = {}
      @mutex           = Mutex.new
      @failover_count  = 0
    end

    # Get or create a client connected to the current leader.
    #
    # @return [Client]
    def client
      @mutex.synchronize do
        leader_node = @nodes[@leader_index]
        cache_key   = node_key(leader_node)

        cached = @clients[cache_key]
        return cached if cached && healthy?(cached)

        @clients[cache_key] = connect_to(leader_node)
      end
    end

    # Get the current leader node config.
    def leader
      @nodes[@leader_index]
    end

    # Get follower node configs.
    def followers
      @nodes.each_with_index
            .reject { |_, i| i == @leader_index }
            .map(&:first)
    end

    # Perform a manual failover to the next available node.
    #
    # @return [Boolean] true if failover succeeded
    def failover!
      @mutex.synchronize do
        old_leader = @leader_index
        @failover_count += 1

        # Try each node in order
        @nodes.each_with_index do |node, i|
          next if i == @leader_index

          begin
            new_client = connect_to(node)
            close_client(@leader_index)

            @leader_index = i
            @clients[node_key(node)] = new_client
            return true
          rescue StandardError
            next
          end
        end

        raise FailoverError, "No healthy nodes available for failover"
      end
    end

    # Health check all nodes, auto-failover if leader is down.
    #
    # @return [Hash] health status for each node
    def health_check(auto_failover: true)
      results = {}

      @nodes.each_with_index do |node, i|
        begin
          c = @clients[node_key(node)] || connect_to(node)
          ok = c.ping
          results[node_key(node)] = { healthy: ok, role: (i == @leader_index ? :leader : :follower) }
        rescue StandardError => e
          results[node_key(node)] = { healthy: false, error: e.message, role: (i == @leader_index ? :leader : :follower) }

          if auto_failover && i == @leader_index
            failover!
          end
        end
      end

      results
    end

    # Is the leader currently healthy?
    def leader_healthy?
      health_check(auto_failover: false)[node_key(leader)]&.dig(:healthy) || false
    end

    # Statistics.
    def stats
      @mutex.synchronize do
        {
          leader: leader,
          leader_index: @leader_index,
          node_count: @nodes.size,
          failover_count: @failover_count,
          connected_clients: @clients.size,
        }
      end
    end

    # Close all cached connections.
    def close
      @mutex.synchronize do
        @clients.values.each do |c|
          begin
            c.close
          rescue StandardError
            nil
          end
        end
        @clients.clear
      end
    end

    private

    def connect_to(node)
      Client.new(node[:host], node[:port], timeout: @connect_timeout)
    end

    def node_key(node)
      "#{node[:host]}:#{node[:port]}"
    end

    def healthy?(client)
      client.ping
    rescue StandardError
      false
    end

    def close_client(index)
      node = @nodes[index]
      key  = node_key(node)
      c    = @clients.delete(key)
      c&.close
    rescue StandardError
      nil
    end
  end
end
