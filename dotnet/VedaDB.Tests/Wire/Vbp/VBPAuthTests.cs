// VedaDB .NET SDK — VBP wire layer tests
using System;
using System.Text;
using Xunit;
using VedaDB.Wire.Vbp;

namespace VedaDB.Tests.Wire.Vbp
{
    public class VBPAuthTests
    {
        [Fact]
        public void PlainClientFirst_Shape()
        {
            var b = VBPAuth.PlainClientFirst("admin", "secret");
            Assert.Equal(1 + 5 + 1 + 6, b.Length);
            Assert.Equal(0, b[0]);
            Assert.Equal((byte)'a', b[1]);
            Assert.Equal(0, b[6]);
            Assert.Equal((byte)'s', b[7]);
        }

        [Fact]
        public void PlainClientFirst_EmptyPassword()
        {
            var b = VBPAuth.PlainClientFirst("admin", "");
            Assert.Equal(1 + 5 + 1, b.Length);
        }

        [Fact]
        public void GenerateNonce_Length_AndUnique()
        {
            var a = VBPAuth.GenerateNonce();
            var c = VBPAuth.GenerateNonce();
            Assert.Equal(24, a.Length);
            Assert.NotEqual(a, c);
        }

        [Fact]
        public void SaslName_EscapesCommas()
        {
            Assert.Equal("user=2C", VBPAuth.SaslName("user,"));
        }

        [Fact]
        public void SaslName_EscapesEquals()
        {
            Assert.Equal("u=3D", VBPAuth.SaslName("u="));
        }

        [Fact]
        public void SaslName_PlainPasses()
        {
            Assert.Equal("admin", VBPAuth.SaslName("admin"));
        }

        [Fact]
        public void ClientFirstMessage_Format()
        {
            var n = Encoding.ASCII.GetBytes("FAKECLIENTNONCE12345");
            var m = VBPAuth.ClientFirstMessage("user", n);
            Assert.Equal("n=user,r=FAKECLIENTNONCE12345", m);
        }

        [Fact]
        public void HmacSha256_Stable()
        {
            var key = Encoding.ASCII.GetBytes("key");
            var msg = Encoding.ASCII.GetBytes("The quick brown fox jumps over the lazy dog");
            var h1 = VBPAuth.HmacSha256(key, msg);
            var h2 = VBPAuth.HmacSha256(key, msg);
            Assert.Equal(h1, h2);
            Assert.Equal(32, h1.Length);
        }

        [Fact]
        public void Sha256_Stable()
        {
            var h1 = VBPAuth.Sha256(Encoding.ASCII.GetBytes("abc"));
            var h2 = VBPAuth.Sha256(Encoding.ASCII.GetBytes("abc"));
            Assert.Equal(h1, h2);
        }

        [Fact]
        public void Pbkdf2_Deterministic()
        {
            var a = VBPAuth.Pbkdf2("password", new byte[] { 1, 2, 3, 4 }, 4096);
            var b = VBPAuth.Pbkdf2("password", new byte[] { 1, 2, 3, 4 }, 4096);
            Assert.Equal(a, b);
            Assert.Equal(32, a.Length);
        }

        [Fact]
        public void Pbkdf2_DifferentSaltDifferentOutput()
        {
            var a = VBPAuth.Pbkdf2("password", new byte[] { 1, 2, 3, 4 }, 4096);
            var b = VBPAuth.Pbkdf2("password", new byte[] { 5, 6, 7, 8 }, 4096);
            Assert.NotEqual(a, b);
        }

        [Fact]
        public void Xor_Identity()
        {
            var a = new byte[] { 1, 2, 3, 4, 5 };
            var zeros = new byte[] { 0, 0, 0, 0, 0 };
            Assert.Equal(a, VBPAuth.Xor(a, zeros));
        }

        [Fact]
        public void Xor_Involutory()
        {
            var a = new byte[] { 0xAA, 0xBB, 0xCC };
            var b = new byte[] { 0x55, 0x33, 0x99 };
            var r1 = VBPAuth.Xor(a, b);
            var r2 = VBPAuth.Xor(r1, b);
            Assert.Equal(a, r2);
        }

        [Fact]
        public void ClientFinalMessage_RoundtripsAuthMessage()
        {
            // Setup SCRAM state, build client-final, check c= is base64("n,,") = "biws"
            var state = new VBPAuth.ScramState(Encoding.ASCII.GetBytes("FAKECLIENTNONCE12345"));
            var serverFirst = "r=FAKECLIENTNONCE12345FROMSERVER,s=c2FsdA==,i=4096";
            var final = VBPAuth.ClientFinalMessage(state, "user", "pencil", serverFirst);
            Assert.Contains("c=biws,", final); // CRITICAL: c= must be "biws" not "n,,"
            Assert.Contains("r=FAKECLIENTNONCE12345FROMSERVER", final);
            Assert.Contains("p=", final);
            Assert.NotEmpty(state.AuthMessage);
            Assert.NotEmpty(state.SaltedPassword);
        }

        [Fact]
        public void VerifyServerFinal_RejectsMissingV()
        {
            var state = new VBPAuth.ScramState(Encoding.ASCII.GetBytes("FAKENONCE"));
            Assert.Throws<VBPErrorException>(() => VBPAuth.VerifyServerFinal(state, "e=invalid"));
        }

        [Fact]
        public void VerifyServerFinal_RejectsBadSignature()
        {
            var state = new VBPAuth.ScramState(Encoding.ASCII.GetBytes("FAKENONCE"));
            state.ServerKey = new byte[32];
            state.AuthMessage = Encoding.ASCII.GetBytes("test");
            var wrongSig = new byte[32];
            var b64Wrong = Convert.ToBase64String(wrongSig);
            Assert.Throws<VBPErrorException>(() => VBPAuth.VerifyServerFinal(state, "v=" + b64Wrong));
        }

        [Fact]
        public void VerifyServerFinal_AcceptsValidSignature()
        {
            var state = new VBPAuth.ScramState(Encoding.ASCII.GetBytes("FAKENONCE"));
            state.ServerKey = new byte[32];
            state.AuthMessage = Encoding.ASCII.GetBytes("test");
            var expected = VBPAuth.HmacSha256(state.ServerKey, state.AuthMessage);
            var b64 = Convert.ToBase64String(expected);
            var got = VBPAuth.VerifyServerFinal(state, "v=" + b64);
            Assert.Equal(expected, got);
        }
    }
}
