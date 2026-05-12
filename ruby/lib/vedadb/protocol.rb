# frozen_string_literal: true

require "json"

module VedaDB
  # Wire-protocol encoder/decoder for VedaDB.
  #
  # Framing:   JSON object terminated by newline ("\n")
  # Request:   raw SQL string terminated by newline
  # Response:  JSON with keys "columns", "rows", "row_count", "message", "error"
  class Protocol
    FRAME_DELIMITER = "\n"
    FRAME_MAX_SIZE  = 64 * 1024 * 1024 # 64 MiB

    # Encode a SQL command into a wire frame.
    def self.encode(sql)
      sql.to_s + FRAME_DELIMITER
    end

    # Decode a wire frame into a Ruby Hash.
    #
    # @param frame [String] raw newline-terminated string
    # @return [Hash] parsed JSON
    # @raise [ConnectionError] if frame is nil (EOF)
    # @raise [QueryError] if server reports an error
    def self.decode(frame)
      raise ConnectionError, "Connection closed (EOF)" if frame.nil?

      frame = frame.strip
      raise ConnectionError, "Empty frame received" if frame.empty?

      if frame.bytesize > FRAME_MAX_SIZE
        raise ConnectionError, "Frame exceeds maximum size (#{FRAME_MAX_SIZE} bytes)"
      end

      begin
        JSON.parse(frame)
      rescue JSON::ParserError => e
        raise ConnectionError, "Invalid JSON from server: #{e.message}"
      end
    end

    # Build a Result from a decoded Hash.
    def self.to_result(data)
      if data.key?("error")
        raise QueryError, data["error"]
      end

      Result.new(
        columns: data["columns"],
        rows: data["rows"],
        row_count: data["row_count"] || 0,
        message: data["message"]
      )
    end

    # Read one complete frame from the socket.
    def self.read_frame(socket)
      socket.gets(FRAME_DELIMITER)
    end

    # Read multiple frames (for multi-result / pipeline).
    def self.read_frames(socket, count)
      frames = []
      count.times do
        frame = read_frame(socket)
        break if frame.nil?

        frames << decode(frame)
      end
      frames
    end

    # Encode a command frame for the control channel.
    def self.encode_command(cmd, *args)
      parts = [cmd.to_s.upcase, *args.map { |a| format_arg(a) }]
      parts.join(" ") + FRAME_DELIMITER
    end

    # Format a protocol argument (quote strings, pass numbers).
    def self.format_arg(arg)
      case arg
      when String then "'#{arg.gsub("'", "''")}'"
      when NilClass then "NULL"
      when TrueClass then "TRUE"
      when FalseClass then "FALSE"
      else arg.to_s
      end
    end

    # Heartbeat ping frame.
    def self.ping_frame
      encode("PING")
    end

    # Quit / graceful disconnect frame.
    def self.quit_frame
      encode("QUIT")
    end

    # Parse server welcome banner.
    def self.parse_welcome(frame)
      return {} if frame.nil?

      frame = frame.strip
      return {} if frame.empty?

      begin
        JSON.parse(frame)
      rescue JSON::ParserError
        { "banner" => frame }
      end
    end

    # Serialize bind parameters for prepared statements.
    #
    # @param params [Array] positional parameters
    # @return [String] comma-separated, properly quoted values
    def self.bind_params(params)
      params.map { |p| format_value(p) }.join(", ")
    end

    # Format a single value for SQL interpolation.
    def self.format_value(value)
      case value
      when nil then "NULL"
      when String
        raise QueryError, "NUL byte in string parameter" if value.include?("\0")

        "'#{value.gsub("'", "''")}'"
      when true then "TRUE"
      when false then "FALSE"
      when Time then "'#{value.strftime("%Y-%m-%d %H:%M:%S")}'"
      when Date then "'#{value.strftime("%Y-%m-%d")}'"
      when DateTime then "'#{value.strftime("%Y-%m-%d %H:%M:%S")}'"
      when Array then "ARRAY[#{value.map { |v| format_value(v) }.join(", ")}]"
      when Hash then "'#{JSON.generate(value)}'"
      else value.to_s
      end
    end
  end
end
