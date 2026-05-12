# frozen_string_literal: true

require "thread"

module VedaDB
  # In-memory query cache with TTL support.
  #
  # Usage:
  #   cache = VedaDB::Cache.new(ttl: 60, max_size: 1000)
  #   cache.get("SELECT * FROM users;") do
  #     db.query("SELECT * FROM users;")
  #   end
  #
  #   cache.set("key", value, ttl: 30)
  #   cache.invalidate("users")
  #   cache.clear
  class Cache
    attr_reader :default_ttl, :max_size, :hits, :misses

    def initialize(ttl: 60, max_size: 1000)
      @default_ttl = ttl
      @max_size    = max_size
      @store       = {}
      @expires     = {}
      @mutex       = Mutex.new
      @hits        = 0
      @misses      = 0
      @evictions   = 0
    end

    # Fetch from cache or execute the block and cache the result.
    #
    # @param key [String] cache key
    # @param ttl [Integer] override TTL in seconds
    # @yield block to execute on cache miss
    # @return the cached or computed value
    def get(key, ttl: @default_ttl)
      @mutex.synchronize do
        cleanup_expired

        entry = @store[key]
        if entry && !expired?(key)
          @hits += 1
          return entry
        end

        @misses += 1
      end

      value = yield

      @mutex.synchronize do
        evict_if_needed
        @store[key]   = value
        @expires[key] = Time.now + ttl if ttl > 0
      end

      value
    end

    # Store a value directly.
    #
    # @param key [String]
    # @param value [Object]
    # @param ttl [Integer] seconds until expiry (0 = no expiry)
    def set(key, value, ttl = @default_ttl)
      @mutex.synchronize do
        cleanup_expired
        evict_if_needed

        @store[key]   = value
        @expires[key] = ttl > 0 ? Time.now + ttl : nil
      end
    end

    # Check if a key exists and is not expired.
    def has?(key)
      @mutex.synchronize do
        @store.key?(key) && !expired?(key)
      end
    end
    alias include? has?

    # Remove a specific key.
    def delete(key)
      @mutex.synchronize do
        @store.delete(key)
        @expires.delete(key)
      end
    end

    # Invalidate all entries matching a table name or pattern.
    def invalidate(pattern)
      @mutex.synchronize do
        @store.keys.each do |key|
          if key.include?(pattern.to_s)
            @store.delete(key)
            @expires.delete(key)
          end
        end
      end
    end

    # Remove all entries.
    def clear
      @mutex.synchronize do
        @store.clear
        @expires.clear
      end
    end

    # Current number of cached entries.
    def size
      @mutex.synchronize do
        cleanup_expired
        @store.size
      end
    end

    # Cache statistics.
    def stats
      @mutex.synchronize do
        {
          size: @store.size,
          max_size: @max_size,
          hits: @hits,
          misses: @misses,
          evictions: @evictions,
          hit_rate: (@hits + @misses) > 0 ? @hits.to_f / (@hits + @misses) : 0.0,
        }
      end
    end

    private

    def expired?(key)
      expiry = @expires[key]
      return false if expiry.nil?

      Time.now > expiry
    end

    def cleanup_expired
      now = Time.now
      @expires.each do |key, expiry|
        @store.delete(key) if expiry && now > expiry
      end
      @expires.delete_if { |_, expiry| expiry && now > expiry }
    end

    def evict_if_needed
      return if @store.size < @max_size

      # Evict oldest (first inserted)
      oldest = @store.keys.first
      @store.delete(oldest)
      @expires.delete(oldest)
      @evictions += 1
    end
  end
end
