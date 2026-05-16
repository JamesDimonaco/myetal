"""Admin-audit write helper — single entry point for the audit table.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 2. Every
write action under `/admin/*` calls :func:`record_action` in the same
transaction as the underlying business-side mutation, so an audit row
+ the change either both land or neither does.

The function does NOT commit on its own. Callers commit the audit row
together with the business change; that way a downstream failure (e.g.
the FK target's row is gone) rolls back the audit row too.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import AdminAudit


async def record_action(
    db: AsyncSession,
    *,
    admin_user_id: uuid.UUID,
    action: str,
    target_user_id: uuid.UUID | None = None,
    target_share_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> AdminAudit:
    """Stage an :class:`AdminAudit` row inside the caller's transaction.

    The caller is responsible for the surrounding ``db.commit()`` (or
    rollback). This split is intentional: the audit row + the
    underlying business change must commit as a unit. If we committed
    inside the helper, a downstream failure on the business change
    would leave an orphan audit entry claiming an action happened.

    ``action`` is a short string identifying the action (e.g.
    ``"force_sign_out"``). The vocabulary is open-ended on purpose —
    Stage 3 adds share-targeted actions, Stage 4 adds operational ones,
    and we don't want an Alembic round-trip for each new label.

    ``details`` is a small JSON-serialisable dict. Keep it bounded —
    rate-limit info, before/after for toggles, a free-form ``reason``
    when applicable. Avoid storing PII that's already on the linked row
    (no point duplicating the target's email if ``target_user_id`` is
    already set).
    """
    row = AdminAudit(
        admin_user_id=admin_user_id,
        action=action,
        target_user_id=target_user_id,
        target_share_id=target_share_id,
        details=details,
    )
    db.add(row)
    # Flush, not commit — the row gets an `id` we can return, but the
    # transaction stays open for the caller to commit alongside the
    # business change.
    await db.flush()
    return row
