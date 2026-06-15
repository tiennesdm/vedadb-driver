// VedaDB .NET SDK — VBP wire layer
//
// VBP authentication: PLAIN (RFC 4616) and SCRAM-SHA-256 (RFC 5802 / RFC 7677).
//
// PLAIN: one AUTH_RESPONSE frame carrying NUL user NUL password.
//
// SCRAM-SHA-256: full 4-message flow. The c= binding is computed correctly:
// c= is base64(GS2Header) for the no-channel-binding case (the GS2Header is
// "n,," which is base64 "biws"). The cbind_input is just the GS2 header —
// NOT the GS2 header + "," + client_first_bare. (Earlier POC submissions
// had this bug; .NET must NOT repeat it.)

using System;
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace VedaDB.Wire.Vbp
{
    public static class VBPAuth
    {
        private const string Gs2Header = "n,,";

        // ============================================================
        // PLAIN (RFC 4616)
        // ============================================================

        /// <summary>Build PLAIN client-first message: NUL user NUL password (UTF-8).</summary>
        public static byte[] PlainClientFirst(string username, string password)
        {
            var u = Encoding.UTF8.GetBytes(username);
            var p = Encoding.UTF8.GetBytes(password);
            var outBuf = new byte[1 + u.Length + 1 + p.Length];
            outBuf[0] = 0;
            Buffer.BlockCopy(u, 0, outBuf, 1, u.Length);
            outBuf[1 + u.Length] = 0;
            Buffer.BlockCopy(p, 0, outBuf, 2 + u.Length, p.Length);
            return outBuf;
        }

        // ============================================================
        // SCRAM-SHA-256 (RFC 5802)
        // ============================================================

        public sealed class ScramState
        {
            public byte[] ClientNonce { get; }
            public string CombinedNonce { get; set; } = "";
            public byte[] AuthMessage { get; set; } = Array.Empty<byte>();
            public byte[] StoredKey { get; set; } = Array.Empty<byte>();
            public byte[] SaltedPassword { get; set; } = Array.Empty<byte>();
            public byte[] ServerKey { get; set; } = Array.Empty<byte>();
            public ScramState(byte[] clientNonce) { ClientNonce = clientNonce; }
        }

        /// <summary>Generate a 24-byte ASCII client nonce (192 bits).</summary>
        public static byte[] GenerateNonce()
        {
            var raw = new byte[18];
            using var rng = RandomNumberGenerator.Create();
            rng.GetBytes(raw);
            return Encoding.ASCII.GetBytes(Convert.ToBase64String(raw));
        }

        public static string ClientFirstMessage(string username, byte[] clientNonce)
        {
            return "n=" + SaslName(username) + ",r=" + Encoding.ASCII.GetString(clientNonce);
        }

        /// <summary>
        /// Build the client-final-message given the server-first.
        /// Returns the ASCII wire string (c=...,r=...,p=...) and caches auth state.
        /// </summary>
        public static string ClientFinalMessage(ScramState state, string username, string password, string serverFirst)
        {
            string? serverNonce = null;
            string? saltB64 = null;
            int iters = 0;
            foreach (var part in serverFirst.Split(','))
            {
                int eq = part.IndexOf('=');
                if (eq < 0) continue;
                var k = part.Substring(0, eq);
                var v = part.Substring(eq + 1);
                switch (k)
                {
                    case "r": serverNonce = v; break;
                    case "s": saltB64 = v; break;
                    case "i": iters = int.Parse(v); break;
                }
            }
            if (serverNonce == null || saltB64 == null || iters == 0)
                throw new VBPErrorException(VBPOpcodes.SqlStateAuthFailed, "malformed server-first: " + serverFirst);

            var clientNonceStr = Encoding.ASCII.GetString(state.ClientNonce);
            if (!serverNonce.StartsWith(clientNonceStr, StringComparison.Ordinal))
                throw new VBPErrorException(VBPOpcodes.SqlStateAuthFailed, "server nonce does not begin with client nonce");

            state.CombinedNonce = serverNonce;
            var salt = Convert.FromBase64String(saltB64);
            var salted = Pbkdf2(password, salt, iters);
            state.SaltedPassword = salted;
            var clientKey = HmacSha256(salted, Encoding.ASCII.GetBytes("Client Key"));
            var storedKey = Sha256(clientKey);
            state.StoredKey = storedKey;
            var serverKey = HmacSha256(salted, Encoding.ASCII.GetBytes("Server Key"));
            state.ServerKey = serverKey;

            var clientFirstBare = "n=" + SaslName(username) + ",r=" + clientNonceStr;
            // c= is base64(GS2Header) for the no-channel-binding case.
            var channelBinding = Convert.ToBase64String(Encoding.UTF8.GetBytes(Gs2Header));
            var clientFinalWithoutProof = "c=" + channelBinding + ",r=" + serverNonce;
            var serverFirstRecon = "r=" + serverNonce + ",s=" + saltB64 + ",i=" + iters;
            var authMessage = Encoding.UTF8.GetBytes(
                clientFirstBare + "," + serverFirstRecon + "," + clientFinalWithoutProof);
            state.AuthMessage = authMessage;
            var clientSig = HmacSha256(storedKey, authMessage);
            var proof = Xor(clientKey, clientSig);
            var proofB64 = Convert.ToBase64String(proof);
            return clientFinalWithoutProof + ",p=" + proofB64;
        }

        /// <summary>Verify the server-final v= signature. Returns the server signature on success.</summary>
        public static byte[] VerifyServerFinal(ScramState state, string serverFinal)
        {
            if (serverFinal.StartsWith("v=", StringComparison.Ordinal))
            {
                var given = Convert.FromBase64String(serverFinal.Substring(2));
                var expected = HmacSha256(state.ServerKey, state.AuthMessage);
                if (!ByteArrayEqual(given, expected))
                    throw new VBPErrorException(VBPOpcodes.SqlStateAuthFailed, "server signature mismatch");
                return given;
            }
            if (serverFinal.StartsWith("e=", StringComparison.Ordinal))
                throw new VBPErrorException(VBPOpcodes.SqlStateAuthFailed, "server-final error: " + serverFinal);
            throw new VBPErrorException(VBPOpcodes.SqlStateAuthFailed, "server-final missing v=: " + serverFinal);
        }

        // ============================================================
        // Crypto helpers
        // ============================================================

        public static byte[] HmacSha256(byte[] key, byte[] msg)
        {
            using var mac = new HMACSHA256(key);
            return mac.ComputeHash(msg);
        }

        public static byte[] Sha256(byte[] input)
        {
            using var sha = SHA256.Create();
            return sha.ComputeHash(input);
        }

        public static byte[] Pbkdf2(string password, byte[] salt, int iters)
        {
            using var pbkdf2 = new Rfc2898DeriveBytes(password, salt, iters, HashAlgorithmName.SHA256);
            return pbkdf2.GetBytes(32);
        }

        public static byte[] Xor(byte[] a, byte[] b)
        {
            var r = new byte[a.Length];
            for (int i = 0; i < a.Length; i++) r[i] = (byte)(a[i] ^ b[i]);
            return r;
        }

        public static string SaslName(string name)
        {
            // SASLprep: minimal — escape ',' and '='.
            var sb = new StringBuilder(name.Length);
            foreach (char c in name)
            {
                if (c == ',' || c == '=') sb.Append('=').Append(((int)c).ToString("X"));
                else sb.Append(c);
            }
            return sb.ToString();
        }

        private static bool ByteArrayEqual(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }
    }
}
