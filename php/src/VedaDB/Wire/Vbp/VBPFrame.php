<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

/**
 * VBP frame: 8-byte header (3B magic 'VDB' + 4B LE payload_length + 1B seq) + body.
 *
 * Wire layout (VBP_SPEC.md §2):
 *
 *     +--------+---------+-----+-----+-----+----------+...+
 *     | 'VDB'  | len_le4 | seq | op  | flg |  body    |
 *     +--------+---------+-----+-----+-----+----------+...+
 *     | 3 B    | 4 B     | 1 B | 1 B | 1 B | (len-2)B |
 *     +--------+---------+-----+-----+-----+----------+...+
 *
 * Magic is the literal ASCII bytes 0x56 0x44 0x42.
 * payload_length is op + flags + body size (little-endian u32).
 *
 * MAX_FRAME_LEN is 64 MiB (matches the Go reference).
 */
final class VBPFrame
{
    public const MAGIC = ['V', 'D', 'B']; // 0x56 0x44 0x42
    public const MAGIC_BYTES = "\x56\x44\x42";
    public const MAGIC_LEN = 3;
    public const LEN_LEN = 4;
    public const SEQ_LEN = 1;
    public const HDR_LEN = self::MAGIC_LEN + self::LEN_LEN + self::SEQ_LEN; // 8
    public const OP_LEN = 1;
    public const FLAGS_LEN = 1;
    public const OPFLAGS_LEN = self::OP_LEN + self::FLAGS_LEN; // 2
    public const MAX_FRAME_LEN = 64 * 1024 * 1024; // 64 MiB

    public function __construct(
        public readonly int $seq,
        public readonly int $op,
        public readonly int $flags,
        public readonly string $body,
    ) {
        self::checkRange('seq', $seq, 0, 0xFF);
        self::checkRange('op', $op, 0, 0xFF);
        self::checkRange('flags', $flags, 0, 0xFF);
        if (strlen($body) > self::MAX_FRAME_LEN - self::OPFLAGS_LEN) {
            throw new VBPProtocolException(
                VBPProtocolError::Oversize,
                'body too large: ' . strlen($body),
            );
        }
    }

    public function payloadLength(): int
    {
        return self::OPFLAGS_LEN + strlen($this->body);
    }

    public function totalLength(): int
    {
        return self::HDR_LEN + self::OPFLAGS_LEN + strlen($this->body);
    }

    /** Encode this frame to a fresh byte string. */
    public function encode(): string
    {
        $body = $this->body;
        $pl = $this->payloadLength();
        // Build: magic (3) + len_le4 (4) + seq (1) + op (1) + flags (1) + body
        return self::MAGIC_BYTES
            . pack('V', $pl)
            . chr($this->seq & 0xFF)
            . chr($this->op & 0xFF)
            . chr($this->flags & 0xFF)
            . $body;
    }

    /**
     * Decode a frame from $buf starting at $offset.
     *
     * @throws VBPProtocolException on bad magic, truncated, oversize, or out-of-range
     */
    public static function decode(string $buf, int $offset = 0): self
    {
        $len = strlen($buf) - $offset;
        if ($len < self::HDR_LEN) {
            throw new VBPProtocolException(
                VBPProtocolError::Truncated,
                'need at least ' . self::HDR_LEN . ' bytes, have ' . $len,
            );
        }
        if ($buf[$offset] !== 'V' || $buf[$offset + 1] !== 'D' || $buf[$offset + 2] !== 'B') {
            throw new VBPProtocolException(
                VBPProtocolError::BadMagic,
                'bad magic at offset ' . $offset,
            );
        }
        // Read 4-byte little-endian payload length.
        $unpacked = unpack('Vpl', substr($buf, $offset + self::MAGIC_LEN, self::LEN_LEN));
        if ($unpacked === false) {
            throw new VBPProtocolException(VBPProtocolError::Truncated, 'unpack failed');
        }
        $pl = $unpacked['pl'];
        $seq = ord($buf[$offset + self::MAGIC_LEN + self::LEN_LEN]) & 0xFF;
        if ($pl < self::OPFLAGS_LEN) {
            throw new VBPProtocolException(
                VBPProtocolError::Truncated,
                "payload_length $pl < " . self::OPFLAGS_LEN,
            );
        }
        if ($pl > self::MAX_FRAME_LEN) {
            throw new VBPProtocolException(
                VBPProtocolError::Oversize,
                "payload_length $pl > " . self::MAX_FRAME_LEN,
            );
        }
        $need = self::HDR_LEN + $pl;
        if (strlen($buf) - $offset < $need) {
            throw new VBPProtocolException(
                VBPProtocolError::Truncated,
                "buffer truncated: need $need, have " . (strlen($buf) - $offset),
            );
        }
        $op = ord($buf[$offset + self::HDR_LEN]) & 0xFF;
        $flags = ord($buf[$offset + self::HDR_LEN + 1]) & 0xFF;
        $bodyLen = $pl - self::OPFLAGS_LEN;
        $body = $bodyLen > 0
            ? substr($buf, $offset + self::HDR_LEN + self::OPFLAGS_LEN, $bodyLen)
            : '';
        return new self($seq, $op, $flags, $body);
    }

    private static function checkRange(string $name, int $v, int $lo, int $hi): void
    {
        if ($v < $lo || $v > $hi) {
            throw new \InvalidArgumentException("$name out of range: $v");
        }
    }

    public function __toString(): string
    {
        return sprintf(
            'Frame(seq=%d, op=0x%02x, flags=0x%02x, body_len=%d)',
            $this->seq,
            $this->op & 0xFF,
            $this->flags & 0xFF,
            strlen($this->body),
        );
    }
}
