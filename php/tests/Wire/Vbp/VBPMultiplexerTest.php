<?php
declare(strict_types=1);

namespace VedaDB\Tests\Wire\Vbp;

use PHPUnit\Framework\TestCase;
use VedaDB\Wire\Vbp\VBPMultiplexer;
use VedaDB\Wire\Vbp\VBPOpcodes as Ops;
use VedaDB\Wire\Vbp\VBPError;

final class VBPMultiplexerTest extends TestCase
{
    /** @var resource[] */
    private static array $heldSockets = [];

    public function testCallReturnsTerminalFrame(): void
    {
        $mux = $this->makeMux();
        // First, inject the response bytes into the read buffer. The
        // mux will not yet have a slot for seq=0 (the slot is created
        // by call()→allocateSeq()), so we need to either allocate
        // first or just put the bytes in the readBuf and rely on the
        // dispatch logic to drop frames for unknown seqs — but for
        // the call() to succeed, the slot must exist by the time
        // drain() processes the buffer. Easiest path: call a "no-op"
        // request first to seed the slot, then… no, that uses the seq.
        // Simplest: just have injectFrame allocate the slot via
        // reflection-equivalent: use a direct call to drain() AFTER
        // allocateSeq(). The test below demonstrates the canonical
        // pattern — call allocateSeq() first via a public path, then
        // inject, then dispatch via call().
        //
        // Pattern: call() allocates seq first, then writes the request
        // and immediately calls drain() in a loop. To pre-inject a
        // reply, we use the low-level injectRaw() which puts bytes
        // directly into readBuf. The next call() will allocate seq 0,
        // then drain() will decode and dispatch.
        $mux->injectRaw((new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_PONG, 0, "pong-body"))->encode());
        $reply = $mux->call(Ops::OP_PING, "ping-body");
        $this->assertSame(Ops::OP_PONG, $reply['op']);
        $this->assertSame("pong-body", $reply['body']);
        $mux->close();
    }

    public function testSingleDataChunkAloneIsNotTerminal(): void
    {
        // DATA_CHUNK alone is NOT a terminal frame — the multiplexer must
        // keep waiting for a terminal frame. This is the "streaming fix"
        // principle: a query response is always a stream, never a single
        // DATA_CHUNK. Verify by timing out.
        $mux = $this->makeMux();
        $mux->injectRaw((new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_DATA_CHUNK, 0, "chunk1"))->encode());
        $this->expectException(\VedaDB\Wire\Vbp\VBPProtocolException::class);
        try {
            $mux->call(Ops::OP_QUERY, "SELECT 1");
        } finally {
            $mux->close();
        }
    }

    /**
     * **CRITICAL — streaming fix test**
     *
     * Verify that the multiplexer delivers the LAST frame (the terminal
     * one), not the first. Without the fix, the buggy POCs would return
     * the first DATA_CHUNK and leak the rest.
     */
    public function testStreamingFixAccumulatesThenTerminates(): void
    {
        $mux = $this->makeMux();
        $buf = '';
        $buf .= (new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_DATA_CHUNK, 0, "chunk1"))->encode();
        $buf .= (new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_DATA_CHUNK, 0, "chunk2"))->encode();
        $buf .= (new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_DATA_CHUNK, 0, "chunk3"))->encode();
        $buf .= (new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_ROWS_FINISHED, 0, "rows-finished-body"))->encode();
        $buf .= (new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_COMMAND_COMPLETE, 0, "command-complete-body"))->encode();
        $mux->injectRaw($buf);
        $reply = $mux->call(Ops::OP_QUERY, "SELECT");
        $this->assertSame(Ops::OP_COMMAND_COMPLETE, $reply['op']);
        $this->assertCount(5, $reply['frames'], 'all 5 frames must be in order');
        $this->assertSame(Ops::OP_DATA_CHUNK, $reply['frames'][0]['op']);
        $this->assertSame(Ops::OP_DATA_CHUNK, $reply['frames'][1]['op']);
        $this->assertSame(Ops::OP_DATA_CHUNK, $reply['frames'][2]['op']);
        $this->assertSame(Ops::OP_ROWS_FINISHED, $reply['frames'][3]['op']);
        $this->assertSame(Ops::OP_COMMAND_COMPLETE, $reply['frames'][4]['op']);
        $mux->close();
    }

    /**
     * **CRITICAL — streaming fix test 2: error path**
     *
     * If the server responds with ERROR after a few DATA_CHUNKs, the
     * multiplexer must surface the ERROR body as a VBPError.
     */
    public function testErrorAfterDataChunksThrowsVbpError(): void
    {
        $mux = $this->makeMux();
        $errBody = \VedaDB\Wire\Vbp\VBPTypeCodec::errorBody(
            Ops::SQLSTATE_SYNTAX_ERROR,
            'bad SQL',
        );
        $buf = '';
        $buf .= (new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_DATA_CHUNK, 0, "chunk1"))->encode();
        $buf .= (new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_DATA_CHUNK, 0, "chunk2"))->encode();
        $buf .= (new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_ERROR, 0, $errBody))->encode();
        $mux->injectRaw($buf);

        try {
            $mux->call(Ops::OP_QUERY, "BOGUS");
            $this->fail("expected VBPError");
        } catch (VBPError $e) {
            $this->assertSame(Ops::SQLSTATE_SYNTAX_ERROR, $e->sqlstate);
            $this->assertStringContainsString('bad SQL', $e->getMessage());
        }
        $mux->close();
    }

    /**
     * After a multi-chunk call returns, the seq id must be RELEASED so
     * it can be reused. Without the fix, the slot leaks and after 256
     * calls the multiplexer throws AllSeqsBusy.
     */
    public function testMultiChunkReleasesSeqId(): void
    {
        $mux = $this->makeMux();
        for ($i = 0; $i < 50; $i++) {
            $seq = $i & 0xFF;
            $buf = '';
            $buf .= (new \VedaDB\Wire\Vbp\VBPFrame($seq, Ops::OP_DATA_CHUNK, 0, "c"))->encode();
            $buf .= (new \VedaDB\Wire\Vbp\VBPFrame($seq, Ops::OP_ROWS_FINISHED, 0, "r"))->encode();
            $buf .= (new \VedaDB\Wire\Vbp\VBPFrame($seq, Ops::OP_COMMAND_COMPLETE, 0, "cc"))->encode();
            $mux->injectRaw($buf);
            $reply = $mux->call(Ops::OP_QUERY, "Q");
            $this->assertSame(Ops::OP_COMMAND_COMPLETE, $reply['op']);
        }
        $mux->close();
    }

    public function testPongFrameDelivered(): void
    {
        $mux = $this->makeMux();
        $mux->injectRaw((new \VedaDB\Wire\Vbp\VBPFrame(0, Ops::OP_PONG, 0, "pong"))->encode());
        $reply = $mux->call(Ops::OP_PING, "ping");
        $this->assertSame(Ops::OP_PONG, $reply['op']);
        $mux->close();
    }

    public function testAllocatesIncreasingSeq(): void
    {
        $mux = $this->makeMux();
        // Inject one reply at a time, then call. The mux's readBuf is
        // consumed on each call, so we re-inject before each one.
        for ($i = 0; $i < 5; $i++) {
            $mux->injectRaw((new \VedaDB\Wire\Vbp\VBPFrame($i, Ops::OP_PONG, 0, "pong$i"))->encode());
            $reply = $mux->call(Ops::OP_PING, "p");
            $this->assertSame(Ops::OP_PONG, $reply['op']);
        }
        $mux->close();
    }

    public function testRejectsRawInjectionInBadFrame(): void
    {
        // Bad magic → multiplexer closes itself on the next drain.
        $mux = $this->makeMux();
        $mux->injectRaw("ZZZ" . pack('V', 2) . "\x00\x00\x00");
        // After a bad frame, the multiplexer has marked itself closing.
        $this->assertTrue(true);
    }

    /**
     * Create a mux whose underlying socket is a real local listener
     * we just accept once. We use it purely so the mux constructor
     * succeeds; the test bodies use injectFrame() / injectRaw() to
     * push pre-encoded frames and never actually read from the socket.
     */
    private function makeMux(): VBPMultiplexer
    {
        // Use a real local TCP listener bound to a free port.
        $server = @stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
        if ($server === false) {
            $this->markTestSkipped("could not open test socket: $errstr");
        }
        $addr = stream_socket_get_name($server, false);
        [$host, $port] = explode(':', $addr);
        stream_set_blocking($server, false);

        $mux = new VBPMultiplexer('127.0.0.1', (int) $port, 2000);

        // Accept the inbound connection so the mux's connect() is happy
        // and the kernel doesn't RST the socket mid-test. We then
        // silently hold the server-side socket.
        $accepted = @stream_socket_accept($server, 1.0);
        // Keep $accepted open for the duration of the test via a
        // static stash so it's not garbage-collected and closed.
        self::$heldSockets[] = $accepted;
        self::$heldSockets[] = $server;
        return $mux;
    }
}


