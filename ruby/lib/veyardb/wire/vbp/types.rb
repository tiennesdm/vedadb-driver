# frozen_string_literal: true

# vbp/types.rb — VBP type codecs (VBP_SPEC.md §5).
#
# Each type ID has a fixed-width or length-prefixed wire representation.
# v1 set is 38 IDs (§5.10). Encoders return a binary String; decoders
# take a String and return a Ruby value.
#
# Input-parameter envelope (§5.1.a):
#   [u16 type_id][u8 null_tag][body]
# Output-column envelope (§5.1.b):
#   [u16 type_id][u8 null_bitmap_byte_count][null_bitmap][row_count × value bytes]

require_relative 'opcodes'

module VedaDB
  module Wire
    module VBP
      module Types
        class TypeError < StandardError; end

        module_function

        def write_u8(v)
          raise TypeError, "u8 OOR: #{v}" unless v.is_a?(Integer) && v >= 0 && v <= 0xFF
          [v].pack('C')
        end

        def write_u16le(v)
          raise TypeError, "u16 OOR: #{v}" unless v.is_a?(Integer) && v >= 0 && v <= 0xFFFF
          [v].pack('v')
        end

        def write_u32le(v)
          raise TypeError, "u32 OOR: #{v}" unless v.is_a?(Integer) && v >= 0 && v <= 0xFFFFFFFF
          [v].pack('V')
        end

        def write_i16le(v)
          raise TypeError, "i16 OOR: #{v}" unless v.is_a?(Integer) && v >= -0x8000 && v <= 0x7FFF
          [v].pack('s<')
        end

        def write_i32le(v)
          raise TypeError, "i32 OOR: #{v}" unless v.is_a?(Integer) && v >= -2**31 && v <= 2**31 - 1
          [v].pack('l<')
        end

        def write_i64le(v)
          [v].pack('q<')
        end

        def write_f32le(v)
          [v].pack('e')
        end

        def write_f64le(v)
          [v].pack('E')
        end

        def lp(data)
          data = data.b
          [data.bytesize].pack('V') + data
        end

        def encode_bool(v); write_u8(v ? 1 : 0); end
        def encode_int2(v); write_i16le(v); end
        def encode_int4(v); write_i32le(v); end
        def encode_int8(v); write_i64le(v); end
        def encode_float4(v); write_f32le(v); end
        def encode_float8(v); write_f64le(v); end
        def encode_text(v); lp(v.to_s.encode(Encoding::UTF_8)); end
        def encode_varchar(v); encode_text(v); end
        def encode_bpchar(v); encode_text(v); end
        def encode_name(v); encode_text(v); end
        def encode_oid(v); write_u32le(v); end
        def encode_bytea(v); lp(v.b); end
        def encode_uuid(v)
          s = v.to_s.delete('-')
          raise TypeError, "invalid uuid: #{v}" unless s.length == 32
          [s].pack('H*')
        end
        def encode_date(v)
          days =
            case v
            when Integer then v
            when Time then v.to_i / 86_400
            when String
              require 'time'
              Time.parse(v).to_i / 86_400
            else
              raise TypeError, "cannot encode date from #{v.class}"
            end
          write_i32le(days)
        end
        def encode_time(v)
          micros =
            case v
            when Integer then v
            when String
              m = v.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/)
              raise TypeError, "invalid time: #{v}" unless m
              h, mn, s, frac = m[1].to_i, m[2].to_i, m[3].to_i, m[4]
              frac_int = frac ? frac.to_i.ljust(6, '0')[0, 6].to_i : 0
              h * 3_600_000_000 + mn * 60_000_000 + s * 1_000_000 + frac_int
            else
              raise TypeError, "cannot encode time from #{v.class}"
            end
          write_i64le(micros)
        end
        def encode_timestamp(v)
          require 'time'
          micros =
            case v
            when Integer then v
            when String
              (Time.parse(v).to_i * 1_000_000)
            when Time
              v.to_i * 1_000_000
            else
              raise TypeError, "cannot encode timestamp from #{v.class}"
            end
          write_i64le(micros)
        end
        def encode_timestamptz(v); encode_timestamp(v); end
        def encode_interval(v)
          micros =
            case v
            when Integer then v
            when String then (Float(v) * 1_000_000).to_i
            else
              raise TypeError, "cannot encode interval from #{v.class}"
            end
          write_i64le(micros) + write_i32le(0) + write_i32le(0)
        end
        def encode_numeric(v); lp(v.to_s.b); end
        def encode_money(v); write_i64le((Float(v) * 100).round); end
        def encode_json(v); lp(v.to_json.encode(Encoding::UTF_8)); end
        def encode_jsonb(v); encode_json(v); end
        def encode_array(v)
          raise TypeError, 'array expected' unless v.is_a?(Array)
          [v.length].pack('V') + v.map { |e| write_i32le(Integer(e)) }.join
        end
        def encode_inet(v); lp(v.to_s.b); end
        def encode_macaddr(v); lp(v.to_s.b); end
        def encode_cidr(v); lp(v.to_s.b); end
        def encode_vector(v)
          dim, values =
            if v.is_a?(Hash)
              [v['dim'], v['values']]
            elsif v.is_a?(Array)
              [v.length, v]
            else
              raise TypeError, "cannot encode vector from #{v.class}"
            end
          [dim].pack('V') + values.each_with_index.map { |x, _i| write_f32le(Float(x)) }.join
        end
        def encode_tsvector(v); lp(v.to_s.encode(Encoding::UTF_8)); end
        def encode_document(v); lp(v.to_json.encode(Encoding::UTF_8)); end
        def encode_graph_node(v); lp(v.to_s.b); end
        def encode_graph_edge(v); lp(v.to_s.b); end
        def encode_ts_point(v)
          ts_us, val =
            if v.is_a?(Array)
              [Integer(v[0]), Float(v[1])]
            else
              raise TypeError, "cannot encode ts_point from #{v.class}"
            end
          write_i64le(ts_us) + write_f64le(val)
        end
        def encode_ts_series(v); lp(v.to_s.b); end
        def encode_geo_point(v)
          lat_e7, lon_e7 =
            if v.is_a?(Array)
              [(Float(v[0]) * 1e7).round, (Float(v[1]) * 1e7).round]
            else
              raise TypeError, "cannot encode geo_point from #{v.class}"
            end
          write_i32le(lat_e7) + write_i32le(lon_e7)
        end
        def encode_geo_path(v); lp(v.to_s.b); end
        def encode_geo_polygon(v); lp(v.to_s.b); end
        def encode_geo_multipoint(v); lp(v.to_s.b); end
        def encode_geo_multipolygon(v); lp(v.to_s.b); end
        def encode_search_doc(v); lp(v.to_s.b); end
        def encode_search_hit(v); lp(v.to_s.b); end

        ENCODERS = {
          T_BOOL => method(:encode_bool), T_INT2 => method(:encode_int2),
          T_INT4 => method(:encode_int4), T_INT8 => method(:encode_int8),
          T_FLOAT4 => method(:encode_float4), T_FLOAT8 => method(:encode_float8),
          T_TEXT => method(:encode_text), T_VARCHAR => method(:encode_varchar),
          T_BPCHAR => method(:encode_bpchar), T_NAME => method(:encode_name),
          T_OID => method(:encode_oid), T_BYTEA => method(:encode_bytea),
          T_UUID => method(:encode_uuid), T_DATE => method(:encode_date),
          T_TIME => method(:encode_time), T_TIMESTAMP => method(:encode_timestamp),
          T_TIMESTAMPTZ => method(:encode_timestamptz), T_INTERVAL => method(:encode_interval),
          T_NUMERIC => method(:encode_numeric), T_MONEY => method(:encode_money),
          T_JSON => method(:encode_json), T_JSONB => method(:encode_jsonb),
          T_ARRAY => method(:encode_array), T_INET => method(:encode_inet),
          T_MACADDR => method(:encode_macaddr), T_CIDR => method(:encode_cidr),
          T_VECTOR => method(:encode_vector), T_TSVECTOR => method(:encode_tsvector),
          T_DOCUMENT => method(:encode_document),
          T_GRAPH_NODE => method(:encode_graph_node), T_GRAPH_EDGE => method(:encode_graph_edge),
          T_TS_POINT => method(:encode_ts_point), T_TS_SERIES => method(:encode_ts_series),
          T_GEO_POINT => method(:encode_geo_point), T_GEO_PATH => method(:encode_geo_path),
          T_GEO_POLYGON => method(:encode_geo_polygon),
          T_GEO_MULTIPOINT => method(:encode_geo_multipoint),
          T_GEO_MULTIPOLYGON => method(:encode_geo_multipolygon),
          T_SEARCH_DOC => method(:encode_search_doc), T_SEARCH_HIT => method(:encode_search_hit)
        }.freeze

        def decode_bool(buf); buf.getbyte(0) != 0; end
        def decode_int2(buf); buf.unpack1('s<'); end
        def decode_int4(buf); buf.unpack1('l<'); end
        def decode_int8(buf); buf.unpack1('q<'); end
        def decode_float4(buf); buf.unpack1('e'); end
        def decode_float8(buf); buf.unpack1('E'); end
        def decode_text(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n).force_encoding(Encoding::UTF_8)
        end
        def decode_varchar(buf); decode_text(buf); end
        def decode_bpchar(buf); decode_text(buf); end
        def decode_name(buf); decode_text(buf); end
        def decode_oid(buf); buf.unpack1('V'); end
        def decode_bytea(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n).dup
        end
        def decode_uuid(buf)
          hex = buf.byteslice(0, 16).unpack1('H*')
          format('%s-%s-%s-%s-%s', hex[0, 8], hex[8, 4], hex[12, 4], hex[16, 4], hex[20, 12])
        end
        def decode_date(buf)
          days = buf.unpack1('l<')
          Time.at(days * 86_400).utc
        end
        def decode_time(buf); buf.unpack1('q<'); end
        def decode_timestamp(buf)
          micros = buf.unpack1('q<')
          Time.at(micros / 1_000_000).utc
        end
        def decode_timestamptz(buf); decode_timestamp(buf); end
        def decode_interval(buf); buf.unpack1('q<'); end
        def decode_numeric(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n).force_encoding(Encoding::US_ASCII)
        end
        def decode_money(buf); buf.unpack1('q<') / 100.0; end
        def decode_json(buf)
          n = buf.unpack1('V')
          JSON.parse(buf.byteslice(4, n))
        end
        def decode_jsonb(buf); decode_json(buf); end
        def decode_array(buf)
          n = buf.unpack1('V')
          Array.new(n) { |i| buf.byteslice(4 + i * 4, 4).unpack1('l<') }
        end
        def decode_inet(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n).force_encoding(Encoding::US_ASCII)
        end
        def decode_macaddr(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n).force_encoding(Encoding::US_ASCII)
        end
        def decode_cidr(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n).force_encoding(Encoding::US_ASCII)
        end
        def decode_vector(buf)
          dim = buf.unpack1('V')
          Array.new(dim) { |i| buf.byteslice(4 + i * 4, 4).unpack1('e') }
        end
        def decode_tsvector(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n).force_encoding(Encoding::UTF_8)
        end
        def decode_document(buf)
          n = buf.unpack1('V')
          JSON.parse(buf.byteslice(4, n))
        end
        def decode_graph_node(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n)
        end
        def decode_graph_edge(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n)
        end
        def decode_ts_point(buf)
          [buf.unpack1('q<'), buf.byteslice(8, 8).unpack1('E')]
        end
        def decode_ts_series(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n)
        end
        def decode_geo_point(buf)
          [buf.unpack1('l<'), buf.byteslice(4, 4).unpack1('l<')]
        end
        def decode_geo_path(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n)
        end
        def decode_geo_polygon(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n)
        end
        def decode_geo_multipoint(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n)
        end
        def decode_geo_multipolygon(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n)
        end
        def decode_search_doc(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n)
        end
        def decode_search_hit(buf)
          n = buf.unpack1('V')
          buf.byteslice(4, n)
        end

        DECODERS = {
          T_BOOL => method(:decode_bool), T_INT2 => method(:decode_int2),
          T_INT4 => method(:decode_int4), T_INT8 => method(:decode_int8),
          T_FLOAT4 => method(:decode_float4), T_FLOAT8 => method(:decode_float8),
          T_TEXT => method(:decode_text), T_VARCHAR => method(:decode_varchar),
          T_BPCHAR => method(:decode_bpchar), T_NAME => method(:decode_name),
          T_OID => method(:decode_oid), T_BYTEA => method(:decode_bytea),
          T_UUID => method(:decode_uuid), T_DATE => method(:decode_date),
          T_TIME => method(:decode_time), T_TIMESTAMP => method(:decode_timestamp),
          T_TIMESTAMPTZ => method(:decode_timestamptz), T_INTERVAL => method(:decode_interval),
          T_NUMERIC => method(:decode_numeric), T_MONEY => method(:decode_money),
          T_JSON => method(:decode_json), T_JSONB => method(:decode_jsonb),
          T_ARRAY => method(:decode_array), T_INET => method(:decode_inet),
          T_MACADDR => method(:decode_macaddr), T_CIDR => method(:decode_cidr),
          T_VECTOR => method(:decode_vector), T_TSVECTOR => method(:decode_tsvector),
          T_DOCUMENT => method(:decode_document),
          T_GRAPH_NODE => method(:decode_graph_node), T_GRAPH_EDGE => method(:decode_graph_edge),
          T_TS_POINT => method(:decode_ts_point), T_TS_SERIES => method(:decode_ts_series),
          T_GEO_POINT => method(:decode_geo_point), T_GEO_PATH => method(:decode_geo_path),
          T_GEO_POLYGON => method(:decode_geo_polygon),
          T_GEO_MULTIPOINT => method(:decode_geo_multipoint),
          T_GEO_MULTIPOLYGON => method(:decode_geo_multipolygon),
          T_SEARCH_DOC => method(:decode_search_doc), T_SEARCH_HIT => method(:decode_search_hit)
        }.freeze

        def encode_value(type_id, value)
          enc = ENCODERS[type_id]
          raise TypeError, "no encoder for type_id #{type_id}" unless enc
          enc.call(value)
        end

        def decode_value(type_id, raw)
          dec = DECODERS[type_id]
          raise TypeError, "no decoder for type_id #{type_id}" unless dec
          dec.call(raw)
        end

        def known_type?(type_id)
          ENCODERS.key?(type_id)
        end

        def encode_input_param(type_id, value)
          if value.nil?
            write_u16le(type_id) + write_u8(0)
          else
            body = encode_value(type_id, value)
            write_u16le(type_id) + write_u8(1) + body
          end
        end

        def decode_output_column(raw)
          bitmap_byte_count = raw.getbyte(0)
          bitmap = raw.byteslice(1, bitmap_byte_count)
          values_start = 1 + bitmap_byte_count
          { bitmap: bitmap, values: raw.byteslice(values_start, raw.bytesize - values_start) }
        end
      end
    end
  end
end
