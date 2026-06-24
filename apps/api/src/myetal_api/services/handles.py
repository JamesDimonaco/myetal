"""Handle-domain helpers — claim, change, clear, resolve.

A handle is the human-readable researcher-page slug surfaced at
``/u/{handle}``. The UUID URL (``/u/{id}``) keeps resolving forever so
already-printed business cards never dead-end; the handle URL is just
the SEO-/memory-friendly alternative once the researcher claims one.

Rules (locked):
* Format: ``^[a-z][a-z0-9_-]{2,29}$`` — start with a letter, lowercase
  + digits + ``_`` + ``-``, length 3–30.
* No consecutive separators: ``__``, ``--``, ``_-``, ``-_`` are all
  rejected so handles stay legible.
* A short reserved list is kept inline (no extra table — easier to
  edit, no migration needed). Includes routes (``dashboard``, ``c``,
  ``u``, etc.), generic platform nouns (``admin``, ``api``,
  ``support``), and a couple of user-identity foot-guns (``me``,
  ``root``, ``system``).

The schema layer in ``schemas/user.py`` validates the format and
rejects reserved handles before this service is called; the service
itself only catches the uniqueness race (two PATCHes for the same
handle landing in the same instant) via the DB unique constraint.
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import User

# Format: starts with a letter, then lowercase letters / digits / _ / -,
# total length 3–30. Lowercase-only means a plain UNIQUE constraint is
# case-correct (no CITEXT, no LOWER() functional index needed).
HANDLE_RE = re.compile(r"^[a-z][a-z0-9_-]{2,29}$")

# Block consecutive separators so handles stay legible. The base regex
# allows e.g. ``dr__smith`` and ``ada-_bot`` — this trip-wire rejects
# them with the same 422 the format check uses.
_CONSECUTIVE_SEPS_RE = re.compile(r"[_-]{2,}")

# Reserved at the application layer (rather than a CHECK constraint or
# a seed table) so the list can be edited in code review without an
# Alembic migration. Categories:
#   * routes that already exist or are reserved for future use
#   * generic platform nouns we may want for marketing pages
#   * user-identity foot-guns (``me``, ``root``, ``system``)
RESERVED_HANDLES: frozenset[str] = frozenset(
    {
        "about",
        "admin",
        "api",
        "assets",
        "browse",
        "c",
        "dashboard",
        "demo",
        "help",
        "login",
        "logout",
        "me",
        "privacy",
        "profile",
        "public",
        "register",
        "root",
        "settings",
        "sign-in",
        "sign-out",
        "sign-up",
        "static",
        "support",
        "system",
        "terms",
        "u",
        "www",
    }
)


class InvalidHandle(Exception):
    """Format/length violation — schema layer should normally catch this."""


class ReservedHandle(Exception):
    """The submitted handle is on the platform reserved list."""


class HandleAlreadyTaken(Exception):
    """Another user already claims this handle."""


class UserNotFound(Exception):
    """The user_id passed to a service helper does not exist."""


def validate_handle_format(handle: str) -> None:
    """Raise :class:`InvalidHandle` if the format is wrong.

    Pure check — does no DB work. Called from the schema layer (so the
    422 fires before the route opens a transaction) and re-called from
    the service as a belt-and-braces guard.
    """
    if not isinstance(handle, str):  # type: ignore[unreachable]
        raise InvalidHandle("handle must be a string")
    if not HANDLE_RE.match(handle):
        raise InvalidHandle(
            "handle must be 3–30 chars, start with a letter, lowercase + digits + _ / - only",
        )
    if _CONSECUTIVE_SEPS_RE.search(handle):
        raise InvalidHandle("handle must not contain consecutive _ or - separators")


def is_reserved(handle: str) -> bool:
    return handle in RESERVED_HANDLES


async def set_user_handle(db: AsyncSession, user_id: uuid.UUID, handle: str) -> User:
    """Claim or change the calling user's handle.

    Format is assumed pre-validated by the schema layer; the validation
    is re-applied here as a defence-in-depth check. Raises
    :class:`HandleAlreadyTaken` if another user already claims this
    handle (precheck + IntegrityError catch for the race).
    """
    validate_handle_format(handle)
    if is_reserved(handle):
        raise ReservedHandle

    user = await db.get(User, user_id)
    if user is None:
        raise UserNotFound

    # Fast path for benign typos: precheck so the user gets a clean
    # 409 rather than a 500 buried in an integrity error. Two concurrent
    # PATCHes for the same handle still race past this check — the
    # unique index catches that case below.
    clash = await db.scalar(select(User.id).where(User.handle == handle, User.id != user_id))
    if clash is not None:
        raise HandleAlreadyTaken

    user.handle = handle
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HandleAlreadyTaken from exc
    return user


async def clear_user_handle(db: AsyncSession, user_id: uuid.UUID) -> User:
    """Drop the calling user's handle. Idempotent — clearing an unset
    handle is a no-op and still returns the user row."""
    user = await db.get(User, user_id)
    if user is None:
        raise UserNotFound
    user.handle = None
    await db.commit()
    return user


async def find_user_id_by_handle(db: AsyncSession, handle: str) -> uuid.UUID | None:
    """Resolve a handle to its owning user's id. None if no such handle.

    The handle parameter is lowercased before lookup so a request for
    ``/u/DrSmith`` resolves to the same user as ``/u/drsmith``. Beyond
    the lowercasing this is a strict exact-match lookup (no fuzziness).

    Soft-deleted users are NOT resolved — handle-based browse must not
    surface tombstoned accounts. The shared ``get_user_public_card``
    helper stays untouched (it's also used by ``/u/{id}`` and any other
    UUID-keyed lookup); the deleted-at filter lives on the
    handle-specific path only.
    """
    normalised = handle.strip().lower()
    if not normalised:
        return None
    return await db.scalar(
        select(User.id).where(
            User.handle == normalised,
            User.deleted_at.is_(None),
        )
    )
