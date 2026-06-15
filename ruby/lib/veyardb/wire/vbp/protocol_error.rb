# frozen_string_literal: true

# vbp/protocol_error.rb — VBP protocol-level error class hierarchy.

module VedaDB
  module Wire
    module VBP
      # Base class for VBP protocol-level errors.
      class VBPProtocolError < StandardError
        def initialize(message = 'VBP protocol error')
          super
        end
      end

      # Bad magic (expected 'VDB' = 0x56 0x44 0x42, got something else).
      class VBPBadMagic < VBPProtocolError; end

      # Frame header is shorter than 8 bytes or body is shorter than
      # the declared payload_length.
      class VBPTruncated < VBPProtocolError; end

      # Frame payload_length exceeds MAX_FRAME_LEN.
      class VBPOversize < VBPProtocolError; end

      # TCP socket closed mid-stream.
      class VBPConnectionClosed < VBPProtocolError; end
    end
  end
end
