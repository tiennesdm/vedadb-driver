<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

use VedaDB\Wire\Vbp\VBPOpcodes as Ops;

/**
 * VBP type codecs — encode/decode PHP values to/from wire body bytes.
 *
 * Two envelope shapes (VBP_SPEC.md §5.1):
 *
 *   - Input envelope (per-value): u8 null_tag, [u16 type_id, [u32 len, body]] for non-null.
 *   - Output envelope (column-wide): u32 n_columns, u32 null_bitmap_bytes, [u16 col_type_id]*,
 *     null_bitmap bytes, then per-row bodies (NULLs are zero-filled for fixed-width types,
 *     length-prefixed bytes for variable-width).
 *
 * All multi-byte integers are little-endian.
 */
final class VBPTypeCodec
{
    public const NULL_TAG_NULL = 1;
    public const NULL_TAG_NOT_NULL = 0;

    // ============================================================
    // Fixed-width encoders
    // ============================================================

    public static function encodeBool(bool $v): string
    {
        return chr($v ? 1 : 0);
    }

    public static function encodeInt2(int $v): string
    {
        return pack('v', $v & 0xFFFF);
    }

    public static function encodeInt4(int $v): string
    {
        return pack('V', $v);
    }

    public static function encodeInt8(int $v): string
    {
        return pack('P', $v);
    }

    public static function encodeFloat4(float $v): string
    {
        return pack('g', $v);
    }

    public static function encodeFloat8(float $v): string
    {
        return pack('e', $v);
    }

    public static function encodeBytea(string $v): string
    {
        return self::lengthPrefixed($v);
    }

    public static function encodeText(string $v): string
    {
        return self::lengthPrefixed($v);
    }

    public static function encodeVarchar(string $v): string
    {
        return self::lengthPrefixed($v);
    }

    public static function encodeUuid(string $v): string
    {
        // Accept any 36-char canonical UUID or 32-char hex; normalize to 16 raw bytes BE.
        $clean = str_replace('-', '', $v);
        if (strlen($clean) !== 32) {
            throw new \InvalidArgumentException("invalid UUID: $v");
        }
        return hex2bin($clean) ?: '';
    }

    public static function encodeDate(int $daysSince1970): string
    {
        return pack('V', $daysSince1970);
    }

    public static function encodeTime(int $micros): string
    {
        return pack('P', $micros);
    }

    public static function encodeTimestamp(int $micros): string
    {
        return pack('P', $micros);
    }

    public static function encodeTimestamptz(int $micros): string
    {
        return self::encodeTimestamp($micros);
    }

    public static function encodeInterval(int $micros, int $days, int $months): string
    {
        return pack('Pii', $micros, $days, $months);
    }

    public static function encodeNumeric(string $s): string
    {
        return self::lengthPrefixed($s);
    }

    public static function encodeMoney(int $cents): string
    {
        return pack('P', $cents);
    }

    public static function encodeJson(string $s): string
    {
        return self::lengthPrefixed($s);
    }

    public static function encodeJsonb(string $s): string
    {
        return self::lengthPrefixed($s);
    }

    public static function lengthPrefixed(string $body): string
    {
        return pack('V', strlen($body)) . $body;
    }

    // ============================================================
    // Decoders
    // ============================================================

    public static function decodeBool(string $body): bool
    {
        if (strlen($body) < 1) {
            throw new \InvalidArgumentException('BOOL body too short');
        }
        return ord($body[0]) !== 0;
    }

    public static function decodeInt4(string $body): int
    {
        $u = unpack('Vv', $body);
        return $u['v'] ?? 0;
    }

    public static function decodeInt8(string $body): int
    {
        // PHP 'P' reads little-endian u64. For 64-bit PHP this returns
        // an int (or a float if the high bit is set, due to the signed
        // 63-bit range). For 32-bit PHP it always returns a float.
        $u = unpack('Pv', $body);
        $raw = $u['v'] ?? 0;
        // Convert float to int losslessly via string (only triggers when
        // the raw value is large enough to overflow int).
        if (is_float($raw)) {
            $raw = (int) sprintf('%.0f', $raw);
        } else {
            $raw = (int) $raw;
        }
        // Sign-extend: if the high bit is set, the value represents a
        // negative signed 64-bit number. Subtracting 2^64 yields the
        // correct PHP int (which is signed 64-bit on 64-bit PHP).
        if (($raw & PHP_INT_MIN) !== 0) {
            $raw = (int) ($raw - (float) 0xFFFFFFFFFFFFFFFF - 1);
        }
        return $raw;
    }

    public static function decodeInt2(string $body): int
    {
        $u = unpack('vv', $body);
        $v = $u['v'] ?? 0;
        if ($v & 0x8000) {
            $v -= 0x10000;
        }
        return (int) $v;
    }

    public static function decodeFloat4(string $body): float
    {
        $u = unpack('gv', $body);
        return $u['v'] ?? 0.0;
    }

    public static function decodeFloat8(string $body): float
    {
        $u = unpack('ev', $body);
        return $u['v'] ?? 0.0;
    }

    public static function decodeText(string $body): string
    {
        if (strlen($body) < 4) {
            return '';
        }
        $u = unpack('Vlen', substr($body, 0, 4));
        $len = $u['len'] ?? 0;
        if ($len === 0) {
            return '';
        }
        return substr($body, 4, min($len, strlen($body) - 4));
    }

    public static function decodeBytea(string $body): string
    {
        if (strlen($body) < 4) {
            return '';
        }
        $u = unpack('Vlen', substr($body, 0, 4));
        $len = $u['len'] ?? 0;
        if ($len === 0) {
            return '';
        }
        return substr($body, 4, min($len, strlen($body) - 4));
    }

    public static function decodeUuid(string $body): string
    {
        if (strlen($body) < 16) {
            throw new \InvalidArgumentException('UUID body too short');
        }
        // 16 raw bytes BE; format as canonical 36-char UUID.
        $hex = bin2hex($body);
        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12),
        );
    }

    public static function decodeTimestamp(string $body): int
    {
        return self::decodeInt8($body);
    }

    // ============================================================
    // Input envelope (per-value, used by QUERY/BIND/EXT_QUERY)
    // ============================================================

    /** Build input-envelope bytes for a typed value. */
    public static function inputEnvelope(int $typeId, ?string $body): string
    {
        if ($body === null) {
            // null envelope: u8 NULL_TAG_NULL + u16 typeId
            return chr(self::NULL_TAG_NULL) . pack('v', $typeId & 0xFFFF);
        }
        // non-null envelope: u8 NULL_TAG_NOT_NULL + u16 typeId + u32 len + body
        return chr(self::NULL_TAG_NOT_NULL)
            . pack('v', $typeId & 0xFFFF)
            . pack('V', strlen($body))
            . $body;
    }

    public static function inputEnvelopeNull(int $typeId): string
    {
        return self::inputEnvelope($typeId, null);
    }

    // ============================================================
    // Output envelope (column-wide, used by DATA_CHUNK)
    // ============================================================

    /**
     * Build an output-envelope DATA_CHUNK body for a single row of N columns.
     *
     * @param int[]   $colTypes   type IDs in column order
     * @param ?string[] $bodies   column bodies in column order (null = NULL column)
     * @param int     $nullBitmap null bitmap (1 = null). 0 if all non-null.
     */
    public static function outputEnvelopeRow(array $colTypes, array $bodies, int $nullBitmap = 0): string
    {
        $n = count($colTypes);
        $nullBmpBytes = (int) (($n + 7) / 8);
        $colTypeBytes = 2 * $n;
        $bodyTotal = 0;
        foreach ($bodies as $b) {
            $bodyTotal += ($b === null ? 0 : strlen($b));
        }
        $buf = pack('V', $n)
            . pack('V', $nullBmpBytes);
        foreach ($colTypes as $t) {
            $buf .= pack('v', $t & 0xFFFF);
        }
        // null bitmap (1 byte if n<=8, else n/8)
        $bmp = str_repeat(chr(0), $nullBmpBytes);
        $bmp[0] = chr($nullBitmap & 0xFF);
        $buf .= $bmp;
        foreach ($bodies as $b) {
            if ($b !== null && strlen($b) > 0) {
                $buf .= $b;
            }
        }
        return $buf;
    }

    /** Build a SELECT 1 response body. */
    public static function selectOneRow(): string
    {
        return self::outputEnvelopeRow(
            [Ops::T_INT4],
            [self::encodeInt4(1)],
            0,
        );
    }

    // ============================================================
    // ROWS_FINISHED / COMMAND_COMPLETE bodies
    // ============================================================

    /** Build a ROWS_FINISHED body: u32 n_rows, u32 n_columns, [u16 col_type_id]*. */
    public static function rowsFinished(int $nRows, int $nColumns, array $colTypes): string
    {
        $buf = pack('VV', $nRows, $nColumns);
        foreach ($colTypes as $t) {
            $buf .= pack('v', $t & 0xFFFF);
        }
        return $buf;
    }

    /** Build a COMMAND_COMPLETE body: u32 tag_len, ascii tag, u64 rowsAffected. */
    public static function commandComplete(string $tag, int $rowsAffected = 0): string
    {
        return pack('V', strlen($tag)) . $tag . pack('P', $rowsAffected);
    }

    // ============================================================
    // ERROR body
    // ============================================================

    /**
     * Build an ERROR body:
     *   5B sqlstate (US-ASCII) | u32 msg_len | msg | u32 detail_len | detail
     *   | u32 hint_len | hint | u32 position (0)
     */
    public static function errorBody(
        string $sqlstate,
        string $message,
        string $detail = '',
        string $hint = '',
    ): string {
        $ss = $sqlstate;
        if (strlen($ss) < 5) {
            $ss = str_pad($ss, 5, '0');
        } elseif (strlen($ss) > 5) {
            $ss = substr($ss, 0, 5);
        }
        return $ss
            . pack('V', strlen($message)) . $message
            . pack('V', strlen($detail)) . $detail
            . pack('V', strlen($hint)) . $hint
            . pack('V', 0);
    }

    /** Parsed ERROR body parts. */
    public static function parseErrorBody(string $body): array
    {
        if (strlen($body) < 5) {
            return ['sqlstate' => '0A000', 'message' => 'truncated error body', 'detail' => '', 'hint' => ''];
        }
        $ss = substr($body, 0, 5);
        $off = 5;
        if (strlen($body) < $off + 4) {
            return ['sqlstate' => $ss, 'message' => '', 'detail' => '', 'hint' => ''];
        }
        $u = unpack('Vlen', substr($body, $off, 4));
        $mLen = $u['len'] ?? 0;
        $off += 4;
        $m = substr($body, $off, $mLen);
        $off += $mLen;
        if (strlen($body) < $off + 4) {
            return ['sqlstate' => $ss, 'message' => $m, 'detail' => '', 'hint' => ''];
        }
        $u = unpack('Vlen', substr($body, $off, 4));
        $dLen = $u['len'] ?? 0;
        $off += 4;
        $d = substr($body, $off, $dLen);
        $off += $dLen;
        if (strlen($body) < $off + 4) {
            return ['sqlstate' => $ss, 'message' => $m, 'detail' => $d, 'hint' => ''];
        }
        $u = unpack('Vlen', substr($body, $off, 4));
        $hLen = $u['len'] ?? 0;
        $off += 4;
        $h = substr($body, $off, $hLen);
        return ['sqlstate' => $ss, 'message' => $m, 'detail' => $d, 'hint' => $h];
    }

    // ============================================================
    // CLIENT_HELLO body
    // ============================================================

    /**
     * CLIENT_HELLO body:
     *   u16 protocolVersion | u16 clientFlags | u32 user_len | user
     *   | u32 db_len | db | u8 actorKind | u32 actorId_len | actorId
     */
    public static function clientHelloBody(
        int $protocolVersion,
        int $clientFlags,
        string $username,
        string $database,
        int $actorKind = 0,
        string $actorId = '',
    ): string {
        return pack('vv', $protocolVersion & 0xFFFF, $clientFlags & 0xFFFF)
            . pack('V', strlen($username)) . $username
            . pack('V', strlen($database)) . $database
            . chr($actorKind & 0xFF)
            . pack('V', strlen($actorId)) . $actorId;
    }

    // ============================================================
    // SERVER_READY body parser
    // ============================================================

    public static function parseServerReady(string $body): array
    {
        $u = unpack('VserverVersion/VserverCaps', substr($body, 0, 8));
        $authReq = ord($body[8]) !== 0;
        $u2 = unpack('VnLen', substr($body, 9, 4));
        $nLen = $u2['nLen'] ?? 0;
        $nonce = $nLen > 0 ? substr($body, 13, $nLen) : '';
        return [
            'serverVersion' => $u['serverVersion'] ?? 0,
            'serverCaps' => $u['serverCaps'] ?? 0,
            'authRequired' => $authReq,
            'nonce' => $nonce,
        ];
    }

    // ============================================================
    // AUTH_OK body parser
    // ============================================================

    public static function parseAuthOk(string $body): array
    {
        // u64 sessionTokenLo + u64 sessionTokenHi + u32 serverFlags
        $u = unpack('Plo/Phi/Vflags', $body);
        return [
            'sessionTokenLo' => $u['lo'] ?? 0,
            'sessionTokenHi' => $u['hi'] ?? 0,
            'serverFlags' => $u['flags'] ?? 0,
        ];
    }

    // ============================================================
    // QUERY body
    // ============================================================

    /**
     * Build a QUERY body: u32 queryId | u32 sql_len | sql | u32 n_params | [envelopes]
     *
     * @param ?string[] $paramEnvelopes pre-built input envelopes (or null/empty for none)
     */
    public static function queryBody(int $queryId, string $sql, ?array $paramEnvelopes = null): string
    {
        $buf = pack('V', $queryId)
            . pack('V', strlen($sql)) . $sql
            . pack('V', $paramEnvelopes === null ? 0 : count($paramEnvelopes));
        if ($paramEnvelopes !== null) {
            foreach ($paramEnvelopes as $env) {
                $buf .= $env;
            }
        }
        return $buf;
    }

    public static function parseQuery(string $body): array
    {
        if (strlen($body) < 8) {
            return ['queryId' => 0, 'sql' => '', 'nParams' => 0];
        }
        $u = unpack('VqueryId/VtLen', substr($body, 0, 8));
        $sql = substr($body, 8, $u['tLen'] ?? 0);
        $off = 8 + ($u['tLen'] ?? 0);
        $nParams = 0;
        if (strlen($body) >= $off + 4) {
            $u2 = unpack('VnParams', substr($body, $off, 4));
            $nParams = $u2['nParams'] ?? 0;
        }
        return ['queryId' => $u['queryId'] ?? 0, 'sql' => $sql, 'nParams' => $nParams];
    }

    // ============================================================
    // DATA_CHUNK body parser (single-row v1)
    // ============================================================

    /**
     * Parse a single-row DATA_CHUNK. Returns:
     *   ['nColumns' => int, 'colTypes' => int[], 'nullBitmap' => int,
     *    'values' => array<int,mixed>]   // null = SQL NULL
     */
    public static function parseDataChunk(string $body): array
    {
        if (strlen($body) < 8) {
            return ['nColumns' => 0, 'colTypes' => [], 'nullBitmap' => 0, 'values' => []];
        }
        $u = unpack('VnCols/VbmpBytes', substr($body, 0, 8));
        $nCols = $u['nCols'] ?? 0;
        $bmpBytes = $u['bmpBytes'] ?? 0;
        $off = 8;
        $types = [];
        for ($i = 0; $i < $nCols; $i++) {
            $u2 = unpack('vt', substr($body, $off, 2));
            $types[] = $u2['t'] ?? 0;
            $off += 2;
        }
        $bmp = $bmpBytes > 0 ? ord($body[$off]) : 0;
        $off += $bmpBytes;
        $vals = [];
        for ($i = 0; $i < $nCols; $i++) {
            $isNull = (($bmp >> $i) & 1) === 1;
            if ($isNull) {
                $vals[] = null;
                continue;
            }
            $t = $types[$i];
            switch ($t) {
                case Ops::T_BOOL:
                    $vals[] = ord($body[$off]) !== 0;
                    $off += 1;
                    break;
                case Ops::T_INT2:
                    $u2 = unpack('vv', substr($body, $off, 2));
                    $vals[] = ($u2['v'] & 0x8000) ? ($u2['v'] - 0x10000) : $u2['v'];
                    $off += 2;
                    break;
                case Ops::T_INT4:
                    $u2 = unpack('Vv', substr($body, $off, 4));
                    $vals[] = $u2['v'];
                    $off += 4;
                    break;
                case Ops::T_INT8:
                    $u2 = unpack('Pv', substr($body, $off, 8));
                    $v = $u2['v'] ?? 0;
                    if ($v & 0x8000000000000000) {
                        $v -= 0x10000000000000000;
                    }
                    $vals[] = (int) $v;
                    $off += 8;
                    break;
                case Ops::T_FLOAT4:
                    $u2 = unpack('gv', substr($body, $off, 4));
                    $vals[] = $u2['v'];
                    $off += 4;
                    break;
                case Ops::T_FLOAT8:
                    $u2 = unpack('ev', substr($body, $off, 8));
                    $vals[] = $u2['v'];
                    $off += 8;
                    break;
                case Ops::T_TEXT:
                case Ops::T_VARCHAR:
                case Ops::T_JSON:
                case Ops::T_JSONB:
                case Ops::T_BYTEA:
                    $u2 = unpack('Vlen', substr($body, $off, 4));
                    $len = $u2['len'] ?? 0;
                    $off += 4;
                    $vals[] = substr($body, $off, $len);
                    $off += $len;
                    break;
                default:
                    $vals[] = null;
                    break;
            }
        }
        return [
            'nColumns' => $nCols,
            'colTypes' => $types,
            'nullBitmap' => $bmp,
            'values' => $vals,
        ];
    }

    // ============================================================
    // PING body (8-byte u64 nonce) and PONG verifier
    // ============================================================

    public static function pingBody(string $nonce8): string
    {
        if (strlen($nonce8) !== 8) {
            throw new \InvalidArgumentException('PING nonce must be 8 bytes');
        }
        return $nonce8;
    }
}
