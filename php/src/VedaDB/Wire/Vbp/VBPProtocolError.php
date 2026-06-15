<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

/**
 * VBP v1 protocol error codes (matches VBPProtocolError enum in Java POC).
 *
 * Used as a discriminator on VBPProtocolException so callers can branch on
 * the failure mode without parsing the message string.
 */
final class VBPProtocolError
{
    public const BadMagic       = 'BAD_MAGIC';
    public const Truncated      = 'TRUNCATED';
    public const Oversize       = 'OVERSIZE';
    public const BadRange       = 'BAD_RANGE';
    public const AllSeqsBusy    = 'ALL_SEQS_BUSY';
    public const Timeout        = 'TIMEOUT';
    public const ConnectionClosed = 'CONN_CLOSED';
    public const InvalidState   = 'INVALID_STATE';
    public const InvalidOp      = 'INVALID_OP';
}
