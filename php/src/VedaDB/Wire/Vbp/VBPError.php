<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

/**
 * High-level VBP error alias — same shape as VBPException. Kept for
 * parity with the Java POC (which has both VBPException and VBPError as
 * the same class shape).
 */
class VBPError extends VBPException
{
}
