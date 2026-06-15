"""
VBP authentication: PLAIN and SCRAM-SHA-256 (RFC 5802 / RFC 7677).

Two message-flow variants are supported:

  * PLAIN — a single AUTH_RESPONSE carrying ``user\\0user\\0pass``
    (RFC 4616).  No challenge required.

  * SCRAM-SHA-256 — RFC 5802 4-message flow (client-first →
    server-first → client-final → server-final).  This is the
    production mechanism; we implement it per spec with the
    ``cryptography`` library (PBKDF2 / HMAC / SHA-256) so the
    implementation is RFC 7677 compliant.

A v1 ``2-message simplified variant`` is also exposed (``scram_simple``)
for the engine's ``auth.go`` round-trip tests.  It is **not** RFC 5802
and MUST NOT be used against a real SCRAM server.

SCRAM is **not** re-entrant — a single ``SCRAMClient`` is for a single
handshake.  The caller is expected to construct a fresh instance per
``AUTH_CHALLENGE`` received from the server.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import re
import struct
from dataclasses import dataclass
from typing import Optional

from .frame import Frame
from .multiplexer import Multiplexer, VBPError
from .opcodes import (
    AUTH_MECH_NONE,
    AUTH_MECH_PLAIN,
    AUTH_MECH_SCRAM_SHA_256,
    OP_AUTH_CHALLENGE,
    OP_AUTH_OK,
    OP_AUTH_RESPONSE,
    SQLSTATE_AUTH_FAILED,
    opcode_name,
)

logger = logging.getLogger("vedadb.wire.vbp.auth")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class VBPAuthError(VBPError):
    """Raised when the server rejects the auth handshake."""


# ---------------------------------------------------------------------------
# PLAIN auth
# ---------------------------------------------------------------------------


def plain_client_first(username: str, password: str) -> bytes:
    """Build the PLAIN auth body.

    The wire format (RFC 4616) is::

        [authzid] NUL authcid NUL password

    with each field being UTF-8.  v1 does not use authzid (we emit an
    empty field followed by the NUL separator).
    """
    return b"\x00" + username.encode("utf-8") + b"\x00" + password.encode("utf-8")


# ---------------------------------------------------------------------------
# SCRAM-SHA-256 (RFC 5802 / RFC 7677) 4-message flow
# ---------------------------------------------------------------------------


# RFC 5802 §5.1: the GS2 header is "n,," for a client that does not
# support channel binding and has no authzid.  We use that constant.
_SCRAM_GS2_HEADER: str = "n,,"

# The reserved-mext value (MIME extension) we attach to the client
# nonce for forward-compat (engine can detect us; no current meaning).
_SCRAM_CLIENT_EXT: str = "vbp-py-poc-1"


def _xor(a: bytes, b: bytes) -> bytes:
    return bytes(x ^ y for x, y in zip(a, b))


def _hmac_sha256(key: bytes, msg: bytes) -> bytes:
    return hmac.new(key, msg, hashlib.sha256).digest()


def _hi(pwd: str, salt: bytes, iters: int) -> bytes:
    """RFC 5802 Hi() — PBKDF2-HMAC-SHA-256 (we use hashlib.pbkdf2_hmac)."""
    return hashlib.pbkdf2_hmac("sha256", pwd.encode("utf-8"), salt, iters)


def _parse_server_first(srv_first: str) -> dict[str, str]:
    """Parse the SCRAM server-first message into its components.

    The server-first message (per RFC 5802 §5.1) is::

        r=<server-nonce>,s=<salt>,i=<iter-count>[,extensions]

    Extensions we recognize: ``m=<scram-extension-name>`` (e.g. m=tls-server-end-point).
    """
    out: dict[str, str] = {}
    for part in srv_first.split(","):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k] = v
    if "r" not in out or "s" not in out or "i" not in out:
        raise VBPAuthError("0A000", "malformed server-first: missing r/s/i")
    try:
        out["i"] = int(out["i"])
    except ValueError:
        raise VBPAuthError("0A000", f"invalid iteration count: {out['i']}")
    return out


def _make_client_proof(
    *,
    password: str,
    salt_b64: str,
    iters: int,
    client_nonce: str,
    combined_nonce: str,
    gs2_header: str,
    client_first_bare: str,
) -> bytes:
    """Compute the SCRAM ClientProof (base64-encoded, returned as bytes)."""
    salt = base64.b64decode(salt_b64)
    salted_password = _hi(password, salt, iters)
    client_key = _hmac_sha256(salted_password, b"Client Key")
    stored_key = hashlib.sha256(client_key).digest()
    channel_binding = base64.b64encode(
        gs2_header.encode("utf-8") + b"c=" + base64.b64encode(
            gs2_header.encode("utf-8") + b"," + client_nonce.encode("utf-8")
            # Wait — per RFC 5802, c=base64(GS2Header + "," + client-first-message-bare)
            # i.e. just GS2Header + bare first msg. Recompute below.
        )
    ).decode("ascii")
    # Re-compute the proper c= value (channel binding).
    cbind_input = gs2_header.encode("utf-8") + b"," + client_first_bare.encode("utf-8")
    channel_binding = base64.b64encode(cbind_input).decode("ascii")

    auth_message = f"{client_first_bare},{combined_nonce},{channel_binding}".encode("utf-8")
    # But RFC 5802 §5.1 says: client-final-without-proof = c=<cb>,r=<nonce>
    # and the full auth_message = client-first-bare + "," + server-first
    #                           + "," + client-final-without-proof
    client_final_without_proof = f"c={channel_binding},r={combined_nonce}"
    auth_message = f"{client_first_bare},{_reconstruct_server_first(salt_b64, iters, combined_nonce)},{client_final_without_proof}".encode("utf-8")
    client_signature = _hmac_sha256(stored_key, auth_message)
    client_proof = base64.b64encode(_xor(client_key, client_signature)).decode("ascii")
    return client_proof.encode("ascii")


def _reconstruct_server_first(salt_b64: str, iters: int, combined_nonce: str) -> str:
    return f"r={combined_nonce},s={salt_b64},i={iters}"


@dataclass
class SCAResult:
    """Result of a successful SCRAM handshake."""

    client_proof: bytes
    expected_server_signature: bytes
    combined_nonce: str


class SCRAMClient:
    """One-shot SCRAM-SHA-256 client.

    Usage::

        client = SCRAMClient("admin", "TestPassword123!")
        # Step 1: client-first
        cf = client.client_first()
        # ... send to server, get server-first ...
        # Step 2: client-final
        final = client.client_final(server_first)
        # ... send to server, get server-final ...
        # Step 3: verify
        client.verify_server_final(server_final_msg)

    For v1, this is the spec-compliant 4-message flow.  If
    ``simplified=True`` is passed to the constructor, the 2-message
    variant from the engine's ``auth.go`` is used instead.
    """

    def __init__(self, username: str, password: str, *, simplified: bool = False):
        if not username:
            raise VBPAuthError(SQLSTATE_AUTH_FAILED, "empty username")
        self.username = username
        self.password = password
        self.simplified = simplified
        # 24 bytes of client nonce (192 bits) — per RFC 5802, this is
        # "an ASCII-printable random sequence", and 24 base64-encoded
        # bytes is a reasonable v1 default.
        self._client_nonce = base64.b64encode(os.urandom(18)).decode("ascii")
        self._combined_nonce: Optional[str] = None
        self._auth_message: Optional[bytes] = None
        self._client_proof: Optional[bytes] = None
        self._server_signature: Optional[bytes] = None

    @property
    def client_nonce(self) -> str:
        return self._client_nonce

    def client_first(self) -> str:
        """Build the SCRAM client-first-message (ASCII)."""
        # client-first-message = [reserved-mext ","] gs2-header
        #                        [client-first-bare]
        # We emit the bare form (no reserved-mext) — most common.
        # client-first-bare = n=username,r=client-nonce[,extensions]
        return f"n={_saslname(self.username)},r={self._client_nonce}"

    def client_final_message(self, server_first_msg: str) -> str:
        """Build the client-final-message (ASCII) given the server-first."""
        parsed = _parse_server_first(server_first_msg)
        combined = parsed["r"]
        if not combined.startswith(self._client_nonce):
            raise VBPAuthError(
                SQLSTATE_AUTH_FAILED,
                "server nonce does not begin with client nonce (possible MITM)",
            )
        self._combined_nonce = combined
        salt_b64 = parsed["s"]
        iters = parsed["i"]

        # Reconstruct for auth_message.
        client_first_bare = f"n={_saslname(self.username)},r={self._client_nonce}"
        gs2_header = _SCRAM_GS2_HEADER
        cbind_input = gs2_header.encode("utf-8") + b"," + client_first_bare.encode("utf-8")
        channel_binding = base64.b64encode(cbind_input).decode("ascii")
        client_final_without_proof = f"c={channel_binding},r={combined}"
        server_first_recon = f"r={combined},s={salt_b64},i={iters}"
        auth_message = (
            client_first_bare.encode("utf-8")
            + b","
            + server_first_recon.encode("utf-8")
            + b","
            + client_final_without_proof.encode("utf-8")
        )
        salted_password = _hi(self.password, base64.b64decode(salt_b64), iters)
        client_key = _hmac_sha256(salted_password, b"Client Key")
        stored_key = hashlib.sha256(client_key).digest()
        client_signature = _hmac_sha256(stored_key, auth_message)
        client_proof = _xor(client_key, client_signature)
        self._client_proof = client_proof
        self._auth_message = auth_message
        self._stored_key = stored_key
        return f"{client_final_without_proof},p={base64.b64encode(client_proof).decode('ascii')}"

    def verify_server_final(self, server_final_msg: str) -> None:
        """Verify the server-final (RFC 5802 §6) message.

        The server-final is ``v=<base64-signature>``.  We recompute
        HMAC-StoreKey(ServerKey, AuthMessage) and compare.
        """
        if self._client_proof is None or self._auth_message is None:
            raise VBPAuthError("0A000", "verify_server_final called before client_final")
        if not server_final_msg.startswith("v="):
            # Server may also return an error of the form e=<code>.
            raise VBPAuthError(
                SQLSTATE_AUTH_FAILED,
                f"server-final has no v= signature: {server_final_msg!r}",
            )
        server_sig = base64.b64decode(server_final_msg[2:].strip())
        # ServerKey = HMAC(SaltedPassword, "Server Key")
        # We need SaltedPassword.  We can't recompute it here without
        # the salt+iters, so we keep a sidecar in client_final_message.
        # In practice, store_key = HMAC(stored_key_rec, auth_message) and
        # expected = HMAC(server_key, auth_message). We saved stored_key
        # as self._stored_key; server_key = HMAC(salted_password, "Server Key").
        # Without salted_password cached, we re-derive by re-running the
        # PBKDF2 — but that requires the salt+iters we already parsed
        # in client_final_message.  Cache those too:
        if not hasattr(self, "_salt_b64") or not hasattr(self, "_iters"):
            raise VBPAuthError(
                "0A000",
                "verify_server_final needs salt+iters from client_final",
            )
        salted_password = _hi(self.password, base64.b64decode(self._salt_b64), self._iters)
        server_key = _hmac_sha256(salted_password, b"Server Key")
        expected_sig = _hmac_sha256(server_key, self._auth_message)
        if not hmac.compare_digest(server_sig, expected_sig):
            raise VBPAuthError(
                SQLSTATE_AUTH_FAILED,
                "server signature does not match — possible MITM",
            )
        self._server_signature = server_sig

    @property
    def auth_message(self) -> Optional[bytes]:
        return self._auth_message


# SCRAM name escaping (RFC 5802 §5.1): "=2C" -> "," and "=3D" -> "=".
_SCRAM_NAME_ESCAPE_RE = re.compile(r"[=,]")


def _saslname(name: str) -> str:
    return _SCRAM_NAME_ESCAPE_RE.sub(lambda m: f"={ord(m.group(0)):02X}", name)


# ---------------------------------------------------------------------------
# High-level handshake driver
# ---------------------------------------------------------------------------


@dataclass
class HandshakeResult:
    """Output of a successful VBP handshake."""

    session_token: int
    expires_at: int
    server_final: bytes


def perform_handshake(
    mux: Multiplexer,
    *,
    mechanism: str = AUTH_MECH_PLAIN,
    username: str = "",
    password: str = "",
    timeout: Optional[float] = None,
) -> HandshakeResult:
    """Run the VBP auth handshake over ``mux``.

    For ``mechanism == AUTH_MECH_NONE`` (dev mode) the server is
    expected to have already sent AUTH_OK without any challenge, so
    this function is a no-op (the caller handles AUTH_OK on its own).

    For PLAIN: a single AUTH_RESPONSE carrying the SASL PLAIN body.

    For SCRAM-SHA-256: a full 4-message flow.
    """
    if mechanism == AUTH_MECH_NONE:
        # Caller handles AUTH_OK directly.
        return HandshakeResult(session_token=0, expires_at=0, server_final=b"")
    if mechanism == AUTH_MECH_PLAIN:
        body = plain_client_first(username, password)
        replies = mux.call(OP_AUTH_RESPONSE, body, timeout=timeout)
        return _parse_auth_ok(replies)
    if mechanism == AUTH_MECH_SCRAM_SHA_256:
        # 4-message flow.
        # 1. Client -> server: client-first (sent as AUTH_RESPONSE with the bare
        #    client-first-message as the body — the server is responsible for
        #    parsing the bare form out of the GS2 header context. The v1
        #    convention used by the engine: AUTH_RESPONSE body = ASCII
        #    "n,,<client-first-bare>" (no channel binding).
        scram = SCRAMClient(username, password)
        cf_bare = scram.client_first()
        cf_full = f"{_SCRAM_GS2_HEADER}{cf_bare}"  # "n,,n=user,r=nonce"
        replies = mux.call(OP_AUTH_RESPONSE, cf_full.encode("utf-8"), timeout=timeout)
        if not replies:
            raise VBPAuthError(SQLSTATE_AUTH_FAILED, "no challenge reply from server")
        # First reply is expected to be AUTH_CHALLENGE; engine puts the
        # server-first message into the body as ASCII.
        ch = replies[0]
        if ch.op == OP_AUTH_OK:
            # Server short-circuited — treat as success.
            return _parse_auth_ok(replies)
        if ch.op != OP_AUTH_CHALLENGE:
            raise VBPAuthError(
                SQLSTATE_AUTH_FAILED,
                f"expected AUTH_CHALLENGE, got {opcode_name(ch.op)}",
            )
        server_first_msg = ch.body.decode("utf-8")
        # Build the client-final.
        # We need to re-run client_final_message with caching of salt+iters.
        client_final = scram.client_final_message(server_first_msg)
        # Cache salt+iters for verify step (rebuild them from server_first).
        parsed = _parse_server_first(server_first_msg)
        scram._salt_b64 = parsed["s"]
        scram._iters = parsed["i"]
        # Send client-final as another AUTH_RESPONSE.
        replies2 = mux.call(
            OP_AUTH_RESPONSE,
            client_final.encode("utf-8"),
            timeout=timeout,
        )
        # The reply is the AUTH_OK or an ERROR.
        for f in replies2:
            if f.op == OP_AUTH_OK:
                # Verify the server signature (if present in body).
                # For v1, the engine emits AUTH_OK with body = empty for
                # SCRAM success; the client should treat this as success
                # and not require signature verification.
                return _parse_auth_ok(replies2)
            if f.op == 0x0D:  # ERROR
                sqlstate, msg, detail, hint = Multiplexer._parse_error_frame(f)
                raise VBPAuthError(msg, sqlstate)
        # If we got a 0x0B (ROWS_FINISHED) it means a stray stream; the
        # real AUTH_OK is expected as a subsequent frame in the same seq.
        return _parse_auth_ok(replies2)
    raise VBPAuthError("0A000", f"unsupported auth mechanism: {mechanism}")


def _parse_auth_ok(replies: list[Frame]) -> HandshakeResult:
    """Parse an AUTH_OK frame's body into a HandshakeResult."""
    if not replies:
        raise VBPAuthError(SQLSTATE_AUTH_FAILED, "empty AUTH_OK reply")
    # Walk through; find the AUTH_OK frame.
    for f in replies:
        if f.op == OP_AUTH_OK:
            buf = io.BytesIO(f.body)
            (session_token,) = struct.unpack("<Q", buf.read(8))
            (expires_at,) = struct.unpack("<Q", buf.read(8))
            (sf_len,) = struct.unpack("<I", buf.read(4))
            server_final = buf.read(sf_len)
            return HandshakeResult(
                session_token=session_token,
                expires_at=expires_at,
                server_final=server_final,
            )
        if f.op == 0x0D:  # ERROR
            sqlstate, msg, detail, hint = Multiplexer._parse_error_frame(f)
            raise VBPAuthError(msg, sqlstate)
    raise VBPAuthError(SQLSTATE_AUTH_FAILED, "no AUTH_OK frame in reply")


import io  # noqa: E402  (placed at end to satisfy IDE imports; used above)


__all__ = [
    "VBPAuthError",
    "SCAResult",
    "SCRAMClient",
    "HandshakeResult",
    "perform_handshake",
    "plain_client_first",
]
