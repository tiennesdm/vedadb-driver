# frozen_string_literal: true

require "uri"

module VedaDB
  # Parse VedaDB connection URIs into configuration hashes.
  #
  # Supported formats:
  #   vedadb://host:port/db
  #   vedadb://user:pass@host:port/db?timeout=30&tls=true
  #   vedadb://host1:6380,host2:6380,host3:6380/db
  #
  # Examples:
  #   VedaDB::URI.parse("vedadb://localhost:6380/mydb")
  #   VedaDB::URI.parse("vedadb://admin:secret@db.example.com:6380/prod?tls=true&timeout=15")
  class URI
    DEFAULT_PORT = 6380
    DEFAULT_HOST = "localhost"
    SCHEME       = "vedadb"

    # Parse a VedaDB URI string into a config hash.
    def self.parse(uri_string)
      raise URIError, "URI is nil or empty" if uri_string.nil? || uri_string.to_s.strip.empty?

      uri = ::URI.parse(uri_string.to_s)
      unless uri.scheme == SCHEME
        raise URIError, "Invalid scheme '#{uri.scheme}', expected '#{SCHEME}'"
      end

      config = build_config(uri)
      parse_query_params(uri, config)
      parse_multiple_hosts(uri, config)

      config
    rescue ::URI::InvalidURIError => e
      raise URIError, "Malformed URI: #{e.message}"
    end

    # Build a URI string from a config hash.
    def self.build(config = {})
      host = config[:host] || DEFAULT_HOST
      port = config[:port] || DEFAULT_PORT
      db   = config[:database] || config[:db]

      parts = ["#{SCHEME}://"]

      if config[:username]
        parts << ::URI.encode_www_form_component(config[:username])
        parts << ":#{::URI.encode_www_form_component(config[:password])}" if config[:password]
        parts << "@"
      end

      if config[:hosts] && config[:hosts].is_a?(Array) && config[:hosts].size > 1
        parts << config[:hosts].map { |h| "#{h[:host]}:#{h[:port]}" }.join(",")
      else
        parts << "#{host}:#{port}"
      end

      parts << "/#{db}" if db

      query = build_query(config)
      parts << "?#{query}" unless query.empty?

      parts.join
    end

    # Validate that a URI string is well-formed for VedaDB.
    def self.valid?(uri_string)
      parse(uri_string)
      true
    rescue URIError
      false
    end

    class << self
      private

      def build_config(uri)
        {
          host: uri.hostname || DEFAULT_HOST,
          port: uri.port || DEFAULT_PORT,
          database: uri.path.to_s.sub(%r{^/}, "").empty? ? nil : uri.path.to_s.sub(%r{^/}, ""),
          username: uri.user,
          password: uri.password,
        }
      end

      def parse_query_params(uri, config)
        return unless uri.query

        query = ::URI.decode_www_form(uri.query).to_h

        config[:timeout] = query["timeout"].to_i if query["timeout"]
        config[:tls] = truthy?(query["tls"]) if query.key?("tls")
        config[:tls_verify] = truthy?(query["tls_verify"]) if query.key?("tls_verify")
        config[:pool_size] = query["pool_size"].to_i if query["pool_size"]
        config[:pool_timeout] = query["pool_timeout"].to_f if query["pool_timeout"]
        config[:retry_max] = query["retry_max"].to_i if query["retry_max"]
        config[:retry_base] = query["retry_base"].to_f if query["retry_base"]
        config[:circuit_breaker] = truthy?(query["circuit_breaker"]) if query.key?("circuit_breaker")
        config[:failover] = truthy?(query["failover"]) if query.key?("failover")
        config[:read_preference] = query["read_preference"] if query["read_preference"]
        config[:cache_ttl] = query["cache_ttl"].to_i if query["cache_ttl"]

        query.each do |key, value|
          config[key.to_sym] = value unless config.key?(key.to_sym)
        end
      end

      def parse_multiple_hosts(uri, config)
        host_part = uri.host.to_s
        return unless host_part.include?(",")

        hosts = host_part.split(",").map do |h|
          if h.include?(":")
            host, port = h.split(":", 2)
            { host: host, port: port.to_i }
          else
            { host: h, port: DEFAULT_PORT }
          end
        end

        config[:hosts] = hosts
        config[:host] = hosts.first[:host]
        config[:port] = hosts.first[:port]
        config[:failover] = true if hosts.size > 1
      end

      def truthy?(val)
        val == "true" || val == "1" || val == "yes"
      end

      def build_query(config)
        params = {}
        %i[timeout tls tls_verify pool_size retry_max circuit_breaker cache_ttl read_preference].each do |key|
          params[key.to_s] = config[key] if config.key?(key) && !config[key].nil?
        end
        ::URI.encode_www_form(params)
      end
    end
  end
end
