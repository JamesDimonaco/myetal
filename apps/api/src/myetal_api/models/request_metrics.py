"""Per-minute request/error aggregate, populated by ``RequestMetricsMiddleware``.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 4.

Each row aggregates one minute of traffic for one route prefix. The
middleware buckets in memory (per-process) and flushes to the DB once
per minute. A unique index on (bucket_start, route_prefix) makes the
flush idempotent under process restart — a second flush of the same
bucket UPSERTs additively.

Retention strategy (managed by a separate cron, NOT in v1):
* Keep per-minute rows for 7 days.
* Roll up to daily rows after that.
* Drop after 30 days.

This model is operational telemetry, not audit. Loss on restart is
acceptable — the ticket explicitly notes "tolerate restart loss." For
durable audit see ``admin_audit``.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from myetal_api.models.base import Base


class RequestMetric(Base):
    __tablename__ = "request_metrics"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    bucket_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    route_prefix: Mapped[str] = mapped_column(String(64), nullable=False)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 5xx-only — 4xx is client error and would drown the signal.
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Sum of request-latency in ms over the bucket. Reserved for a future
    # p50/p95 surface; not exposed in v1.
    latency_ms_sum: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    __table_args__ = (
        Index("ix_request_metrics_bucket_start", "bucket_start"),
        # Idempotent flush — re-flushing the same bucket UPSERTs additively.
        Index(
            "ix_request_metrics_bucket_prefix",
            "bucket_start",
            "route_prefix",
            unique=True,
        ),
    )
