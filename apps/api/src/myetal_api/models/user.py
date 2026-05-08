"""Backward-compat shim — the canonical ``User`` lives in ``better_auth``.

Phase 1 of the Better Auth migration replaced the standalone ``users``
table with Better Auth's ``user`` table. The SQLAlchemy model now lives
in ``myetal_api.models.better_auth`` alongside the other BA tables.

This module re-exports ``User`` so existing call-sites and the legacy
``auth_identity`` / ``refresh_token`` models (which Phase 2 deletes)
keep importing from ``myetal_api.models.user`` without churn.
"""

from myetal_api.models.better_auth import User

__all__ = ["User"]
