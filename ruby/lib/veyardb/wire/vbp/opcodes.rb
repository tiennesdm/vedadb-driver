# frozen_string_literal: true

# vbp/opcodes.rb — VBP v1 opcode and type-ID constants.
#
# Opcodes are 1-byte identifiers for a frame's purpose. v1 defines
# exactly 23 mandatory opcodes (VBP_SPEC.md §3). Type IDs are 2-byte
# little-endian identifiers for column types (§5).
#
# Per VBP_SPEC.md §5 / §5.10, the v1 type set is 38 IDs (the spec's
# narrative "27" is a typo). The set below matches the Java + .NET POCs.

module VedaDB
  module Wire
    module VBP
      # Opcodes (VBP v1, 23 mandatory)
      OP_CLIENT_HELLO    = 0x01
      OP_SERVER_READY    = 0x02
      OP_AUTH_CHALLENGE  = 0x03
      OP_AUTH_RESPONSE   = 0x04
      OP_AUTH_OK         = 0x05
      OP_QUERY           = 0x06
      OP_EXT_QUERY       = 0x07
      OP_PARSE           = 0x08
      OP_BIND            = 0x09
      OP_DATA_CHUNK      = 0x0A
      OP_ROWS_FINISHED   = 0x0B
      OP_COMMAND_COMPLETE = 0x0C
      OP_ERROR           = 0x0D
      OP_BEGIN           = 0x0E
      OP_COMMIT          = 0x0F
      OP_ROLLBACK        = 0x10
      OP_COPY_IN         = 0x11
      OP_COPY_DONE       = 0x12
      OP_COPY_FAIL       = 0x13
      OP_CANCEL_QUERY    = 0x14
      # 0x15 reserved
      OP_PING            = 0x16
      OP_PONG            = 0x17
      OP_CLOSE           = 0x18

      MANDATORY_OPCODES = [
        OP_CLIENT_HELLO, OP_SERVER_READY, OP_AUTH_CHALLENGE, OP_AUTH_RESPONSE,
        OP_AUTH_OK, OP_QUERY, OP_EXT_QUERY, OP_PARSE, OP_BIND, OP_DATA_CHUNK,
        OP_ROWS_FINISHED, OP_COMMAND_COMPLETE, OP_ERROR, OP_BEGIN, OP_COMMIT,
        OP_ROLLBACK, OP_COPY_IN, OP_COPY_DONE, OP_COPY_FAIL, OP_CANCEL_QUERY,
        OP_PING, OP_PONG, OP_CLOSE
      ].freeze
      raise "VBP v1 must have exactly 23 opcodes" unless MANDATORY_OPCODES.length == 23

      OPCODE_NAMES = {
        OP_CLIENT_HELLO    => 'CLIENT_HELLO',
        OP_SERVER_READY    => 'SERVER_READY',
        OP_AUTH_CHALLENGE  => 'AUTH_CHALLENGE',
        OP_AUTH_RESPONSE   => 'AUTH_RESPONSE',
        OP_AUTH_OK         => 'AUTH_OK',
        OP_QUERY           => 'QUERY',
        OP_EXT_QUERY       => 'EXT_QUERY',
        OP_PARSE           => 'PARSE',
        OP_BIND            => 'BIND',
        OP_DATA_CHUNK      => 'DATA_CHUNK',
        OP_ROWS_FINISHED   => 'ROWS_FINISHED',
        OP_COMMAND_COMPLETE => 'COMMAND_COMPLETE',
        OP_ERROR           => 'ERROR',
        OP_BEGIN           => 'BEGIN',
        OP_COMMIT          => 'COMMIT',
        OP_ROLLBACK        => 'ROLLBACK',
        OP_COPY_IN         => 'COPY_IN',
        OP_COPY_DONE       => 'COPY_DONE',
        OP_COPY_FAIL       => 'COPY_FAIL',
        OP_CANCEL_QUERY    => 'CANCEL_QUERY',
        OP_PING            => 'PING',
        OP_PONG            => 'PONG',
        OP_CLOSE           => 'CLOSE'
      }.freeze

      def self.opcode_name(op)
        OPCODE_NAMES[op] || format('OP_0x%02X', op)
      end

      # Streaming-fix: terminal opcodes that REMOVE the inflight slot.
      TERMINAL_OPCODES = [OP_ROWS_FINISHED, OP_COMMAND_COMPLETE, OP_ERROR].freeze

      def self.terminal_opcode?(op)
        TERMINAL_OPCODES.include?(op)
      end

      # Type IDs (VBP v1, 38 IDs)
      T_BOOL              = 16
      T_INT2              = 21
      T_INT4              = 23
      T_INT8              = 20
      T_FLOAT4            = 700
      T_FLOAT8            = 701
      T_TEXT              = 25
      T_VARCHAR           = 1043
      T_BPCHAR            = 1042
      T_NAME              = 19
      T_OID               = 26
      T_BYTEA             = 17
      T_UUID              = 2950
      T_DATE              = 1082
      T_TIME              = 1083
      T_TIMESTAMP         = 1114
      T_TIMESTAMPTZ       = 1184
      T_INTERVAL          = 1186
      T_NUMERIC           = 1700
      T_MONEY             = 790
      T_JSON              = 114
      T_JSONB             = 3802
      T_ARRAY             = 2277
      T_INET              = 869
      T_MACADDR           = 829
      T_CIDR              = 650
      T_VECTOR            = 5000
      T_TSVECTOR          = 3614
      T_DOCUMENT          = 5100
      T_GRAPH_NODE        = 5300
      T_GRAPH_EDGE        = 5301
      T_TS_POINT          = 5400
      T_TS_SERIES         = 5401
      T_GEO_POINT         = 5500
      T_GEO_PATH          = 5501
      T_GEO_POLYGON       = 5502
      T_GEO_MULTIPOINT    = 5503
      T_GEO_MULTIPOLYGON  = 5504
      T_SEARCH_DOC        = 5600
      T_SEARCH_HIT        = 5601

      TYPE_IDS = [
        T_BOOL, T_INT2, T_INT4, T_INT8, T_FLOAT4, T_FLOAT8,
        T_TEXT, T_VARCHAR, T_BPCHAR, T_NAME, T_OID, T_BYTEA, T_UUID,
        T_DATE, T_TIME, T_TIMESTAMP, T_TIMESTAMPTZ, T_INTERVAL,
        T_NUMERIC, T_MONEY, T_JSON, T_JSONB, T_ARRAY,
        T_INET, T_MACADDR, T_CIDR,
        T_VECTOR, T_TSVECTOR, T_DOCUMENT,
        T_GRAPH_NODE, T_GRAPH_EDGE,
        T_TS_POINT, T_TS_SERIES,
        T_GEO_POINT, T_GEO_PATH, T_GEO_POLYGON, T_GEO_MULTIPOINT, T_GEO_MULTIPOLYGON,
        T_SEARCH_DOC, T_SEARCH_HIT
      ].freeze
      raise "VBP v1 type set must be 36-40 IDs (got #{TYPE_IDS.length})" unless (36..40).include?(TYPE_IDS.length)

      TYPE_ID_NAMES = {
        T_BOOL => 'T_BOOL', T_INT2 => 'T_INT2', T_INT4 => 'T_INT4', T_INT8 => 'T_INT8',
        T_FLOAT4 => 'T_FLOAT4', T_FLOAT8 => 'T_FLOAT8',
        T_TEXT => 'T_TEXT', T_VARCHAR => 'T_VARCHAR', T_BPCHAR => 'T_BPCHAR',
        T_NAME => 'T_NAME', T_OID => 'T_OID',
        T_BYTEA => 'T_BYTEA', T_UUID => 'T_UUID',
        T_DATE => 'T_DATE', T_TIME => 'T_TIME', T_TIMESTAMP => 'T_TIMESTAMP',
        T_TIMESTAMPTZ => 'T_TIMESTAMPTZ', T_INTERVAL => 'T_INTERVAL',
        T_NUMERIC => 'T_NUMERIC', T_MONEY => 'T_MONEY',
        T_JSON => 'T_JSON', T_JSONB => 'T_JSONB', T_ARRAY => 'T_ARRAY',
        T_INET => 'T_INET', T_MACADDR => 'T_MACADDR', T_CIDR => 'T_CIDR',
        T_VECTOR => 'T_VECTOR', T_TSVECTOR => 'T_TSVECTOR', T_DOCUMENT => 'T_DOCUMENT',
        T_GRAPH_NODE => 'T_GRAPH_NODE', T_GRAPH_EDGE => 'T_GRAPH_EDGE',
        T_TS_POINT => 'T_TS_POINT', T_TS_SERIES => 'T_TS_SERIES',
        T_GEO_POINT => 'T_GEO_POINT', T_GEO_PATH => 'T_GEO_PATH',
        T_GEO_POLYGON => 'T_GEO_POLYGON', T_GEO_MULTIPOINT => 'T_GEO_MULTIPOINT',
        T_GEO_MULTIPOLYGON => 'T_GEO_MULTIPOLYGON',
        T_SEARCH_DOC => 'T_SEARCH_DOC', T_SEARCH_HIT => 'T_SEARCH_HIT'
      }.freeze

      def self.type_id_name(tid)
        TYPE_ID_NAMES[tid] || format('T_UNKNOWN_0x%04X', tid)
      end

      # Auth mechanism strings.
      AUTH_MECH_NONE         = 'NONE'
      AUTH_MECH_PLAIN        = 'PLAIN'
      AUTH_MECH_SCRAM_SHA_256 = 'SCRAM-SHA-256'

      # SQLSTATE codes used by VBP v1.
      SQLSTATE_FEATURE_NOT_SUPPORTED = '0A000'
      SQLSTATE_SYNTAX_ERROR          = '42601'
      SQLSTATE_AUTH_FAILED           = '28000'
      SQLSTATE_PROTOCOL_VIOLATION    = '08P01'
      SQLSTATE_UNIQUE_VIOLATION      = '23505'
      SQLSTATE_CONNECTION_FAILURE    = '08006'
    end
  end
end
