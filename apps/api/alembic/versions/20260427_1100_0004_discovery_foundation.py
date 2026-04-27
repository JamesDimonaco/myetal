"""discovery foundation: published_at + deleted_at + view tracking + reports

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-27 11:00:00.000000

Per `docs/tickets/public-discovery-and-collaboration.md`. Foundational schema
for the discovery surfaces: opt-in publication, tombstone deletes, view
tracking, similar-shares precompute, trending precompute, take-down/reporting.

Per D-BL1: this is a NEW migration that drops the vestigial social tables
(share_favorites, share_comments) created by `0001_baseline.py`. The baseline
itself stays untouched — editing it would either be ignored on prod (it's
already applied) or, on a fresh DB, would silently destroy data.

Per D-S-Iss10: no cookie column on share_views — anon dedup is a transient
in-memory bloom filter (no PII at rest, no cookie-consent exposure).

Per D-S-Iss7: view_token column on share_views for the mobile X-View-Token
header path (per-install opaque token from expo-secure-store).

Per D-S-Iss1: share_similar stores canonical-ordered pairs (a < b) with a
CHECK constraint and the read query unions both directions. Halves storage
and cron work.

Coordinate: this revision must run AFTER 0003 (works library) per W-s7 +
discovery-ticket pre-reqs. The chain is enforced by down_revision='0003'.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()

    # ----------- 1. Drop vestigial social tables (D13 + D-S-Iss4) -----------
    # share_favorites first then share_comments — neither has FK into the
    # other, but the order is consistent and makes the downgrade reversal
    # obvious.
    op.drop_table("share_favorites")
    op.drop_table("share_comments")

    # ----------- 2. Add published_at + deleted_at to shares (D1 + D14) -----
    op.add_column(
        "shares",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "shares",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_shares_deleted_at", "shares", ["deleted_at"])

    # ----------- 3. Enums for share_reports (D16) -----------
    share_report_reason = sa.Enum(
        "copyright", "spam", "abuse", "pii", "other", name="share_report_reason"
    )
    share_report_status = sa.Enum("open", "actioned", "dismissed", name="share_report_status")
    share_report_reason.create(bind, checkfirst=True)
    share_report_status.create(bind, checkfirst=True)

    # ----------- 4. share_views (D3 + D3.1 + D-S-Iss10 + D-S-Iss7 + D-S-Iss2) -
    op.create_table(
        "share_views",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("share_id", sa.Uuid(), nullable=False),
        sa.Column("viewer_user_id", sa.Uuid(), nullable=True),
        sa.Column("view_token", sa.String(64), nullable=True),
        sa.Column(
            "viewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["share_id"],
            ["shares.id"],
            ondelete="CASCADE",
            name="fk_share_views_share",
        ),
        sa.ForeignKeyConstraint(
            ["viewer_user_id"],
            ["users.id"],
            ondelete="SET NULL",
            name="fk_share_views_viewer",
        ),
        sa.CheckConstraint(
            "viewer_user_id IS NULL OR view_token IS NULL",
            name="chk_share_views_viewer_xor_token",
        ),
    )
    # Read pattern: views for one share, ordered by recency (analytics).
    op.create_index(
        "ix_share_views_share_id_viewed_at",
        "share_views",
        ["share_id", sa.text("viewed_at DESC")],
    )
    # Dedup: "did this token view this share recently".
    op.create_index(
        "ix_share_views_token_share",
        "share_views",
        ["view_token", "share_id"],
        postgresql_where=sa.text("view_token IS NOT NULL"),
    )
    # Dedup: "did this user view this share recently".
    op.create_index(
        "ix_share_views_user_share",
        "share_views",
        ["viewer_user_id", "share_id"],
        postgresql_where=sa.text("viewer_user_id IS NOT NULL"),
    )
    # D-S-Iss2: trending cron's no-share_id-predicate scan.
    op.create_index(
        "ix_share_views_viewed_at",
        "share_views",
        [sa.text("viewed_at DESC")],
    )

    # ----------- 5. share_similar (D9 + D-S-Iss1) -----------
    op.create_table(
        "share_similar",
        sa.Column("share_id_a", sa.Uuid(), nullable=False),
        sa.Column("share_id_b", sa.Uuid(), nullable=False),
        sa.Column("papers_in_common", sa.Integer(), nullable=False),
        sa.Column(
            "refreshed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("share_id_a", "share_id_b", name="pk_share_similar"),
        sa.ForeignKeyConstraint(
            ["share_id_a"],
            ["shares.id"],
            ondelete="CASCADE",
            name="fk_share_similar_a",
        ),
        sa.ForeignKeyConstraint(
            ["share_id_b"],
            ["shares.id"],
            ondelete="CASCADE",
            name="fk_share_similar_b",
        ),
        sa.CheckConstraint("share_id_a < share_id_b", name="chk_share_similar_canonical"),
    )
    op.create_index(
        "ix_share_similar_a_score",
        "share_similar",
        ["share_id_a", sa.text("papers_in_common DESC")],
    )
    op.create_index(
        "ix_share_similar_b_score",
        "share_similar",
        ["share_id_b", sa.text("papers_in_common DESC")],
    )

    # ----------- 6. trending_shares (D2) -----------
    op.create_table(
        "trending_shares",
        sa.Column("share_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("view_count_7d", sa.Integer(), nullable=False),
        sa.Column(
            "refreshed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["share_id"],
            ["shares.id"],
            ondelete="CASCADE",
            name="fk_trending_shares_share",
        ),
    )
    op.create_index(
        "ix_trending_shares_score",
        "trending_shares",
        [sa.text("score DESC")],
    )

    # ----------- 7. share_reports (D16 + D-S-Iss6) -----------
    op.create_table(
        "share_reports",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("share_id", sa.Uuid(), nullable=False),
        sa.Column("reporter_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "reason",
            sa.Enum(name="share_report_reason", create_type=False),
            nullable=False,
        ),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(name="share_report_status", create_type=False),
            nullable=False,
            server_default="open",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("actioned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actioned_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["share_id"],
            ["shares.id"],
            ondelete="CASCADE",
            name="fk_share_reports_share",
        ),
        sa.ForeignKeyConstraint(
            ["reporter_user_id"],
            ["users.id"],
            ondelete="SET NULL",
            name="fk_share_reports_reporter",
        ),
        sa.ForeignKeyConstraint(
            ["actioned_by"],
            ["users.id"],
            ondelete="SET NULL",
            name="fk_share_reports_actioner",
        ),
    )
    op.create_index(
        "ix_share_reports_status_created",
        "share_reports",
        ["status", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_share_reports_share_id",
        "share_reports",
        ["share_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    """Drops everything 0004 added and recreates the social tables.

    The recreated social tables are EMPTY — the original rows are gone.
    Downgrade only makes sense as a recovery from "I accidentally upgraded";
    it does not restore lost social data (which there wasn't any of).
    """
    bind = op.get_bind()

    # Drop new tables in dep order.
    op.drop_index("ix_share_reports_share_id", table_name="share_reports")
    op.drop_index("ix_share_reports_status_created", table_name="share_reports")
    op.drop_table("share_reports")

    op.drop_index("ix_trending_shares_score", table_name="trending_shares")
    op.drop_table("trending_shares")

    op.drop_index("ix_share_similar_b_score", table_name="share_similar")
    op.drop_index("ix_share_similar_a_score", table_name="share_similar")
    op.drop_table("share_similar")

    op.drop_index("ix_share_views_viewed_at", table_name="share_views")
    op.drop_index("ix_share_views_user_share", table_name="share_views")
    op.drop_index("ix_share_views_token_share", table_name="share_views")
    op.drop_index("ix_share_views_share_id_viewed_at", table_name="share_views")
    op.drop_table("share_views")

    sa.Enum(name="share_report_status").drop(bind, checkfirst=True)
    sa.Enum(name="share_report_reason").drop(bind, checkfirst=True)

    # Drop the share columns we added.
    op.drop_index("ix_shares_deleted_at", table_name="shares")
    op.drop_column("shares", "deleted_at")
    op.drop_column("shares", "published_at")

    # Recreate the social tables (EMPTY — there is no backup of the dropped data).
    # Schema mirrors the original definition in `0001_baseline.py`.
    op.create_table(
        "share_comments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "share_id",
            sa.Uuid(),
            sa.ForeignKey("shares.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_share_comments_share_id", "share_comments", ["share_id"])
    op.create_index("ix_share_comments_user_id", "share_comments", ["user_id"])

    op.create_table(
        "share_favorites",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "share_id",
            sa.Uuid(),
            sa.ForeignKey("shares.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("share_id", "user_id", name="uq_share_favorite"),
    )
    op.create_index("ix_share_favorites_share_id", "share_favorites", ["share_id"])
    op.create_index("ix_share_favorites_user_id", "share_favorites", ["user_id"])
