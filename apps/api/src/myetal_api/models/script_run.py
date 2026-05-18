"""Per-invocation row for cron-driven scripts.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 4.

Populated by the small wrapper in ``scripts/_wrapper.py``: any script
can wrap its main coroutine with ``run_script("name", coro)`` and a row
lands here at start (status="running") and is updated at finish
(status="ok" or "failed", with duration + row_count + optional error).

The Stage 1 overview already surfaces some "last run" timestamps from
the underlying tables (``trending_shares.refreshed_at`` etc.) — those
keep working. This table covers the gaps: scripts whose body doesn't
write a touchable column (e.g. ``gc_tombstoned_shares`` deletes rows
but writes no sentinel), and gives us last-run *duration* across the
board which the source tables don't carry.

Operational signal, not audit.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from myetal_api.models.base import Base


class ScriptRun(Base):
    __tablename__ = "script_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "ok" | "failed" | "running"
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        server_default="running",
    )
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        # Read pattern: "latest run of name X."
        Index("ix_script_runs_name_started", "name", "started_at"),
        # Read pattern: "most recent runs across all scripts."
        Index("ix_script_runs_started_at", "started_at"),
    )
