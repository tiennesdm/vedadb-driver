# frozen_string_literal: true

require "openssl"
require "socket"

module VedaDB
  # TLS/SSL connection upgrade for VedaDB.
  #
  # Usage:
  #   socket = VedaDB::TLS.upgrade(tcp_socket, host: "db.example.com", verify: true)
  #
  #   # With client certificates:
  #   socket = VedaDB::TLS.upgrade(tcp_socket,
  #     host: "db.example.com",
  #     verify: true,
  #     cert_file: "/path/to/client.crt",
  #     key_file: "/path/to/client.key",
  #     ca_file: "/path/to/ca.crt"
  #   )
  class TLS
    DEFAULT_MIN_VERSION = OpenSSL::SSL::TLS1_2_VERSION

    # Upgrade a plain TCP socket to TLS.
    #
    # @param socket [TCPSocket] the plain TCP socket
    # @param host [String] hostname for SNI and certificate verification
    # @param verify [Boolean] whether to verify server certificate
    # @param cert_file [String, nil] path to client certificate PEM
    # @param key_file [String, nil] path to client private key PEM
    # @param ca_file [String, nil] path to CA bundle PEM
    # @param ca_path [String, nil] path to CA certificates directory
    # @param min_version [Integer] minimum TLS version (default TLS 1.2)
    # @return [OpenSSL::SSL::SSLSocket]
    # @raise [TLSError] if the TLS handshake fails
    def self.upgrade(socket, host:, verify: true, cert_file: nil, key_file: nil,
                     ca_file: nil, ca_path: nil, min_version: DEFAULT_MIN_VERSION)
      context = build_context(
        verify: verify,
        cert_file: cert_file,
        key_file: key_file,
        ca_file: ca_file,
        ca_path: ca_path,
        min_version: min_version
      )

      ssl_socket = OpenSSL::SSL::SSLSocket.new(socket, context)
      ssl_socket.hostname = host if ssl_socket.respond_to?(:hostname=)

      begin
        ssl_socket.connect
      rescue OpenSSL::SSL::SSLError => e
        raise TLSError, "TLS handshake failed: #{e.message}"
      end

      if verify
        verify_cert!(ssl_socket, host)
      end

      ssl_socket
    end

    # Perform a STARTTLS upgrade over an existing VedaDB connection.
    #
    # @param socket [TCPSocket] connected TCP socket
    # @param protocol [Protocol] the protocol handler for framing
    # @param host [String] hostname for SNI verification
    # @param verify [Boolean] verify server certificate
    # @return [OpenSSL::SSL::SSLSocket]
    def self.starttls(socket, protocol:, host:, verify: true, **opts)
      socket.write(protocol.encode("STARTTLS"))
      response = protocol.read_frame(socket)
      data = protocol.decode(response)

      if data["error"]
        raise TLSError, "STARTTLS rejected by server: #{data['error']}"
      end

      upgrade(socket, host: host, verify: verify, **opts)
    end

    # Check if the underlying socket is TLS-encrypted.
    def self.tls?(socket)
      socket.is_a?(OpenSSL::SSL::SSLSocket)
    end

    # Get TLS connection info as a hash.
    def self.info(socket)
      return {} unless tls?(socket)

      {
        cipher: socket.cipher&.first,
        protocol: socket.ssl_version,
        cert_subject: socket.peer_cert&.subject&.to_s,
        cert_issuer: socket.peer_cert&.issuer&.to_s,
        cert_not_after: socket.peer_cert&.not_after,
      }
    end

    class << self
      private

      def build_context(verify:, cert_file:, key_file:, ca_file:, ca_path:, min_version:)
        ctx = OpenSSL::SSL::SSLContext.new
        ctx.min_version = min_version if ctx.respond_to?(:min_version=)
        ctx.verify_mode = verify ? OpenSSL::SSL::VERIFY_PEER : OpenSSL::SSL::VERIFY_NONE

        if cert_file && key_file
          ctx.cert = OpenSSL::X509::Certificate.new(File.read(cert_file))
          ctx.key = OpenSSL::PKey::RSA.new(File.read(key_file))
        end

        if ca_file
          ctx.ca_file = ca_file
        elsif ca_path
          ctx.ca_path = ca_path
        end

        ctx
      end

      def verify_cert!(ssl_socket, host)
        cert = ssl_socket.peer_cert
        raise TLSError, "No peer certificate presented" unless cert

        unless OpenSSL::SSL.verify_certificate_identity(cert, host)
          raise TLSError, "Certificate hostname mismatch: expected #{host}, got #{cert.subject}"
        end
      rescue OpenSSL::SSL::SSLError => e
        raise TLSError, "Certificate verification failed: #{e.message}"
      end
    end
  end
end
