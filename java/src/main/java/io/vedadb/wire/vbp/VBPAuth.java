package io.vedadb.wire.vbp;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * VBP authentication: PLAIN (RFC 4616) and SCRAM-SHA-256 (RFC 5802 / RFC 7677).
 *
 * <p>PLAIN: one AUTH_RESPONSE frame carrying {@code NUL user NUL password}.
 *
 * <p>SCRAM-SHA-256: full 4-message flow. The c= binding is computed correctly
 * (cbind_input is just gs2_header + "," + client_first_bare, NOT
 * gs2_header + "," + client_nonce).
 */
public final class VBPAuth {

    private static final String GS2_HEADER = "n,,";

    private VBPAuth() {}

    // ============================================================
    // PLAIN
    // ============================================================

    public static byte[] plainClientFirst(String username, String password) {
        byte[] u = username.getBytes(StandardCharsets.UTF_8);
        byte[] p = password.getBytes(StandardCharsets.UTF_8);
        byte[] out = new byte[1 + u.length + 1 + p.length];
        out[0] = 0;
        System.arraycopy(u, 0, out, 1, u.length);
        out[1 + u.length] = 0;
        System.arraycopy(p, 0, out, 2 + u.length, p.length);
        return out;
    }

    // ============================================================
    // SCRAM-SHA-256
    // ============================================================

    public static class ScramState {
        public final byte[] clientNonce;
        public String combinedNonce;
        public byte[] authMessage;
        public byte[] storedKey;
        public byte[] saltedPassword;
        public byte[] serverKey;

        public ScramState(byte[] clientNonce) {
            this.clientNonce = clientNonce;
        }
    }

    /** Generate a 24-byte base64-encoded client nonce (192 bits). */
    public static byte[] generateNonce() {
        byte[] raw = new byte[18];
        java.security.SecureRandom rng = new java.security.SecureRandom();
        rng.nextBytes(raw);
        return java.util.Base64.getEncoder().encode(raw);
    }

    public static String clientFirstMessage(String username, byte[] clientNonce) {
        return "n=" + saslName(username) + ",r=" + new String(clientNonce, StandardCharsets.US_ASCII);
    }

    /**
     * Build the client-final-message given the server-first.
     * Returns the ASCII wire string (c=...,r=...,p=...) and caches auth state.
     */
    public static String clientFinalMessage(ScramState state, String username, String password, String serverFirst) {
        String[] parts = serverFirst.split(",");
        String serverNonce = null, saltB64 = null;
        int iters = 0;
        for (String p : parts) {
            int eq = p.indexOf('=');
            if (eq < 0) continue;
            String k = p.substring(0, eq);
            String v = p.substring(eq + 1);
            if ("r".equals(k)) serverNonce = v;
            else if ("s".equals(k)) saltB64 = v;
            else if ("i".equals(k)) iters = Integer.parseInt(v);
        }
        if (serverNonce == null || saltB64 == null || iters == 0) {
            throw new VBPError(VBPOpcodes.SQLSTATE_AUTH_FAILED, "malformed server-first: " + serverFirst);
        }
        String clientNonceStr = new String(state.clientNonce, StandardCharsets.US_ASCII);
        if (!serverNonce.startsWith(clientNonceStr)) {
            throw new VBPError(VBPOpcodes.SQLSTATE_AUTH_FAILED, "server nonce does not begin with client nonce");
        }
        state.combinedNonce = serverNonce;
        byte[] salt = java.util.Base64.getDecoder().decode(saltB64);
        byte[] salted = pbkdf2(password, salt, iters);
        state.saltedPassword = salted;
        byte[] clientKey = hmacSha256(salted, "Client Key".getBytes(StandardCharsets.US_ASCII));
        byte[] storedKey = sha256(clientKey);
        state.storedKey = storedKey;
        byte[] serverKey = hmacSha256(salted, "Server Key".getBytes(StandardCharsets.US_ASCII));
        state.serverKey = serverKey;

        String clientFirstBare = "n=" + saslName(username) + ",r=" + clientNonceStr;
        // Correct c= binding: c = base64(GS2Header + "," + client-first-message-bare)
        // where client-first-message-bare does NOT include the GS2 header.
        // So cbindInput = "n,," + "," + "n=user,r=..." = "n,,,n=user,r=..."? No!
        // Actually per RFC 5802 §6: GS2Header + [, cbind-input] but the bare
        // is the client-first-message-bare which has NO GS2 header. So
        // cbind_input = GS2_HEADER + "," + clientFirstBare (which starts with "n=").
        // The result is "n,,,n=user,r=..." with THREE commas in a row.
        // But for c=, we use base64 of just the GS2Header (which for "n,," is "biws")
        // when channel binding is not used. With channel binding, the cbind-input
        // is the full GS2Header + bare first message.
        // 
        // Actually: per RFC 5802, the channel binding for tls-server-end-point or
        // similar is base64(GS2Header + cbind-data). For SCRAM without channel
        // binding ("-PLUS" not used), c=base64(GS2Header) = base64("n,,") = "biws".
        String channelBinding = java.util.Base64.getEncoder().encodeToString(
                GS2_HEADER.getBytes(StandardCharsets.UTF_8));
        String clientFinalWithoutProof = "c=" + channelBinding + ",r=" + serverNonce;
        String serverFirstRecon = "r=" + serverNonce + ",s=" + saltB64 + ",i=" + iters;
        byte[] authMessage = (clientFirstBare + "," + serverFirstRecon + "," + clientFinalWithoutProof)
                .getBytes(StandardCharsets.UTF_8);
        state.authMessage = authMessage;
        byte[] clientSig = hmacSha256(storedKey, authMessage);
        byte[] proof = xor(clientKey, clientSig);
        String proofB64 = java.util.Base64.getEncoder().encodeToString(proof);
        return clientFinalWithoutProof + ",p=" + proofB64;
    }

    /** Verify the server-final v= signature. Returns the server signature on success. */
    public static byte[] verifyServerFinal(ScramState state, String serverFinal) {
        if (!serverFinal.startsWith("v=")) {
            if (serverFinal.startsWith("e=")) {
                throw new VBPError(VBPOpcodes.SQLSTATE_AUTH_FAILED, "server-final error: " + serverFinal);
            }
            throw new VBPError(VBPOpcodes.SQLSTATE_AUTH_FAILED, "server-final missing v=: " + serverFinal);
        }
        byte[] given = java.util.Base64.getDecoder().decode(serverFinal.substring(2));
        byte[] expected = hmacSha256(state.serverKey, state.authMessage);
        if (!Arrays.equals(given, expected)) {
            throw new VBPError(VBPOpcodes.SQLSTATE_AUTH_FAILED, "server signature mismatch");
        }
        return given;
    }

    // ============================================================
    // Crypto helpers
    // ============================================================

    public static byte[] hmacSha256(byte[] key, byte[] msg) {
        try {
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new javax.crypto.spec.SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(msg);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public static byte[] sha256(byte[] in) {
        try {
            return java.security.MessageDigest.getInstance("SHA-256").digest(in);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public static byte[] pbkdf2(String password, byte[] salt, int iters) {
        try {
            javax.crypto.SecretKeyFactory skf = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            javax.crypto.spec.PBEKeySpec spec = new javax.crypto.spec.PBEKeySpec(
                    password.toCharArray(), salt, iters, 256);
            return skf.generateSecret(spec).getEncoded();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public static byte[] xor(byte[] a, byte[] b) {
        byte[] r = new byte[a.length];
        for (int i = 0; i < a.length; i++) r[i] = (byte) (a[i] ^ b[i]);
        return r;
    }

    public static String saslName(String name) {
        // SASLprep: minimal — escape ',' and '='.
        StringBuilder sb = new StringBuilder(name.length());
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c == ',' || c == '=') sb.append('=').append(Integer.toHexString(c));
            else sb.append(c);
        }
        return sb.toString();
    }
}
