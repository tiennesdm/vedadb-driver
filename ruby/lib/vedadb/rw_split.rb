# frozen_string_literal: true

module VedaDB
  # Read/write splitting: sends writes to the primary and reads to replicas.
  #
  # Usage:
  #   splitter = VedaDB::RWSplit.new(
  #     primary: primary_client,
  #     replicas: [replica1, replica2]
  #   )
  #   splitter.query("SELECT * FROM users;")  # => routed to replica
  #   splitter.exec("INSERT INTO users ...")    # => routed to primary
  #
  # URI:
  #   vedadb://primary:6380/mydb?read_preference=secondary
  class RWSplit
    READ_PREFERENCE_PRIMARY         = :primary
    READ_PREFERENCE_SECONDARY       = :secondary
    READ_PREFERENCE_PRIMARY_PREFERRED = :primary_preferred
    READ_PREFERENCE_SECONDARY_PREFERRED = :secondary_preferred

    attr_reader :primary, :replicas, :read_preference, :strategy

    def initialize(primary:, replicas:, read_preference: :secondary_preferred, strategy: :round_robin)
      @primary          = primary
      @replicas         = Array(replicas)
      @read_preference  = read_preference
      @strategy         = strategy
      @replica_index    = 0
      @mutex            = Mutex.new
      @stats            = { reads: 0, writes: 0, read_replicas: 0, read_primary: 0 }
    end

    # Execute a query (SELECT) — routed according to read preference.
    def query(sql)
      route(sql).query(sql).tap { track(:read, sql) }
    end

    # Execute a statement (INSERT/UPDATE/DELETE/DDL) — always primary.
    def exec(sql)
      @primary.exec(sql).tap { track(:write, sql) }
    end

    # Execute any SQL, auto-routing based on statement type.
    def execute(sql)
      if write?(sql)
        exec(sql)
      else
        query(sql)
      end
    end

    # Is the given SQL a write operation?
    def write?(sql)
      sql = sql.to_s.strip.upcase
      sql.match?(/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|PREPARE|EXECUTE|CACHE\s+SET|CACHE\s+DEL)/)
    end

    # Is the given SQL a read operation?
    def read?(sql)
      !write?(sql)
    end

    # Health check all nodes.
    def ping_all
      {
        primary: @primary.ping,
        replicas: @replicas.map.with_index do |r, i|
          { index: i, healthy: r.ping }
        end
      }
    end

    # Statistics on routing decisions.
    def stats
      @mutex.synchronize { @stats.dup.merge(replica_count: @replicas.size) }
    end

    # Choose a replica using the configured strategy.
    def pick_replica
      case @strategy
      when :round_robin then round_robin
      when :random      then @replicas.sample
      when :least_loaded
        # Simple round-robin for now; extend with load tracking
        round_robin
      else
        @replicas.first
      end
    end

    # Add a replica.
    def add_replica(client)
      @mutex.synchronize { @replicas << client }
    end

    # Remove a replica.
    def remove_replica(client)
      @mutex.synchronize { @replicas.delete(client) }
    end

    # Close all connections.
    def close
      @primary.close
      @replicas.each(&:close)
    end

    private

    def route(sql)
      if write?(sql)
        return @primary
      end

      case @read_preference
      when READ_PREFERENCE_PRIMARY
        @primary
      when READ_PREFERENCE_SECONDARY
        @replicas.empty? ? @primary : pick_replica
      when READ_PREFERENCE_PRIMARY_PREFERRED
        @primary
      when READ_PREFERENCE_SECONDARY_PREFERRED
        @replicas.empty? ? @primary : pick_replica
      else
        @primary
      end
    end

    def round_robin
      @mutex.synchronize do
        replica = @replicas[@replica_index % @replicas.size]
        @replica_index += 1
        replica
      end
    end

    def track(op, sql)
      @mutex.synchronize do
        case op
        when :read
          @stats[:reads] += 1
          if read?(sql) && route(sql) != @primary
            @stats[:read_replicas] += 1
          else
            @stats[:read_primary] += 1
          end
        when :write
          @stats[:writes] += 1
        end
      end
    end
  end
end
