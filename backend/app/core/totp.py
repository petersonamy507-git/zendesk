"""Minimal RFC 6238 TOTP (30s, 6 digits, SHA1) for optional multi-factor authentication."""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    off = digest[-1] & 0x0F
    val = (struct.unpack(">I", digest[off : off + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{val:06d}"


def now_code(secret: str) -> str:
    return _code(secret, int(time.time()) // 30)


def verify(secret: str, code: str, window: int = 1) -> bool:
    c = int(time.time()) // 30
    return any(hmac.compare_digest(_code(secret, c + d), code.strip()) for d in range(-window, window + 1))


def provisioning_uri(secret: str, email: str, issuer: str) -> str:
    return f"otpauth://totp/{quote(issuer)}:{quote(email)}?secret={secret}&issuer={quote(issuer)}"
