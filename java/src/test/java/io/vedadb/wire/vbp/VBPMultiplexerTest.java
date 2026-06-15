package io.vedadb.wire.vbp;

import org.junit.jupiter.api.Test;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests the multiplexer against a paired in-process PipedInputStream/Output.
 * Drives synthetic frame sequences through the pipe and verifies the
 * multiplexer's request/response correlation by seq.
 */
class VBPMultiplexerTest {

    /**
     * Build a multiplexer that talks to a fake "server" via a pair of pipes.
     * Returns the multiplexer and the server-side OutputStream the test
     * can use to write replies.
     */
    private static class Pair {
        final VBPMultiplexer mux;
        final OutputStream serverOut;
        final InputStream serverIn;
        final PipedInputStream clientIn;
        final PipedOutputStream serverSideOfClient;
        Pair(VBPMultiplexer m, OutputStream so, InputStream si) {
            mux = m; serverOut = so; serverIn = si;
            clientIn = null; serverSideOfClient = null;
        }
        Pair(VBPMultiplexer m, OutputStream so, InputStream si,
             PipedInputStream ci, PipedOutputStream sc) {
            mux = m; serverOut = so; serverIn = si; clientIn = ci; serverSideOfClient = sc;
        }
    }

    private Pair makePair() throws Exception {
        // server's read pipe (what the server reads from)
        PipedOutputStream serverReadPipe = new PipedOutputStream();
        PipedInputStream serverReadSide = new PipedInputStream(serverReadPipe, 65536);
        // client's read pipe (what the client reads from)
        PipedOutputStream clientReadPipe = new PipedOutputStream();
        PipedInputStream clientReadSide = new PipedInputStream(clientReadPipe, 65536);
        // The mux reads from clientReadSide and writes to serverReadPipe.
        // For the test to write replies, we write to clientReadPipe and read from serverReadSide.
        VBPMultiplexer m = new VBPMultiplexer(clientReadSide, serverReadPipe);
        return new Pair(m, clientReadPipe, serverReadSide, clientReadSide, serverReadPipe);
    }

    @Test
    void sendSinglePongReply() throws Exception {
        Pair p = makePair();
        AtomicReference<VBPFrame> received = new AtomicReference<>();
        // Server: read full request (header + opflags + body), then write PONG with same seq.
        Thread srv = new Thread(() -> {
            try {
                // Read the full frame: 8-byte header + payload_length.
                byte[] hdr = readBytes(p.serverIn, 8);
                int pl = ((hdr[3]&0xFF)) | ((hdr[4]&0xFF)<<8) | ((hdr[5]&0xFF)<<16) | ((hdr[6]&0xFF)<<24);
                int seq = hdr[7] & 0xFF;
                byte[] payload = readBytes(p.serverIn, pl); // opflags + body
                VBPFrame req = new VBPFrame(seq, payload[0] & 0xFF, payload[1] & 0xFF,
                        java.util.Arrays.copyOfRange(payload, 2, pl));
                received.set(req);
                VBPFrame pong = new VBPFrame(req.seq, VBPOpcodes.OP_PONG, 0, new byte[0]);
                p.serverOut.write(pong.encode());
                p.serverOut.flush();
            } catch (Exception e) { throw new RuntimeException(e); }
        });
        srv.setDaemon(true); srv.start();

        VBPFrame reply = p.mux.call(VBPOpcodes.OP_PING, new byte[0], 0, 2000);
        srv.join(2000);
        assertEquals(VBPOpcodes.OP_PONG, reply.op);
        assertEquals(VBPOpcodes.OP_PING, received.get().op);
        p.mux.close();
    }

    @Test
    void seqAllocationIsUnique() throws Exception {
        Pair p = makePair();
        // Spawn a server that responds to each request with the same seq
        Thread srv = new Thread(() -> {
            try {
                for (int i = 0; i < 5; i++) {
                    byte[] hdr = readBytes(p.serverIn, 8);
                    int pl = ((hdr[3]&0xFF)) | ((hdr[4]&0xFF)<<8) | ((hdr[5]&0xFF)<<16) | ((hdr[6]&0xFF)<<24);
                    int seq = hdr[7] & 0xFF;
                    readBytes(p.serverIn, pl);
                    VBPFrame pong = new VBPFrame(seq, VBPOpcodes.OP_PONG, 0, new byte[0]);
                    p.serverOut.write(pong.encode());
                    p.serverOut.flush();
                }
            } catch (Exception e) { throw new RuntimeException(e); }
        });
        srv.setDaemon(true); srv.start();

        // Issue 5 sequential calls. After each, the seq must increment.
        int lastSeq = -1;
        for (int i = 0; i < 5; i++) {
            VBPFrame r = p.mux.call(VBPOpcodes.OP_PING, new byte[0], 0, 2000);
            assertEquals(VBPOpcodes.OP_PONG, r.op);
        }
        srv.join(2000);
        p.mux.close();
    }

    @Test
    void errorFrameThrowsVBPError() throws Exception {
        Pair p = makePair();
        Thread srv = new Thread(() -> {
            try {
                byte[] hdr = readBytes(p.serverIn, 8);
                int pl = ((hdr[3]&0xFF)) | ((hdr[4]&0xFF)<<8) | ((hdr[5]&0xFF)<<16) | ((hdr[6]&0xFF)<<24);
                int seq = hdr[7] & 0xFF;
                readBytes(p.serverIn, pl);
                byte[] errBody = VBPTypeCodec.errorBody("42P01", "undefined_table", "", "");
                VBPFrame err = new VBPFrame(seq, VBPOpcodes.OP_ERROR, 0, errBody);
                p.serverOut.write(err.encode());
                p.serverOut.flush();
            } catch (Exception e) { throw new RuntimeException(e); }
        });
        srv.setDaemon(true); srv.start();
        Exception ex = assertThrows(Exception.class,
                () -> p.mux.call(VBPOpcodes.OP_QUERY, new byte[0], 0, 2000));
        assertTrue(ex instanceof VBPError, "expected VBPError, got " + ex.getClass().getName());
        assertEquals("42P01", ((VBPError) ex).sqlstate);
        assertTrue(ex.getMessage().contains("undefined_table"));
        p.mux.close();
    }

    @Test
    void closeIsIdempotent() throws Exception {
        Pair p = makePair();
        p.mux.close();
        p.mux.close(); // no throw
        assertTrue(p.mux.isClosed());
    }

    @Test
    void callAfterCloseThrows() throws Exception {
        Pair p = makePair();
        p.mux.close();
        assertThrows(Exception.class, () -> p.mux.call(VBPOpcodes.OP_PING, new byte[0]));
    }

    private static byte[] readBytes(InputStream in, int n) throws Exception {
        byte[] b = new byte[n];
        int off = 0;
        while (off < n) {
            int k = in.read(b, off, n - off);
            if (k < 0) throw new RuntimeException("EOF after " + off + "/" + n);
            off += k;
        }
        return b;
    }
}
