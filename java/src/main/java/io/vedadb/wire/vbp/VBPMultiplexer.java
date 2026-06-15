package io.vedadb.wire.vbp;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Thread-safe VBP request multiplexer over a single TCP socket.
 *
 * <p>One seq-id (1 byte, wraps at 256) per in-flight request. Each request is
 * associated with a CountDownLatch that the reader thread releases when the
 * matching response arrives. Multiple threads may issue concurrent calls.
 *
 * <h2>Streaming fix (v2 — the team-engine v2 finding, second attempt)</h2>
 *
 * <p>The first v2 attempt released the caller's latch on the FIRST terminal
 * frame and then tried to "upgrade" {@code inf.reply} to COMMAND_COMPLETE
 * when it arrived. This had a TOCTOU race: the caller's {@code await()}
 * returned on ROWS_FINISHED, the inflight slot was removed from the map,
 * and any COMMAND_COMPLETE arriving after that point was either dropped
 * (slot gone) or appended to a frames list the caller had already passed
 * through. The deterministic fix:
 *
 * <ol>
 *   <li><b>Per-request response class</b> is recorded at submit time
 *       ({@link Inflight#terminalClass}). For QUERY-class ops
 *       (QUERY, EXT_QUERY, PARSE, BIND, COPY_IN, BEGIN, COMMIT, ROLLBACK)
 *       the only valid terminal is COMMAND_COMPLETE. For all other ops
 *       (PING, AUTH_*, HELLO) any single-frame terminal (PONG, AUTH_OK,
 *       SERVER_READY) is valid.</li>
 *   <li><b>Non-terminal frames</b> (DATA_CHUNK, STREAM_CHUNK,
 *       AUTH_CHALLENGE) are ACCUMULATED into {@code inf.frames}. The
 *       caller is NOT woken up.</li>
 *   <li><b>Terminal frames</b> are APPENDED to {@code inf.frames} and
 *       recorded in {@code inf.reply} (latest wins). The latch is
 *       counted down ONLY when a frame matching the expected terminal
 *       class arrives — OR an ERROR arrives (which jumps the queue
 *       unconditionally).</li>
 *   <li><b>Late frames</b> (anything arriving after the latch has been
 *       counted down for this seq) are appended to {@code inf.frames}
 *       but do NOT re-release the latch. This handles the
 *       "trailing COMMAND_COMPLETE after a PONG-class terminal" case
 *       for {@code callCollect()}.</li>
 * </ol>
 *
 * <p>The {@code call()} API returns the {@code inf.reply} frame; for
 * QUERY-class calls this is COMMAND_COMPLETE. The {@code callCollect()}
 * API returns {@link VBPReply} with the full {@code frames} list so
 * callers can consume multi-chunk responses.
 */
public class VBPMultiplexer implements AutoCloseable {

    /** True for opcodes that END a logical response. */
    static boolean isTerminalOpcode(int op) {
        switch (op) {
            case VBPOpcodes.OP_ERROR:
            case VBPOpcodes.OP_COMMAND_COMPLETE:
            case VBPOpcodes.OP_ROWS_FINISHED:
            case VBPOpcodes.OP_AUTH_OK:
            case VBPOpcodes.OP_AUTH_CHALLENGE:  // SCRAM step boundary
            case VBPOpcodes.OP_SERVER_READY:
            case VBPOpcodes.OP_PONG:
            case VBPOpcodes.OP_CLOSE:
                return true;
            default:
                return false;
        }
    }

    /**
     * For a given REQUEST opcode, the expected terminal frame opcode
     * that will signal the END of the response. Returns -1 if any
     * terminal is acceptable (single-frame response classes).
     *
     * <p>QUERY-class requests always end with COMMAND_COMPLETE; PING
     * ends with PONG; auth rounds end with AUTH_OK or AUTH_CHALLENGE;
     * HELLO ends with SERVER_READY (or AUTH_CHALLENGE for SCRAM).
     */
    static int expectedTerminalFor(int op) {
        switch (op) {
            case VBPOpcodes.OP_QUERY:
            case VBPOpcodes.OP_EXT_QUERY:
            case VBPOpcodes.OP_PARSE:
            case VBPOpcodes.OP_BIND:
            case VBPOpcodes.OP_COPY_IN:
            case VBPOpcodes.OP_COPY_DONE:
            case VBPOpcodes.OP_COPY_FAIL:
            case VBPOpcodes.OP_BEGIN:
            case VBPOpcodes.OP_COMMIT:
            case VBPOpcodes.OP_ROLLBACK:
            case VBPOpcodes.OP_CANCEL_QUERY:
                return VBPOpcodes.OP_COMMAND_COMPLETE;
            case VBPOpcodes.OP_PING:
                return VBPOpcodes.OP_PONG;
            // Auth rounds: AUTH_CHALLENGE mid-handshake, AUTH_OK final.
            // We treat any of those as terminal for the round.
            case VBPOpcodes.OP_CLIENT_HELLO:
            case VBPOpcodes.OP_AUTH_RESPONSE:
                return -1; // any of AUTH_OK / AUTH_CHALLENGE / ERROR
            default:
                return -1;
        }
    }

    private final Socket socket;
    private final InputStream in;
    private final OutputStream out;
    private final ExecutorService readerExec;
    private final AtomicBoolean closing = new AtomicBoolean(false);

    private final Object seqLock = new Object();
    private int nextSeq = 0;
    private final ConcurrentHashMap<Integer, Inflight> inflight = new ConcurrentHashMap<>();

    public VBPMultiplexer(String host, int port, int timeoutMs) throws IOException {
        this.socket = new Socket();
        socket.connect(new InetSocketAddress(host, port), timeoutMs);
        socket.setSoTimeout(timeoutMs);
        this.in = socket.getInputStream();
        this.out = socket.getOutputStream();
        this.readerExec = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "vbp-reader");
            t.setDaemon(true);
            return t;
        });
        readerExec.submit(this::readLoop);
    }

    // For test injection: construct with a pair of streams and a separate reader.
    VBPMultiplexer(InputStream in, OutputStream out) {
        this.socket = null;
        this.in = in;
        this.out = out;
        this.readerExec = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "vbp-reader");
            t.setDaemon(true);
            return t;
        });
        readerExec.submit(this::readLoop);
    }

    /** Send a request and synchronously wait for the reply. */
    public VBPFrame call(int op, byte[] body) {
        return call(op, body, 0, 30_000);
    }

    /**
     * Send a request and synchronously wait for the reply.
     *
     * <p>Returns the terminal frame (e.g. COMMAND_COMPLETE for QUERY
     * calls, PONG for PING calls). For QUERY-class calls the terminal is
     * always COMMAND_COMPLETE — ROWS_FINISHED is treated as a
     * non-terminal marker that just gets accumulated.
     */
    public VBPFrame call(int op, byte[] body, int flags, int timeoutMs) {
        int seq;
        Inflight inf;
        int expected = expectedTerminalFor(op);
        synchronized (seqLock) {
            int tries = 0;
            do {
                seq = nextSeq;
                nextSeq = (nextSeq + 1) & 0xFF;
                tries++;
            } while (inflight.containsKey(seq) && tries <= 256);
            if (inflight.containsKey(seq)) {
                throw new VBPProtocolError("all 256 sequence ids in flight");
            }
            inf = new Inflight(expected);
            inflight.put(seq, inf);
        }
        try {
            synchronized (out) {
                byte[] encoded = new VBPFrame(seq, op, flags, body).encode();
                out.write(encoded);
                out.flush();
            }
        } catch (IOException e) {
            inflight.remove(seq);
            close();
            throw new VBPConnectionClosed("send failed: " + e.getMessage(), e);
        }
        try {
            if (!inf.latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                inflight.remove(seq);
                throw new VBPProtocolError("timeout waiting for seq=" + seq);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            inflight.remove(seq);
            throw new VBPProtocolError("interrupted waiting for seq=" + seq);
        }
        VBPFrame reply = inf.reply;
        inflight.remove(seq);
        if (reply == null) {
            throw new VBPConnectionClosed("connection closed mid-call");
        }
        if (reply.op == VBPOpcodes.OP_ERROR) {
            VBPTypeCodec.ErrorParts err = VBPTypeCodec.parseErrorBody(reply.body);
            throw new VBPError(err.sqlstate, err.message, err.detail, err.hint);
        }
        return reply;
    }

    /**
     * Send a request and return ALL frames for the seq, including
     * non-terminal DATA_CHUNKs and the terminal frame.
     */
    public VBPReply callCollect(int op, byte[] body, int flags, int timeoutMs) {
        int seq;
        Inflight inf;
        int expected = expectedTerminalFor(op);
        synchronized (seqLock) {
            int tries = 0;
            do {
                seq = nextSeq;
                nextSeq = (nextSeq + 1) & 0xFF;
                tries++;
            } while (inflight.containsKey(seq) && tries <= 256);
            if (inflight.containsKey(seq)) {
                throw new VBPProtocolError("all 256 sequence ids in flight");
            }
            inf = new Inflight(expected);
            inflight.put(seq, inf);
        }
        try {
            synchronized (out) {
                byte[] encoded = new VBPFrame(seq, op, flags, body).encode();
                out.write(encoded);
                out.flush();
            }
        } catch (IOException e) {
            inflight.remove(seq);
            close();
            throw new VBPConnectionClosed("send failed: " + e.getMessage(), e);
        }
        try {
            if (!inf.latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                inflight.remove(seq);
                throw new VBPProtocolError("timeout waiting for seq=" + seq);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            inflight.remove(seq);
            throw new VBPProtocolError("interrupted waiting for seq=" + seq);
        }
        VBPFrame terminal = inf.reply;
        List<VBPFrame> frames = inf.frames;
        inflight.remove(seq);
        if (terminal == null) {
            throw new VBPConnectionClosed("connection closed mid-call");
        }
        if (terminal.op == VBPOpcodes.OP_ERROR) {
            VBPTypeCodec.ErrorParts err = VBPTypeCodec.parseErrorBody(terminal.body);
            throw new VBPError(err.sqlstate, err.message, err.detail, err.hint);
        }
        return new VBPReply(terminal, frames);
    }

    private void readLoop() {
        try {
            while (!closing.get()) {
                VBPFrame f = readOne();
                if (f == null) break;
                Inflight inf = inflight.get(f.seq);
                if (inf != null) {
                    // *** STREAMING FIX (v2, second attempt) ***
                    //
                    // Step 1: append every frame to inf.frames under the
                    // slot's monitor. The caller reads this list after
                    // the latch counts down, so this is the source of
                    // truth for all frames received for this seq.
                    synchronized (inf) {
                        inf.frames.add(f);
                    }
                    // Step 2: non-terminal frames (DATA_CHUNK,
                    // STREAM_CHUNK, AUTH_CHALLENGE) do not advance the
                    // terminal state. The caller remains parked on the
                    // latch.
                    if (!isTerminalOpcode(f.op)) {
                        continue;
                    }
                    // Step 3: terminal frame. Decide whether it ENDS the
                    // response for this seq based on the per-request
                    // expected terminal class.
                    synchronized (inf) {
                        // ERROR jumps the queue unconditionally — it
                        // surfaces immediately even if a prior terminal
                        // (e.g. a "trailing" COMMAND_COMPLETE) was
                        // about to count down.
                        if (f.op == VBPOpcodes.OP_ERROR) {
                            inf.reply = f;
                            inf.latch.countDown();
                            continue;
                        }
                        // Check if this terminal frame matches the
                        // expected terminal class for this request.
                        // For QUERY-class, only COMMAND_COMPLETE ends
                        // the response; ROWS_FINISHED just gets
                        // recorded. For PING, only PONG ends it. For
                        // AUTH/HELLO, any single-frame terminal ends it.
                        boolean isExpected;
                        if (inf.expectedTerminal == -1) {
                            // any-terminal class
                            isExpected = true;
                        } else {
                            isExpected = (f.op == inf.expectedTerminal);
                        }
                        if (isExpected) {
                            inf.reply = f;
                            if (inf.latch.getCount() > 0) {
                                inf.latch.countDown();
                            }
                        }
                        // Late terminal (ROWS_FINISHED after
                        // COMMAND_COMPLETE, etc.): just sits in inf.frames
                        // for callCollect() to see. The inf.reply
                        // already holds the expected terminal; we don't
                        // overwrite it.
                    }
                }
            }
        } catch (Throwable t) {
            // Connection lost — release all waiters with null reply.
        } finally {
            for (Inflight inf : inflight.values()) {
                inf.latch.countDown();
            }
        }
    }

    private VBPFrame readOne() {
        try {
            byte[] hdr = new byte[VBPFrame.HDR_LEN];
            readFully(hdr);
            if (hdr[0] != VBPFrame.MAGIC[0] || hdr[1] != VBPFrame.MAGIC[1] || hdr[2] != VBPFrame.MAGIC[2]) {
                throw new VBPBadMagic("bad magic in response");
            }
            int pl = ByteBuffer.wrap(hdr, 3, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
            if (pl < VBPFrame.OPFLAGS_LEN) throw new VBPFrameTooShort("payload too short: " + pl);
            if (pl > VBPFrame.MAX_FRAME_LEN) throw new VBPFrameTooLarge("payload too large: " + pl);
            int seq = hdr[7] & 0xFF;
            byte[] opflags = new byte[VBPFrame.OPFLAGS_LEN];
            readFully(opflags);
            int op = opflags[0] & 0xFF;
            int flags = opflags[1] & 0xFF;
            int bodyLen = pl - VBPFrame.OPFLAGS_LEN;
            byte[] body = new byte[bodyLen];
            if (bodyLen > 0) readFully(body);
            return new VBPFrame(seq, op, flags, body);
        } catch (IOException e) {
            return null;
        }
    }

    private void readFully(byte[] buf) throws IOException {
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n < 0) throw new IOException("EOF");
            off += n;
        }
    }

    @Override
    public void close() {
        if (!closing.compareAndSet(false, true)) return;
        try { socket.close(); } catch (Exception ignored) {}
        readerExec.shutdownNow();
        for (Inflight inf : inflight.values()) inf.latch.countDown();
    }

    public boolean isClosed() { return closing.get(); }

    /**
     * Inflight request bookkeeping.
     *
     * <p>The v2 streaming fix (second attempt) adds:
     * <ul>
     *   <li>{@link #frames} — accumulates every frame received for this
     *       seq in arrival order. Caller-visible via callCollect().</li>
     *   <li>{@link #expectedTerminal} — the opcode that ends this
     *       response (e.g. COMMAND_COMPLETE for QUERY, PONG for PING,
     *       -1 for any-terminal). The reader uses this to decide
     *       whether to count down the latch.</li>
     *   <li>{@link #reply} — the frame that ended the response, set
     *       exactly when the expected terminal arrives. Defaults to
     *       null; an ERROR overrides any prior value (queue-jump).</li>
     * </ul>
     */
    static final class Inflight {
        final CountDownLatch latch = new CountDownLatch(1);
        /** The expected terminal opcode (e.g. OP_COMMAND_COMPLETE for QUERY), or -1 for any. */
        final int expectedTerminal;
        /** The terminal frame that ended the response, or null. */
        volatile VBPFrame reply;
        /** Every frame received for this seq, in arrival order. */
        final List<VBPFrame> frames = new ArrayList<>();

        Inflight(int expectedTerminal) {
            this.expectedTerminal = expectedTerminal;
        }
    }
}
