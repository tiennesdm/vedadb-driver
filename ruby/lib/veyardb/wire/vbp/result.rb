# frozen_string_literal: true

# vbp/result.rb — VBP result wrapper.

module VedaDB
  module Wire
    module VBP
      class VBPResult
        attr_accessor :columns, :column_types, :rows, :command_tag, :rows_affected

        def initialize
          @columns = []
          @column_types = []
          @rows = []
          @command_tag = ''
          @rows_affected = 0
        end

        def to_a
          @rows
        end

        def each(&block)
          @rows.each(&block)
        end
      end
    end
  end
end
