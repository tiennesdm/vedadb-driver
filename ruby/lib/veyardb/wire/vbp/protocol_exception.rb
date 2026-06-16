# frozen_string_literal: true

# vbp/protocol_exception.rb — Alias for backwards compatibility.

require_relative 'exception'

module VedaDB
  module Wire
    module VBP
      VBPProtocolException = VBPRuntimeError
    end
  end
end
