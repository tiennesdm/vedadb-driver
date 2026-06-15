"""Tests for the vbp.wire.auth module — PLAIN body and SCRAM-SHA-256 client."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import sys
import unittest

# Make sure we can import the vedadb package from the repo root.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from vedadb.wire.vbp.auth import (  # noqa: E402
    SCRAMClient,
    VBPAuthError,
    plain_client_first,
)


class TestPLAINBody(unittest.TestCase):
    def test_plain_format(self):
        body = plain_client_first("admin", "secret")
        # SASL PLAIN: [authzid] NUL authcid NUL password.  v1 uses no authzid.
        self.assertEqual(body, b"\x00admin\x00secret")

    def test_plain_unicode(self):
        body = plain_client_first("user", "héllo")
        self.assertEqual(body, b"\x00user\x00h\xc3\xa9llo")


class TestSCRAMClientNonce(unittest.TestCase):
    def test_client_nonce_is_ascii_printable(self):
        scram = SCRAMClient("admin", "TestPassword123!")
        cn = scram.client_nonce
        # Base64 alphabet is ASCII-printable.
        for ch in cn:
            self.assertTrue(ch.isascii(), f"non-ASCII char in client nonce: {ch!r}")
            self.assertLessEqual(ord(ch), 0x7F, f"non-printable char in client nonce: {ch!r}")

    def test_client_first_message(self):
        scram = SCRAMClient("admin", "TestPassword123!")
        msg = scram.client_first()
        self.assertTrue(msg.startswith("n=admin,r="))
        self.assertEqual(msg.split(",r=")[1], scram.client_nonce)


class TestSCRAMClientFirstBare(unittest.TestCase):
    def test_username_saslname_escaping(self):
        scram = SCRAMClient("user=name", "pw")
        msg = scram.client_first()
        # "=" should be escaped as "=3D".
        self.assertIn("n=user=3Dname", msg)


class TestSCRAMClientFinal(unittest.TestCase):
    def test_client_final_message(self):
        scram = SCRAMClient("admin", "TestPassword123!")
        cf = scram.client_first()
        # Hand-rolled server-first for deterministic testing.
        salt = os.urandom(16)
        salt_b64 = base64.b64encode(salt).decode("ascii")
        iters = 4096
        # Combine nonces: client_nonce + server_nonce.
        server_nonce = "ABCDEFGH"  # ascii, valid
        combined_nonce = scram.client_nonce + server_nonce
        server_first = f"r={combined_nonce},s={salt_b64},i={iters}"

        final = scram.client_final_message(server_first)
        # Format: c=<base64-cbind>,r=<combined>,p=<base64-proof>
        parts = final.split(",")
        self.assertEqual(len(parts), 3)
        self.assertTrue(parts[0].startswith("c="))
        self.assertTrue(parts[1].startswith("r="))
        self.assertEqual(parts[1], f"r={combined_nonce}")
        self.assertTrue(parts[2].startswith("p="))

    def test_client_final_wrong_nonce_prefix_rejected(self):
        scram = SCRAMClient("admin", "pw")
        # Server-first where the nonce doesn't start with the client nonce.
        # This signals a MITM.
        scram.client_first()
        with self.assertRaises(VBPAuthError) as cm:
            scram.client_final_message("r=NOT_CLIENT,s=" + base64.b64encode(b"\x00" * 16).decode() + ",i=4096")
        self.assertIn("MITM", cm.exception.message)

    def test_client_final_bad_iter_rejected(self):
        scram = SCRAMClient("admin", "pw")
        cn = scram.client_nonce
        with self.assertRaises(VBPAuthError):
            scram.client_final_message(f"r={cn}xx,s={base64.b64encode(b'x' * 16).decode()},i=NOTANUMBER")


class TestSCRAMServerSignatureVerify(unittest.TestCase):
    """Verify the server signature is computed correctly per RFC 5802."""

    def test_signature_round_trip(self):
        # Build a SCRAMClient and a fake server that computes the
        # expected server signature independently.
        scram = SCRAMClient("admin", "TestPassword123!", simplified=False)
        cf = scram.client_first()
        cn = scram.client_nonce
        salt = b"1234567890123456"  # 16 bytes
        salt_b64 = base64.b64encode(salt).decode("ascii")
        iters = 4096
        server_nonce = "SRVNONCE"
        combined = cn + server_nonce
        server_first = f"r={combined},s={salt_b64},i={iters}"

        # Force cache of salt+iters before computing final.
        scram._salt_b64 = salt_b64
        scram._iters = iters

        # Build the client-final message.
        final = scram.client_final_message(server_first)

        # Independently compute the expected server signature.
        salted_password = hashlib.pbkdf2_hmac(
            "sha256", b"TestPassword123!", salt, iters
        )
        server_key = hmac.new(salted_password, b"Server Key", hashlib.sha256).digest()
        # Extract p= from final.
        p_part = final.rsplit(",p=", 1)[1]
        client_proof = base64.b64decode(p_part)
        # Re-derive stored_key and client_key from client_proof.
        client_key = hmac.new(salted_password, b"Client Key", hashlib.sha256).digest()
        stored_key = hashlib.sha256(client_key).digest()
        client_signature = hmac.new(stored_key, scram.auth_message, hashlib.sha256).digest()
        # client_proof = client_key XOR client_signature
        self.assertEqual(
            client_proof,
            bytes(a ^ b for a, b in zip(client_key, client_signature)),
        )
        # server_signature = HMAC(server_key, auth_message)
        expected_server_sig = hmac.new(server_key, scram.auth_message, hashlib.sha256).digest()
        server_final = f"v={base64.b64encode(expected_server_sig).decode('ascii')}"
        # This should verify.
        scram.verify_server_final(server_final)

    def test_signature_mismatch_rejected(self):
        scram = SCRAMClient("admin", "TestPassword123!", simplified=False)
        cn = scram.client_nonce
        salt = b"1234567890123456"
        salt_b64 = base64.b64encode(salt).decode("ascii")
        iters = 4096
        combined = cn + "SRV"
        scram.client_first()
        scram.client_final_message(f"r={combined},s={salt_b64},i={iters}")
        scram._salt_b64 = salt_b64
        scram._iters = iters
        # A bogus server signature.
        bogus = base64.b64encode(b"x" * 32).decode("ascii")
        with self.assertRaises(VBPAuthError) as cm:
            scram.verify_server_final(f"v={bogus}")
        self.assertIn("MITM", cm.exception.message)

    def test_signature_wrong_prefix_rejected(self):
        scram = SCRAMClient("admin", "pw")
        cn = scram.client_nonce
        salt_b64 = base64.b64encode(b"x" * 16).decode("ascii")
        iters = 4096
        combined = cn + "SRV"
        scram.client_first()
        scram.client_final_message(f"r={combined},s={salt_b64},i={iters}")
        scram._salt_b64 = salt_b64
        scram._iters = iters
        # Server-final with 'e=' (error) prefix.
        with self.assertRaises(VBPAuthError):
            scram.verify_server_final("e=invalid-server-signature")


if __name__ == "__main__":
    unittest.main()
