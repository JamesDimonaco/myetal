"""baseline schema

Revision ID: 0001
Revises:
Create Date: 2026-04-26 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("is_admin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
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
    )

    op.create_table(
        "auth_identities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "provider",
            sa.Enum("orcid", "google", "github", "password", name="auth_provider"),
            nullable=False,
        ),
        sa.Column("subject_id", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column(
            "linked_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("provider", "subject_id", name="uq_auth_provider_subject"),
    )
    op.create_index("ix_auth_identities_user_id", "auth_identities", ["user_id"])

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column(
            "issued_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "rotated_to_id",
            sa.Uuid(),
            sa.ForeignKey(
                "refresh_tokens.id", use_alter=True, name="fk_refresh_tokens_rotated_to"
            ),
            nullable=True,
        ),
        sa.Column("revoked", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_refresh_tokens_token_hash"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"])
    op.create_index("ix_refresh_tokens_family_id", "refresh_tokens", ["family_id"])

    op.create_table(
        "shares",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("short_code", sa.String(16), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "type",
            sa.Enum("paper", "collection", "poster", "grant", name="share_type"),
            server_default="paper",
            nullable=False,
        ),
        sa.Column("is_public", sa.Boolean(), server_default=sa.text("true"), nullable=False),
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
        sa.UniqueConstraint("short_code", name="uq_shares_short_code"),
    )
    op.create_index("ix_shares_owner_user_id", "shares", ["owner_user_id"])
    op.create_index("ix_shares_short_code", "shares", ["short_code"])

    op.create_table(
        "share_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "share_id",
            sa.Uuid(),
            sa.ForeignKey("shares.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("scholar_url", sa.String(2000), nullable=True),
        sa.Column("doi", sa.String(255), nullable=True),
        sa.Column("authors", sa.Text(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
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
    )
    op.create_index("ix_share_items_share_id", "share_items", ["share_id"])
    op.create_index("ix_share_items_doi", "share_items", ["doi"])

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


def downgrade() -> None:
    op.drop_table("share_favorites")
    op.drop_table("share_comments")
    op.drop_table("share_items")
    op.drop_table("shares")
    op.drop_table("refresh_tokens")
    op.drop_table("auth_identities")
    op.drop_table("users")
    sa.Enum(name="share_type").drop(op.get_bind(), checkfirst=False)
    sa.Enum(name="auth_provider").drop(op.get_bind(), checkfirst=False)
