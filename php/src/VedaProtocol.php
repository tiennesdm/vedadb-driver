<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Handles the VedaDB wire protocol: framing, serialization, checksums.
 */
class VedaProtocol
{
    private const PROTOCOL_VERSION = 1;
    private const FRAME_DELIMITER  = "\n";
    private const MAX_FRAME_SIZE   = 16 * 1024 * 1024; // 16 MiB

    /**
     * Encode a command into a wire frame.
     *
     * Format: <JSON>\n
     *
     * @param array<string, mixed> $payload
     */
    public static function encode(array $payload): string
    {
        $payload['v'] = self::PROTOCOL_VERSION;
        $json = json_encode($payload, JSON_THROW_ON_ERROR);
        if (strlen($json) > self::MAX_FRAME_SIZE) {
            throw new ProtocolException('Frame exceeds maximum size');
        }
        return $json . self::FRAME_DELIMITER;
    }

    /**
     * Decode a wire frame into a payload array.
     *
     * @return array<string, mixed>
     */
    public static function decode(string $frame): array
    {
        $frame = trim($frame);
        if ($frame === '') {
            throw new ProtocolException('Empty frame received');
        }

        try {
            $data = json_decode($frame, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new ProtocolException('Invalid JSON in frame: ' . $e->getMessage());
        }

        if (!is_array($data)) {
            throw new ProtocolException('Decoded frame is not an array');
        }

        return $data;
    }

    /**
     * Encode a simple text command (SQL query string).
     */
    public static function encodeCommand(string $command): string
    {
        if (str_contains($command, "\0")) {
            throw new ProtocolException('Command contains NUL byte');
        }
        return $command . self::FRAME_DELIMITER;
    }

    /**
     * Read a complete frame from the stream.
     *
     * @param resource $stream
     */
    public static function readFrame($stream, int $timeout): array
    {
        $line = @fgets($stream);
        if ($line === false) {
            $meta = stream_get_meta_data($stream);
            if ($meta['timed_out'] ?? false) {
                throw new TimeoutException('Read timed out');
            }
            throw new ConnectionException('Connection closed while reading frame');
        }

        if (strlen($line) > self::MAX_FRAME_SIZE) {
            throw new ProtocolException('Frame size exceeds limit');
        }

        return self::decode($line);
    }

    /**
     * Send a command and read the response frame.
     *
     * @param resource $stream
     * @return array<string, mixed>
     */
    public static function request($stream, string $command, int $timeout): array
    {
        $encoded = self::encodeCommand($command);
        $written = @fwrite($stream, $encoded);
        if ($written === false) {
            throw new ConnectionException('Failed to write to stream');
        }

        return self::readFrame($stream, $timeout);
    }

    /**
     * Send a structured request and read the response.
     *
     * @param resource $stream
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public static function structuredRequest($stream, array $payload, int $timeout): array
    {
        $encoded = self::encode($payload);
        $written = @fwrite($stream, $encoded);
        if ($written === false) {
            throw new ConnectionException('Failed to write structured request');
        }

        return self::readFrame($stream, $timeout);
    }

    /**
     * Validate the response frame and extract result data.
     *
     * @param array<string, mixed> $frame
     * @return array<string, mixed>
     */
    public static function validateResponse(array $frame): array
    {
        if (isset($frame['error'])) {
            throw new QueryException(
                (string) ($frame['error']),
                isset($frame['code']) ? (int) $frame['code'] : null,
                isset($frame['sqlstate']) ? (string) $frame['sqlstate'] : null,
            );
        }

        return $frame;
    }

    /**
     * Build a result from a validated response frame.
     *
     * @param array<string, mixed> $frame
     */
    public static function buildResult(array $frame): VedaResult
    {
        return new VedaResult(
            $frame['columns'] ?? null,
            $frame['rows'] ?? null,
            (int) ($frame['row_count'] ?? 0),
            $frame['message'] ?? null,
            $frame['metadata'] ?? null,
        );
    }
}
