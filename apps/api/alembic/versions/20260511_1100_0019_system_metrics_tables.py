"""request_metrics + script_runs tables (Stage 4)

Revision ID: 0019
Revises: 0018
Create Date: 2026-05-11 11:00:00.000000

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 4.

Two small operational tables for the `/dashboard/admin/system` view:

* ``request_metrics`` — 1-minute aggregates populated by
  ``RequestMetricsMiddleware``. Roll-up to daily after 7 days happens
  in a separate cron (not in v1); drop after 30 days is also cron-time.
  Single-writer-per-process (the middleware flushes every minute) so a
  uniqueness constraint on (bucket_start, route_prefix) keeps duplicate
  flushes idempotent if the process restarts mid-flush.

* ``script_runs`` — one row per cron-script invocation, populated by
  the wrapper helper in ``scripts/_wrapper.py``. Records start, end,
  row_count, status. Surfaces "did the last refresh_trending run, and
  what happened" without sshing to the deploy host.

Both are operational hints rather than audit (request loss on restart
is acceptable per the ticket); kept narrow so the write path is cheap
and the read path indexes well on the columns the UI actually uses.

Indexes follow the read patterns:
* ``request_metrics``: "last 24h grouped by prefix" → ``(bucket_start)``.
* ``script_runs``: "last run per named script" → ``(name, started_at desc)``.

Additive-only — no destructive DDL on existing tables.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "request_metrics",
        sa.Column("id", sa.Uuid(), primary_key=True),
        # Start of the 1-minute bucket (UTC, truncated to the minute).
        sa.Column(
            "bucket_start",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        # Route prefix (e.g. "/admin", "/public", "/me"). The middleware
        # collapses the full path to its first segment; "/" maps to "/_root".
        sa.Column("route_prefix", sa.String(64), nullable=False),
        sa.Column("request_count", sa.Integer, nullable=False, default=0),
        # 5xx-only — 4xx is excluded (client error, noisy).
        sa.Column("error_count", sa.Integer, nullable=False, default=0),
        # Sum of request-latency in ms for the bucket. Reserved for a
        # future p50/p95 surface; not exposed in v1 (the ticket only asks
        # for rate + error rate). Column added now so the middleware
        # write path is stable across versions.
        sa.Column("latency_ms_sum", sa.BigInteger, nullable=False, default=0),
    )
    op.create_index(
        "ix_request_metrics_bucket_start",
        "request_metrics",
        ["bucket_start"],
    )
    op.create_index(
        "ix_request_metrics_bucket_prefix",
        "request_metrics",
        ["bucket_start", "route_prefix"],
        unique=True,
    )

    op.create_table(
        "script_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        # The script's short identifier — e.g. "refresh_trending",
        # "refresh_similar_shares". Free-form (no enum) so a new script
        # doesn't need a migration.
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer, nullable=True),
        # "ok" | "failed" | "running" — text rather than enum so we can
        # add new states cheaply.
        sa.Column("status", sa.String(16), nullable=False, server_default="running"),
        # Row-count returned by the script body, e.g. the number of rows
        # inserted by refresh_similar_shares. NULL when the script
        # doesn't have a meaningful count.
        sa.Column("row_count", sa.Integer, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
    )
    op.create_index(
        "ix_script_runs_name_started",
        "script_runs",
        ["name", "started_at"],
    )
    op.create_index(
        "ix_script_runs_started_at",
        "script_runs",
        ["started_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_script_runs_started_at", table_name="script_runs")
    op.drop_index("ix_script_runs_name_started", table_name="script_runs")
    op.drop_table("script_runs")
    op.drop_index(
        "ix_request_metrics_bucket_prefix", table_name="request_metrics"
    )
    op.drop_index("ix_request_metrics_bucket_start", table_name="request_metrics")
    op.drop_table("request_metrics")
