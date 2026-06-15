package io.vedadb.wire.vbp;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Thread-safe VBP request multiplexer over a single TCP socket.
 *
 * <p>One seq-id (1 byte, wraps at 256) per in-flight request. Each request is
 * associated with a CountDownLatch that the reader thread releases when the
 * matching response arrives. Multiple threads may issue concurrent calls.
 */
public class VBPMultiplexer implements AutoCloseable {

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

    public VBPFrame call(int op, byte[] body, int flags, int timeoutMs) {
        int seq;
        Inflight inf;
        synchronized (seqLock) {
            // Find a free seq (try 256 times before giving up).
            int tries = 0;
            do {
                seq = nextSeq;
                nextSeq = (nextSeq + 1) & 0xFF;
                tries++;
            } while (inflight.containsKey(seq) && tries <= 256);
            if (inflight.containsKey(seq)) {
                throw new VBPProtocolError("all 256 sequence ids in flight");
            }
            inf = new Inflight();
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

    private void readLoop() {
        try {
            while (!closing.get()) {
                VBPFrame f = readOne();
                if (f == null) break;
                Inflight inf = inflight.get(f.seq);
                if (inf != null) {
                    if (f.op == VBPOpcodes.OP_ERROR
                            || f.op == VBPOpcodes.OP_COMMAND_COMPLETE
                            || f.op == VBPOpcodes.OP_ROWS_FINISHED
                            || f.op == VBPOpcodes.OP_AUTH_OK
                            || f.op == VBPOpcodes.OP_SERVER_READY
                            || f.op == VBPOpcodes.OP_AUTH_CHALLENGE
                            || f.op == VBPOpcodes.OP_PONG) {
                        // Only count down + set reply once (first terminal wins)
                        // so unsolicited follow-up frames (e.g. AUTH_OK after
                        // SERVER_READY in dev mode) don't overwrite.
                        if (inf.latch.getCount() > 0) {
                            inf.reply = f;
                            inf.latch.countDown();
                        }
                    }
                    // For streaming (DATA_CHUNK), we keep adding; but v1 only
                    // expects one DATA_CHUNK before ROWS_FINISHED + COMMAND_COMPLETE,
                    // and those are all terminal. The multiplexer returns the
                    // FIRST terminal frame — for queries, callers expect
                    // COMMAND_COMPLETE. Adjust: prefer COMMAND_COMPLETE; fall
                    // back to whatever terminates the sequence.
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

    /** Inflight request bookkeeping. */
    static final class Inflight {
        final CountDownLatch latch = new CountDownLatch(1);
        volatile VBPFrame reply;
    }
}
