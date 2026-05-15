"""Tests for ``core/security.py``.

After the Better Auth cutover this module shrunk to a single helper
(``generate_short_code``) — the password / JWT / refresh-token
helpers are gone. JWT verification has its own focused suite at
``tests/core/test_ba_security.py``.
"""

from __future__ import annotations

from myetal_api.core.security import generate_short_code


def test_short_code_format() -> None:
    code = generate_short_code()
    assert len(code) == 6
    assert "0" not in code and "O" not in code  # no confusable glyphs
    assert "1" not in code and "l" not in code and "I" not in code


def test_short_code_length_arg() -> None:
    assert len(generate_short_code(length=10)) == 10


def test_short_codes_are_unique_with_high_probability() -> None:
    """Loose smoke test — two consecutive 6-char codes must not collide."""
    a = generate_short_code()
    b = generate_short_code()
    assert a != b
