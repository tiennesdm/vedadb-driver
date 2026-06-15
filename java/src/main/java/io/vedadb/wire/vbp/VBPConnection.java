package io.vedadb.wire.vbp;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * High-level synchronous VBP client.
 *
 * <p>Constructor: {@code new VBPConnection(host, port, user, password, db, timeoutSeconds)}.
 * <p>Call {@link #connect()} to perform CLIENT_HELLO + AUTH (PLAIN or SCRAM) + AUTH_OK.
 * <p>Then {@link #execute(String, List)} for queries. {@link #ping()} for liveness.
 */
public class VBPConnection implements AutoCloseable {

    public static final int DEFAULT_VBP_PORT = 6380;

    private final String host;
    private final int port;
    private final String user;
    private final String password;
    private final String database;
    private final int timeoutMs;
    private final String authMechanism;

    private VBPMultiplexer mux;
    private int serverVersion = 0;
    private int serverCaps = 0;
    private long sessionTokenLo = 0;
    private long sessionTokenHi = 0;
    private final AtomicInteger nextQueryId = new AtomicInteger(1);

    public VBPConnection(String host, int port, String user, String password,
                         String database, int timeoutSeconds) {
        this(host, port, user, password, database, timeoutSeconds, System.getenv("VEDADB_VBP_MECH"));
    }

    public VBPConnection(String host, int port, String user, String password,
                         String database, int timeoutSeconds, String authMechanism) {
        this.host = host;
        this.port = port;
        this.user = user;
        this.password = password;
        this.database = database == null ? "" : database;
        this.timeoutMs = timeoutSeconds * 1000;
        this.authMechanism = (authMechanism == null || authMechanism.isEmpty())
                ? VBPOpcodes.AUTH_MECH_PLAIN : authMechanism.toUpperCase();
    }

    public VBPConnection connect() {
        try {
            mux = new VBPMultiplexer(host, port, timeoutMs);
        } catch (Exception e) {
            throw new VBPException("08006", "connect failed: " + e.getMessage());
        }
        // CLIENT_HELLO
        byte[] hello = VBPTypeCodec.clientHelloBody(1, 0, user, database, (byte) 0, user);
        VBPFrame ready = mux.call(VBPOpcodes.OP_CLIENT_HELLO, hello);
        if (ready.op != VBPOpcodes.OP_SERVER_READY) {
            throw new VBPError("08006", "expected SERVER_READY, got " + VBPOpcodes.opcodeName(ready.op));
        }
        VBPTypeCodec.ServerReadyParts sr = VBPTypeCodec.parseServerReady(ready.body);
        this.serverVersion = sr.serverVersion;
        this.serverCaps = sr.serverCaps;

        // Auth
        if (sr.authRequired) {
            VBPFrame authResp;
            if (VBPOpcodes.AUTH_MECH_SCRAM_SHA_256.equals(authMechanism)) {
                authResp = performScramAuth(ready, sr);
            } else {
                byte[] plain = VBPAuth.plainClientFirst(user, password);
                authResp = mux.call(VBPOpcodes.OP_AUTH_RESPONSE, plain);
            }
            if (authResp.op != VBPOpcodes.OP_AUTH_OK) {
                throw new VBPError("28000", "auth failed: " + VBPOpcodes.opcodeName(authResp.op));
            }
            VBPTypeCodec.AuthOkParts ok = VBPTypeCodec.parseAuthOk(authResp.body);
            this.sessionTokenLo = ok.sessionTokenLo;
            this.sessionTokenHi = ok.sessionTokenHi;
        }
        return this;
    }

    private VBPFrame performScramAuth(VBPFrame ready, VBPTypeCodec.ServerReadyParts sr) {
        // PLAIN is the default; SCRAM flow is implemented in VBPAuth but the
        // vbp_dev_server uses PLAIN dev-mode auth (auth_required bit is 0).
        // This branch is wired but only used when sr.authRequired is true AND
        // the server actually challenges us.
        byte[] nonceBytes = VBPAuth.generateNonce();
        String clientFirst = VBPAuth.clientFirstMessage(user, nonceBytes);
        VBPFrame challenge = mux.call(VBPOpcodes.OP_AUTH_RESPONSE,
                ("SCRAM-SHA-256 " + clientFirst).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        if (challenge.op == VBPOpcodes.OP_AUTH_OK) return challenge;
        if (challenge.op != VBPOpcodes.OP_AUTH_CHALLENGE) {
            throw new VBPError("28000", "expected AUTH_CHALLENGE, got " + VBPOpcodes.opcodeName(challenge.op));
        }
        String serverFirst = new String(challenge.body, java.nio.charset.StandardCharsets.UTF_8);
        VBPAuth.ScramState state = new VBPAuth.ScramState(nonceBytes);
        String clientFinal = VBPAuth.clientFinalMessage(state, user, password, serverFirst);
        VBPFrame serverFinal = mux.call(VBPOpcodes.OP_AUTH_RESPONSE,
                clientFinal.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        if (serverFinal.op == VBPOpcodes.OP_AUTH_OK) return serverFinal;
        if (serverFinal.op != VBPOpcodes.OP_AUTH_CHALLENGE) {
            throw new VBPError("28000", "expected server-final AUTH_CHALLENGE, got " + VBPOpcodes.opcodeName(serverFinal.op));
        }
        String sf = new String(serverFinal.body, java.nio.charset.StandardCharsets.UTF_8);
        VBPAuth.verifyServerFinal(state, sf);
        // After verify, request a final AUTH_OK.
        VBPFrame ok = mux.call(VBPOpcodes.OP_AUTH_RESPONSE, new byte[0]);
        if (ok.op != VBPOpcodes.OP_AUTH_OK) {
            throw new VBPError("28000", "expected AUTH_OK after SCRAM, got " + VBPOpcodes.opcodeName(ok.op));
        }
        return ok;
    }

    public VBPResult execute(String sql) {
        return execute(sql, Collections.emptyList());
    }

    public VBPResult execute(String sql, List<Object> params) {
        if (mux == null) throw new VBPException("08006", "not connected");
        List<byte[]> envs = new ArrayList<>();
        if (params != null) {
            for (Object p : params) {
                envs.add(encodeParam(p));
            }
        }
        byte[] body = VBPTypeCodec.queryBody(nextQueryId.getAndIncrement(), sql, envs);
        VBPFrame f = mux.call(VBPOpcodes.OP_QUERY, body);
        // f is the first terminal frame. For a SELECT, the multiplexer returned
        // ROWS_FINISHED or COMMAND_COMPLETE (it treats them as terminal). The
        // dev server typically returns DATA_CHUNK then COMMAND_COMPLETE — the
        // multiplexer releases the latch on COMMAND_COMPLETE (the most
        // terminal). For v1 POC, we return a minimal result.
        if (f.op == VBPOpcodes.OP_COMMAND_COMPLETE) {
            return new VBPResult(new ArrayList<>(), new ArrayList<>(),
                    new ArrayList<>(), "OK", 0);
        }
        if (f.op == VBPOpcodes.OP_DATA_CHUNK) {
            VBPTypeCodec.DataChunk dc = VBPTypeCodec.parseDataChunk(f.body);
            List<String> cols = new ArrayList<>();
            List<Integer> colTypes = new ArrayList<>();
            for (int t : dc.colTypes) {
                cols.add(VBPOpcodes.typeName(t));
                colTypes.add(t);
            }
            List<List<Object>> rows = new ArrayList<>();
            rows.add(dc.rowValues);
            return new VBPResult(cols, colTypes, rows, "SELECT", 0);
        }
        return new VBPResult(new ArrayList<>(), new ArrayList<>(),
                new ArrayList<>(), VBPOpcodes.opcodeName(f.op), 0);
    }

    public long ping() {
        if (mux == null) throw new VBPException("08006", "not connected");
        long t0 = System.nanoTime();
        // PING body: u64 nonce (dev server requires ≥8 bytes; spec is silent but
        // the Go reference writes the same nonce back in PONG).
        byte[] nonce = new byte[8];
        java.nio.ByteBuffer.wrap(nonce).order(java.nio.ByteOrder.LITTLE_ENDIAN).putLong(t0);
        VBPFrame pong = mux.call(VBPOpcodes.OP_PING, nonce);
        if (pong.op != VBPOpcodes.OP_PONG) {
            throw new VBPError("08006", "expected PONG, got " + VBPOpcodes.opcodeName(pong.op));
        }
        return (System.nanoTime() - t0) / 1_000_000L;
    }

    private static byte[] encodeParam(Object p) {
        if (p == null) return VBPTypeCodec.inputEnvelopeNull(VBPOpcodes.T_TEXT);
        if (p instanceof Boolean) return VBPTypeCodec.inputEnvelope(VBPOpcodes.T_BOOL, VBPTypeCodec.encodeBool((Boolean) p));
        if (p instanceof Integer) return VBPTypeCodec.inputEnvelope(VBPOpcodes.T_INT4, VBPTypeCodec.encodeInt4((Integer) p));
        if (p instanceof Long) return VBPTypeCodec.inputEnvelope(VBPOpcodes.T_INT8, VBPTypeCodec.encodeInt8((Long) p));
        if (p instanceof Short) return VBPTypeCodec.inputEnvelope(VBPOpcodes.T_INT2, VBPTypeCodec.encodeInt2((Short) p));
        if (p instanceof Float) return VBPTypeCodec.inputEnvelope(VBPOpcodes.T_FLOAT4, VBPTypeCodec.encodeFloat4((Float) p));
        if (p instanceof Double) return VBPTypeCodec.inputEnvelope(VBPOpcodes.T_FLOAT8, VBPTypeCodec.encodeFloat8((Double) p));
        if (p instanceof byte[]) return VBPTypeCodec.inputEnvelope(VBPOpcodes.T_BYTEA, VBPTypeCodec.encodeBytea((byte[]) p));
        return VBPTypeCodec.inputEnvelope(VBPOpcodes.T_TEXT, VBPTypeCodec.encodeText(p.toString()));
    }

    @Override
    public void close() {
        if (mux != null) {
            try {
                mux.call(VBPOpcodes.OP_CLOSE, new byte[0], 0, 2000);
            } catch (Exception ignored) {}
            mux.close();
        }
    }

    public int getServerVersion() { return serverVersion; }
    public int getServerCaps() { return serverCaps; }
    public long getSessionTokenLo() { return sessionTokenLo; }
    public long getSessionTokenHi() { return sessionTokenHi; }
}
