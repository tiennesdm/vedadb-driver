# frozen_string_literal: true

# vbp/auth.rb — VBP authentication: PLAIN (RFC 4616) and SCRAM-SHA-256
# (RFC 5802 / RFC 7677).
#
# CRITICAL: the SCRAM c= binding is the gs2_header only ("n,,"), NOT
# gs2_header + "," + client_first_bare. The canonical pencil test
# vector is c=biws (base64("n,,")).
#
# CSPRNG: client_nonce MUST come from SecureRandom (Ruby's CSPRNG).
#
# Pure stdlib: openssl, securerandom, base64. No third-party deps.

require 'openssl'
require 'securerandom'
require 'base64'

require_relative 'opcodes'

module VedaDB
  module Wire
    module VBP
      class VBPAuthError < StandardError
        attr_reader :sqlstate

        def initialize(sqlstate, message)
          @sqlstate = sqlstate
          super("[#{sqlstate}] #{message}")
        end
      end

      def self.plain_client_first(username, password)
        # AUTH_RESPONSE body: [u8 mech=0x01][NUL authzid][authcid][NUL][password]
        ("\x01" + "\0#{username}\0#{password}").b
      end

      # SCRAM-SHA-256 client (RFC 5802).
      class SCRAMClient
        GS2_HEADER = 'n,,'.b

        def initialize(username, password)
          raise VBPAuthError.new(SQLSTATE_AUTH_FAILED, 'empty username') if username.nil? || username.empty?
          @username = username
          @password = password
          # 18 random bytes -> 24 base64 chars. CSPRNG required.
          @client_nonce = Base64.strict_encode64(SecureRandom.random_bytes(18))
          @auth_message = nil
          @client_proof = nil
          @stored_key = nil
          @salt_b64 = nil
          @iters = 0
        end

        attr_reader :client_nonce

        def client_first_bare
          "n=#{sasl_name(@username)},r=#{@client_nonce}"
        end

        def client_first
          "#{GS2_HEADER}#{client_first_bare}"
        end

        def client_final(server_first_msg)
          parsed = parse_server_first(server_first_msg)
          combined = parsed['r']
          unless combined&.start_with?(@client_nonce)
            raise VBPAuthError.new(SQLSTATE_AUTH_FAILED, 'server nonce does not begin with client nonce')
          end
          salt_b64 = parsed['s']
          iters = parsed['_iters']
          @salt_b64 = salt_b64
          @iters = iters

          cfb = client_first_bare
          # CRITICAL: cbind_input is just the gs2_header for gs2-flag 'n'.
          cbind_input = GS2_HEADER
          channel_binding = Base64.strict_encode64(cbind_input.b)
          client_final_without_proof = "c=#{channel_binding},r=#{combined}"
          server_first_recon = "r=#{combined},s=#{salt_b64},i=#{iters}"
          @auth_message = "#{cfb},#{server_first_recon},#{client_final_without_proof}".b

          salt = Base64.strict_decode64(salt_b64)
          salted_password = hi(@password, salt, iters)
          client_key = hmac_sha256(salted_password, 'Client Key')
          stored_key = OpenSSL::Digest::SHA256.digest(client_key)
          @stored_key = stored_key
          client_signature = hmac_sha256(stored_key, @auth_message)
          @client_proof = xor_bytes(client_key, client_signature)

          "#{client_final_without_proof},p=#{Base64.strict_encode64(@client_proof)}"
        end

        def verify_server_final(server_final_msg)
          return if @client_proof.nil? || @auth_message.nil?
          return if server_final_msg.nil? || !server_final_msg.start_with?('v=')
          server_sig = Base64.strict_decode64(server_final_msg[2..])
          salt = Base64.strict_decode64(@salt_b64)
          salted_password = hi(@password, salt, @iters)
          server_key = hmac_sha256(salted_password, 'Server Key')
          expected = hmac_sha256(server_key, @auth_message)
          unless server_sig == expected
            raise VBPAuthError.new(SQLSTATE_AUTH_FAILED, 'server signature mismatch')
          end
        end

        private

        def sasl_name(name)
          # RFC 5802 §5.1: replace '=' with '=3D' and ',' with '=2C'.
          name.to_s.gsub('=', '=3D').gsub(',', '=2C')
        end

        def parse_server_first(msg)
          out = {}
          msg.split(',').each do |part|
            ix = part.index('=')
            next unless ix && ix.positive?
            out[part[0, ix]] = part[(ix + 1)..]
          end
          unless out['r'] && out['s'] && out['i']
            raise VBPAuthError.new(SQLSTATE_AUTH_FAILED, "malformed server-first: missing r/s/i in #{msg.inspect}")
          end
          out['_iters'] = Integer(out['i'])
          out
        rescue ArgumentError
          raise VBPAuthError.new(SQLSTATE_AUTH_FAILED, "invalid iteration count: #{out['i']}")
        end

        def hi(password, salt, iters)
          OpenSSL::KDF.pbkdf2_hmac(
            password,
            salt: salt,
            iterations: iters,
            length: 32,
            hash: 'sha256'
          )
        end

        def hmac_sha256(key, msg)
          OpenSSL::HMAC.digest('sha256', key, msg)
        end

        def xor_bytes(a, b)
          raise 'mismatched length' unless a.bytesize == b.bytesize
          a.bytes.zip(b.bytes).map { |x, y| (x ^ y).chr }.join.b
        end
      end

      def self.perform_handshake(mux, opts)
        mechanism = (opts[:mechanism] || ENV['VEDADB_VBP_MECH'] || AUTH_MECH_PLAIN).to_s.upcase
        case mechanism
        when AUTH_MECH_NONE
          { session_token: 0, expires_at: 0, server_final: ''.b }
        when AUTH_MECH_PLAIN
          body = plain_client_first(opts[:username], opts[:password])
          replies = mux.call(OP_AUTH_RESPONSE, body)
          parse_auth_ok(replies)
        when AUTH_MECH_SCRAM_SHA_256
          scram = SCRAMClient.new(opts[:username], opts[:password])
          cf = scram.client_first
          replies1 = mux.call(OP_AUTH_RESPONSE, cf.b)
          ok = replies1.find { |f| f.op == OP_AUTH_OK }
          if ok
            return parse_auth_ok(replies1)
          end
          challenge = replies1.find { |f| f.op == OP_AUTH_CHALLENGE }
          unless challenge
            raise VBPAuthError.new(SQLSTATE_AUTH_FAILED, 'no AUTH_CHALLENGE from server')
          end
          server_first_msg = challenge.body.force_encoding(Encoding::UTF_8)
          client_final = scram.client_final(server_first_msg).b
          replies2 = mux.call(OP_AUTH_RESPONSE, client_final)
          res = parse_auth_ok(replies2)
          sf = res[:server_final]
          scram.verify_server_final(sf.force_encoding(Encoding::UTF_8)) if sf && !sf.empty?
          res
        else
          raise VBPAuthError.new('0A000', "unsupported auth mechanism: #{mechanism}")
        end
      end

      def self.parse_auth_ok(replies)
        ok = replies.find { |f| f.op == OP_AUTH_OK }
        raise VBPAuthError.new(SQLSTATE_AUTH_FAILED, 'no AUTH_OK in replies') unless ok
        body = ok.body
        if body.bytesize < 20
          return { session_token: 0, expires_at: 0, server_final: ''.b }
        end
        session_token = body.byteslice(0, 8).unpack1('Q<')
        expires_at = body.byteslice(8, 8).unpack1('Q<')
        sf_len = body.byteslice(16, 4).unpack1('V')
        server_final = body.byteslice(20, sf_len) || ''.b
        { session_token: session_token, expires_at: expires_at, server_final: server_final }
      end
    end
  end
end
