# frozen_string_literal: true

# vbp/exception.rb — VBP runtime exception hierarchy.

require_relative 'opcodes'

module VedaDB
  module Wire
    module VBP
      class VBPRuntimeError < StandardError
        attr_reader :sqlstate

        def initialize(sqlstate, message)
          @sqlstate = sqlstate
          super("[#{sqlstate}] #{message}")
        end
      end

      class VBPConnectionError < VBPRuntimeError
        def initialize(message)
          super(SQLSTATE_CONNECTION_FAILURE, message)
        end
      end

      class VBPSyntaxError < VBPRuntimeError
        def initialize(message)
          super(SQLSTATE_SYNTAX_ERROR, message)
        end
      end
    end
  end
end
