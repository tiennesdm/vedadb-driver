# frozen_string_literal: true

require "json"

module VedaDB
  # Publish/Subscribe messaging over VedaDB.
  #
  # Usage:
  #   pubsub = db.pubsub
  #
  #   # Subscribe
  #   pubsub.subscribe("orders") do |channel, message|
  #     puts "[#{channel}] #{message}"
  #   end
  #
  #   # Subscribe to multiple channels
  #   pubsub.subscribe("events", "notifications") { |ch, msg| ... }
  #
  #   # Publish
  #   pubsub.publish("orders", { id: 1, status: "shipped" })
  #
  #   # Unsubscribe
  #   pubsub.unsubscribe("orders")
  #   pubsub.close
  class PubSub
    attr_reader :channels, :client

    def initialize(client)
      @client    = client
      @channels  = {}
      @handlers  = Hash.new { |h, k| h[k] = [] }
      @listeners = {}
      @mutex     = Mutex.new
      @running   = false
    end

    # Subscribe to one or more channels with a block handler.
    #
    # @param *channel_names [Array<String>] channels to subscribe to
    # @yield [channel, message] called for each message
    # @return [Thread] the listener thread
    def subscribe(*channel_names, &block)
      raise ArgumentError, "Block required for subscribe" unless block_given?

      @mutex.synchronize do
        channel_names.each do |ch|
          @handlers[ch] << block
          @channels[ch] = true
        end
      end

      channel_names.each do |ch|
        @client.query("SUBSCRIBE '#{ch}';")
      end

      start_listener unless listening?
    end

    # Publish a message to a channel.
    #
    # @param channel [String] target channel
    # @param message [String, Hash, Array] message payload
    # @return [Result]
    def publish(channel, message)
      payload = message.is_a?(String) ? message : JSON.generate(message)
      @client.query("PUBLISH '#{channel}' '#{payload}';")
    end

    # Unsubscribe from one or more channels.
    def unsubscribe(*channel_names)
      channel_names.each do |ch|
        @mutex.synchronize do
          @handlers.delete(ch)
          @channels.delete(ch)
        end
        @client.query("UNSUBSCRIBE '#{ch}';")
      end
    end

    # Unsubscribe from all channels.
    def unsubscribe_all
      channels_copy = @mutex.synchronize { @channels.keys }
      unsubscribe(*channels_copy)
    end

    # True if subscribed to at least one channel.
    def subscribed?
      @mutex.synchronize { !@channels.empty? }
    end

    # List currently subscribed channels.
    def subscribed_channels
      @mutex.synchronize { @channels.keys.dup }
    end

    # Is the listener thread running?
    def listening?
      @mutex.synchronize { @running }
    end

    # Stop all listeners and clean up.
    def close
      @mutex.synchronize { @running = false }
      unsubscribe_all
      @listeners.values.each do |t|
        begin
          t.kill
        rescue StandardError
          nil
        end
      end
      @listeners.clear
    end

    private

    def start_listener
      @mutex.synchronize { @running = true }

      thread = Thread.new do
        while @running
          begin
            msg = poll_message
            next unless msg

            channel = msg["channel"]
            payload = msg["payload"]

            handlers = @mutex.synchronize { @handlers[channel]&.dup }
            next unless handlers

            handlers.each do |handler|
              begin
                handler.call(channel, payload)
              rescue StandardError => e
                # Handler errors must not crash the listener
                warn "[VedaDB::PubSub] handler error: #{e.message}"
              end
            end
          rescue StandardError => e
            sleep 0.1 unless @running
          end
        end
      end

      @mutex.synchronize { @listeners[thread.object_id] = thread }
      thread
    end

    def poll_message
      # Use a dedicated listen socket approach
      # In production this would use a long-polling LISTEN command
      result = @client.query("LISTEN WAIT 1;")
      return nil unless result.rows && !result.rows.empty?

      row = result.rows.first
      { "channel" => row[0], "payload" => row[1] }
    rescue StandardError
      nil
    end
  end
end
