<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

/**
 * Base VBP protocol exception. Thrown by Frame/TypeCodec/Multiplexer for
 * wire-level errors. Carries a VBPProtocolError discriminator.
 */
class VBPProtocolException extends \RuntimeException
{
    public function __construct(
        string $protocolError,
        string $message = '',
        ?\Throwable $previous = null,
    ) {
        parent::__construct(
            $message !== '' ? "[$protocolError] $message" : "[$protocolError]",
            0,
            $previous,
        );
        $this->code = 0;
    }

    public function getProtocolError(): string
    {
        // Extract discriminator from "[BAD_MAGIC] bad magic at offset 0" -> "BAD_MAGIC"
        $msg = $this->getMessage();
        if (preg_match('/^\[([A-Z_]+)\]/', $msg, $m)) {
            return $m[1];
        }
        return '';
    }
}
