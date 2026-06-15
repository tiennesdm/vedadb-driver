<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

use VedaDB\Wire\Vbp\VBPOpcodes as Ops;

/**
 * Thread-safe VBP request multiplexer over a single TCP connection.
 *
 * Wire constraints (VBP_SPEC.md §2):
 *   * Sequence id is 1 byte, wraps at 256.
 *   * Responses arrive on the same connection, addressed by their seq.
 *   * The driver MUST NOT issue a new request with a given seq while a
 *     previous request with that seq is still in flight.
 *
 * **CRITICAL — multiplexer streaming fix (the team-engine's v2 finding)**:
 *
 *   The original POCs (Python, Java, Node, Rust, .NET, Ruby) all have a
 *   bug where DATA_CHUNK frames for the same seq are silently dropped
 *   because they treat every reply as if it were the terminal reply.
 *   The fix:
 *
 *     - TERMINAL opcodes (ROWS_FINISHED=0x0B, COMMAND_COMPLETE=0x0C,
 *       ERROR=0x0D) REMOVE the inflight slot and deliver the
 *       accumulated frames to the caller.
 *     - NON-TERMINAL opcodes (DATA_CHUNK=0x0A, STREAM_CHUNK=0x19)
 *       ACCUMULATE into the inflight slot's frames buffer and DO NOT
 *       remove the slot.
 *
 *   Concretely: a typical QUERY response is
 *
 *     [DATA_CHUNK, DATA_CHUNK, ..., ROWS_FINISHED, COMMAND_COMPLETE]
 *
 *   The buggy POC would deliver the FIRST DATA_CHUNK as if it were
 *   the whole reply, leak the rest of the inflight slot, and corrupt
 *   subsequent calls. PHP ships the fix from day 1.
 *
 * Implementation: this is a SINGLE-THREADED synchronous multiplexer
 * using ext-sockets and non-blocking I/O via stream_select. We never
 * block on a read for a single call: we send the request, then loop
 * on stream_select with a deadline, decoding frames and routing
 * them by seq id until the terminal frame arrives.
 *
 * PHP-FPM request workers are short-lived, so a per-process mux is
 * the right model: each PHP request opens a fresh mux via VBPConnection
 * and the lifecycle is bound to the request. Reuse across requests
 * needs a long-running daemon (RoadRunner, FrankenPHP, Swoole) — out
 * of scope for v1.
 */
final class VBPMultiplexer
{
    /** @var resource|null */
    private $socket = null;

    private bool $closing = false;
    private ?string $closeError = null;

    private int $timeoutMs;
    private int $nextSeq = 0;

    /** Stream-buffered partial frame data. */
    private string $readBuf = '';

    /**
     * Inflight slot per seq:
     *   ['frames' => array, 'error' => ?array, 'terminal' => bool]
     *   - frames: every received frame in order
     *   - error:  parsed ERROR body, if any
     *   - terminal: true once ROWS_FINISHED / COMMAND_COMPLETE / ERROR seen
     *
     * @var array<int,array{frames:array,error:?array,terminal:bool}>
     */
    private array $inflight = [];

    public function __construct(string $host, int $port, int $timeoutMs = 30_000)
    {
        if (!extension_loaded('sockets')) {
            throw new \RuntimeException(
                'ext-sockets is required for VBP multiplexer. Install via docker-php-ext-install sockets.',
            );
        }
        $this->timeoutMs = $timeoutMs;

        $errno = 0;
        $errstr = '';
        $sock = @stream_socket_client(
            "tcp://$host:$port",
            $errno,
            $errstr,
            $timeoutMs / 1000.0,
        );
        if ($sock === false) {
            throw new VBPException(
                Ops::SQLSTATE_CONNECTION_FAILURE,
                "connect failed: [$errno] $errstr",
            );
        }
        stream_set_blocking($sock, false);
        stream_set_timeout($sock, (int) max(1, (int) ($timeoutMs / 1000)));
        $this->socket = $sock;
    }

    /**
     * Send a request and synchronously wait for the reply.
     *
     * For non-streaming opcodes, returns the terminal reply.
     *
     * @return array{op:int,flags:int,body:string,frames:array}
     */
    public function call(int $op, string $body, int $flags = 0): array
    {
        if ($this->closing) {
            throw new VBPProtocolException(
                VBPProtocolError::ConnectionClosed,
                $this->closeError ?? 'multiplexer closed',
            );
        }
        $seq = $this->allocateSeq();
        $frame = new VBPFrame($seq, $op, $flags, $body);
        $encoded = $frame->encode();

        // Write the encoded frame. Use stream_select to wait for writability.
        $this->writeAll($encoded);

        $deadline = microtime(true) + $this->timeoutMs / 1000.0;
        $frames = [];
        while (true) {
            // Read whatever is currently available.
            $this->drain();
            if (isset($this->inflight[$seq]) && $this->inflight[$seq]['terminal']) {
                $slot = $this->inflight[$seq];
                unset($this->inflight[$seq]);
                if ($slot['error'] !== null) {
                    throw new VBPError(
                        $slot['error']['sqlstate'],
                        $slot['error']['message'],
                        $slot['error']['detail'],
                        $slot['error']['hint'],
                    );
                }
                $last = end($slot['frames']) ?: ['op' => 0, 'flags' => 0, 'body' => ''];
                return [
                    'op' => $last['op'],
                    'flags' => $last['flags'],
                    'body' => $last['body'],
                    'frames' => $slot['frames'],
                ];
            }
            $remaining = $deadline - microtime(true);
            if ($remaining <= 0) {
                unset($this->inflight[$seq]);
                throw new VBPProtocolException(
                    VBPProtocolError::Timeout,
                    "timeout waiting for seq=$seq",
                );
            }
            // Wait for more data.
            $this->waitReadable((int) ($remaining * 1_000_000));
        }
    }

    /**
     * Push a frame into the read buffer (for tests with fake TCP).
     *
     * The bytes are queued in readBuf but NOT dispatched yet — frames
     * for unknown seqs are dropped by the dispatch logic, and the
     * seq slot is created on demand inside call()→allocateSeq(). So
     * callers should typically use injectRaw() with a pre-encoded
     * frame AFTER ensure the seq is already allocated, or just
     * use injectRaw() to feed all frames in one shot before call().
     */
    public function injectFrame(int $seq, int $op, int $flags, string $body): void
    {
        $frame = new VBPFrame($seq, $op, $flags, $body);
        $this->readBuf .= $frame->encode();
    }

    /**
     * Inject raw bytes (for tests with a fake TCP that emits pre-encoded data).
     * The bytes are queued; drain() is called on the next call().
     */
    public function injectRaw(string $bytes): void
    {
        $this->readBuf .= $bytes;
    }

    public function close(): void
    {
        if ($this->closing) {
            return;
        }
        $this->closing = true;
        if ($this->socket !== null) {
            @fclose($this->socket);
            $this->socket = null;
        }
    }

    public function __destruct()
    {
        try {
            $this->close();
        } catch (\Throwable) {
            // ignore
        }
    }

    // =================================================================
    // Internals
    // =================================================================

    private function allocateSeq(): int
    {
        // Find a free seq id. Try 256 times before failing.
        for ($tries = 0; $tries < 256; $tries++) {
            $seq = $this->nextSeq;
            $this->nextSeq = ($this->nextSeq + 1) & 0xFF;
            if (!isset($this->inflight[$seq])) {
                $this->inflight[$seq] = [
                    'frames' => [],
                    'error' => null,
                    'terminal' => false,
                ];
                return $seq;
            }
        }
        throw new VBPProtocolException(
            VBPProtocolError::AllSeqsBusy,
            'all 256 sequence ids in flight',
        );
    }

    private function writeAll(string $data): void
    {
        $written = 0;
        $len = strlen($data);
        $deadline = microtime(true) + $this->timeoutMs / 1000.0;
        while ($written < $len) {
            $n = @fwrite($this->socket, substr($data, $written));
            if ($n === false || $n === 0) {
                $info = is_resource($this->socket) ? stream_get_meta_data($this->socket) : ['timed_out' => false];
                if (!empty($info['timed_out'])) {
                    throw new VBPProtocolException(VBPProtocolError::Timeout, 'socket write timeout');
                }
                throw new VBPProtocolException(VBPProtocolError::ConnectionClosed, 'write returned 0');
            }
            $written += $n;
            if ($written < $len) {
                $remaining = $deadline - microtime(true);
                if ($remaining <= 0) {
                    throw new VBPProtocolException(VBPProtocolError::Timeout, 'write deadline exceeded');
                }
                $this->waitWritable((int) ($remaining * 1_000_000));
            }
        }
    }

    private function waitReadable(int $timeoutUs): void
    {
        $read = [$this->socket];
        $write = null;
        $except = null;
        $sec = (int) ($timeoutUs / 1_000_000);
        $usec = $timeoutUs % 1_000_000;
        $n = @stream_select($read, $write, $except, $sec, $usec);
        if ($n === false) {
            throw new VBPProtocolException(VBPProtocolError::ConnectionClosed, 'stream_select failed');
        }
        if ($n === 0) {
            // timeout — caller will check deadline
            return;
        }
    }

    private function waitWritable(int $timeoutUs): void
    {
        $read = null;
        $write = [$this->socket];
        $except = null;
        $sec = (int) ($timeoutUs / 1_000_000);
        $usec = $timeoutUs % 1_000_000;
        $n = @stream_select($read, $write, $except, $sec, $usec);
        if ($n === false) {
            throw new VBPProtocolException(VBPProtocolError::ConnectionClosed, 'stream_select failed');
        }
    }

    /**
     * Drain as many full frames from the read buffer as we can.
     * Each frame is dispatched to its seq's inflight slot.
     *
     * *** THE STREAMING FIX ***
     * - DATA_CHUNK / STREAM_CHUNK (non-terminal) → append to slot.frames, do not
     *   mark terminal, do not deliver.
     * - ROWS_FINISHED / COMMAND_COMPLETE (terminal) → append to slot.frames,
     *   mark slot.terminal = true.
     * - ERROR (terminal) → parse, store on slot.error, mark terminal.
     */
    private function drain(): void
    {
        // Pull more bytes from the socket into our buffer.
        if (is_resource($this->socket)) {
            $chunk = @fread($this->socket, 65536);
            if ($chunk !== false && $chunk !== '') {
                $this->readBuf .= $chunk;
            } elseif ($chunk === false) {
                // Treat as closed
                $this->closeError = 'read failed';
            }
        }
        // Try to decode as many full frames as possible.
        while (strlen($this->readBuf) >= VBPFrame::HDR_LEN) {
            $u = unpack('Vpl', substr($this->readBuf, VBPFrame::MAGIC_LEN, VBPFrame::LEN_LEN));
            $pl = $u['pl'] ?? 0;
            if ($pl < VBPFrame::OPFLAGS_LEN || $pl > VBPFrame::MAX_FRAME_LEN) {
                // Bad frame — drop buffer and mark closed.
                $this->readBuf = '';
                $this->closeError = "bad payload_length $pl";
                $this->closing = true;
                return;
            }
            $need = VBPFrame::HDR_LEN + $pl;
            if (strlen($this->readBuf) < $need) {
                // Need more bytes.
                return;
            }
            $raw = substr($this->readBuf, 0, $need);
            $this->readBuf = substr($this->readBuf, $need);
            $frame = VBPFrame::decode($raw, 0);
            $this->dispatchFrame($frame);
        }
    }

    private function dispatchFrame(VBPFrame $frame): void
    {
        $seq = $frame->seq;
        if (!isset($this->inflight[$seq])) {
            // Late frame for a slot we already released. Drop silently.
            return;
        }
        $this->inflight[$seq]['frames'][] = [
            'op' => $frame->op,
            'flags' => $frame->flags,
            'body' => $frame->body,
        ];
        // *** THE STREAMING FIX ***
        if ($frame->op === Ops::OP_ERROR) {
            $this->inflight[$seq]['error'] = VBPTypeCodec::parseErrorBody($frame->body);
            $this->inflight[$seq]['terminal'] = true;
            return;
        }
        if (Ops::isTerminal($frame->op)) {
            // ROWS_FINISHED, COMMAND_COMPLETE, SERVER_READY, AUTH_OK, PONG, CLOSE
            $this->inflight[$seq]['terminal'] = true;
            return;
        }
        // Non-terminal (DATA_CHUNK, STREAM_CHUNK, AUTH_CHALLENGE) — keep going.
    }
}
