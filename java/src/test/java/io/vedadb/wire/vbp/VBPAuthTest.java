package io.vedadb.wire.vbp;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class VBPAuthTest {

    @Test
    void plainClientFirst() {
        byte[] b = VBPAuth.plainClientFirst("admin", "secret");
        // NUL + admin + NUL + secret
        assertEquals(1 + 5 + 1 + 6, b.length);
        assertEquals(0, b[0]);
        assertEquals('a', b[1]);
        assertEquals(0, b[6]);
        assertEquals('s', b[7]);
    }

    @Test
    void generateNonceLength() {
        byte[] n = VBPAuth.generateNonce();
        // 18 raw bytes -> 24 base64 chars
        assertEquals(24, n.length);
    }

    @Test
    void clientFirstMessage() {
        byte[] nonce = "abcd1234".getBytes();
        String m = VBPAuth.clientFirstMessage("user", nonce);
        assertEquals("n=user,r=abcd1234", m);
    }

    @Test
    void saslNameEscapes() {
        // Integer.toHexString returns lowercase hex.
        assertEquals("a=2cb=3d", VBPAuth.saslName("a,b="));
    }

    @Test
    void saslNameNoEscapes() {
        assertEquals("admin", VBPAuth.saslName("admin"));
    }

    @Test
    void hmacSha256() {
        // Known RFC 4231 test case for "Hi There" / 0x0b*20
        byte[] key = new byte[20];
        java.util.Arrays.fill(key, (byte) 0x0b);
        byte[] msg = "Hi There".getBytes();
        byte[] mac = VBPAuth.hmacSha256(key, msg);
        // HMAC-SHA256("Hi There", 0x0b*20) = b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7
        byte[] expected = TestUtil.hexFromString("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
        assertArrayEquals(expected, mac);
    }

    @Test
    void pbkdf2KnownVector() {
        // Python hashlib.pbkdf2_hmac('sha256', b'passwd', b'salt', 1, 32) =
        // 55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc
        byte[] salt = "salt".getBytes();
        byte[] d = VBPAuth.pbkdf2("passwd", salt, 1);
        assertEquals(32, d.length);
        byte[] expected = TestUtil.hexFromString(
            "55ac046e56e3089fec1691c22544b605" +
            "f94185216dde0465e68b9d57c20dacbc");
        assertArrayEquals(expected, d);
    }

    @Test
    void xorSimple() {
        byte[] a = {0x01, 0x02, 0x03};
        byte[] b = {0x04, 0x05, 0x06};
        byte[] r = VBPAuth.xor(a, b);
        assertArrayEquals(new byte[]{0x05, 0x07, 0x05}, r);
    }

    @Test
    void sha256OfEmpty() {
        byte[] d = VBPAuth.sha256(new byte[0]);
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        byte[] expected = TestUtil.hexFromString("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assertArrayEquals(expected, d);
    }

    @Test
    void scramClientFirstMessageFormat() {
        byte[] nonce = "abc".getBytes();
        String s = VBPAuth.clientFirstMessage("user", nonce);
        assertTrue(s.startsWith("n=user,r=abc"));
    }

    @Test
    void scramCBindInputIsGs2HeaderPlusBare() {
        // Per RFC 5802, cbind_input = GS2Header + "," + client-first-message-bare
        // and client-first-bare = n=user,r=nonce
        // So cbind_input = "n,,n=user,r=nonce"
        String username = "user";
        byte[] nonce = "nonce".getBytes();
        String firstBare = "n=" + VBPAuth.saslName(username) + ",r=" + new String(nonce, java.nio.charset.StandardCharsets.US_ASCII);
        String cbindInput = "n,," + "," + firstBare;
        assertEquals("n,,,n=user,r=nonce", cbindInput);
    }

    @Test
    void scramFullFlowProducesValidProof() {
        // Known SCRAM-SHA-256 test vector (RFC 7677 §3):
        // username: user, password: pencil
        // salt: W22ZaJ0SNY7soEsUEjb6gQ== base64
        // iterations: 4096
        // client-first: n,,n=user,r=rOprNGfwEbeRWgbNEkqO
        // server-first: r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096
        // client-final: c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=
        // server-final: v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=
        VBPAuth.ScramState state = new VBPAuth.ScramState("rOprNGfwEbeRWgbNEkqO".getBytes());
        String serverFirst = "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096";
        String clientFinal = VBPAuth.clientFinalMessage(state, "user", "pencil", serverFirst);
        // Extract p= value
        int pIdx = clientFinal.indexOf("p=");
        assertTrue(pIdx > 0);
        String proof = clientFinal.substring(pIdx + 2);
        // Expected: dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=
        assertEquals("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", proof);
    }

    @Test
    void scramServerSignatureMatches() {
        VBPAuth.ScramState state = new VBPAuth.ScramState("rOprNGfwEbeRWgbNEkqO".getBytes());
        String serverFirst = "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096";
        VBPAuth.clientFinalMessage(state, "user", "pencil", serverFirst);
        byte[] sig = VBPAuth.verifyServerFinal(state, "v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
        assertEquals(32, sig.length);
    }

    @Test
    void scramServerSignatureMismatchThrows() {
        VBPAuth.ScramState state = new VBPAuth.ScramState("rOprNGfwEbeRWgbNEkqO".getBytes());
        String serverFirst = "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096";
        VBPAuth.clientFinalMessage(state, "user", "pencil", serverFirst);
        assertThrows(VBPError.class,
                () -> VBPAuth.verifyServerFinal(state, "v=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));
    }
}
