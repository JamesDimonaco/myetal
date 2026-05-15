"""Misc cryptographic helpers.

After the Better Auth cutover (Phase 2) this module shrunk to a single
helper — a URL-safe short-code generator used by the share-creation
flow. Auth-related helpers (password hashing, access-token JWT,
refresh-token rotation) all moved to Better Auth on the Next.js side
and the FastAPI verifier in ``core/ba_security.py``.
"""

from __future__ import annotations

import secrets

# ---------- short codes (for shares) ----------

_SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def generate_short_code(length: int = 6) -> str:
    """URL-safe short code with no easily-confused glyphs (no 0/O/1/l/I)."""
    return "".join(secrets.choice(_SHORT_CODE_ALPHABET) for _ in range(length))
