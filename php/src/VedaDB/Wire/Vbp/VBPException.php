<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

/**
 * High-level VBP exception (decoded from an ERROR frame body).
 *
 * Mirrors the Java VBPException. Carries a SQLSTATE so callers can branch
 * on the cause without parsing the message.
 */
class VBPException extends \RuntimeException
{
    public function __construct(
        public readonly string $sqlstate = '0A000',
        string $message = '',
        public readonly string $detail = '',
        public readonly string $hint = '',
        ?\Throwable $previous = null,
    ) {
        parent::__construct(
            $message !== '' ? "[$sqlstate] $message" : "[$sqlstate]",
            0,
            $previous,
        );
    }
}
