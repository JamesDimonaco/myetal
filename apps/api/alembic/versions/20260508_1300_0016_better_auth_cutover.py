"""better auth cutover — fresh-start, single revision

Revision ID: 0016
Revises: 0015
Create Date: 2026-05-08 13:00:00.000000

Phase 1 of the Better Auth migration. **Destructive**: truncates every
table that FKs to ``users.id``, drops ``auth_identities`` and
``refresh_tokens`` (replaced by Better Auth's ``account`` and
``session`` tables), then alters ``users`` into Better Auth's expected
shape and creates the four new BA tables (``session``, ``account``,
``verification``, ``jwks``).

The destruction is by design — see the ticket for the fresh-start
rationale (no real users yet, the cost of dual-mode dwarfs the cost of
re-sign-up). The ``downgrade`` recreates the dropped tables empty;
restoring data is out of scope (the rollback story is "redeploy old
code, accept testers re-sign-up again").

Things to know before applying:
* ``is_admin`` is reset to ``false`` for everyone post-cutover (the
  ``users`` row itself is truncated). Re-grant via the admin allowlist
  is documented in ``DEPLOY.md``.
* The ``auth_provider`` enum type is also dropped along with
  ``auth_identities`` — BA uses string ``provider_id`` instead.
* The ``users`` table name is intentionally kept (not renamed to
  ``user``). Better Auth is configured with ``modelName: 'users'`` so
  every existing FK ``REFERENCES users(id)`` keeps working without
  CASCADE rewrites.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Truncate everything downstream of users.id, plus users itself.
    #    feedback.user_id has no FK (column-only Uuid) — done explicitly so
    #    we don't leave orphan UUIDs pointing at a dead user row.
    op.execute("TRUNCATE TABLE feedback")
    op.execute(
        "TRUNCATE TABLE "
        "share_reports, share_views, share_papers, user_papers, "
        "orcid_sync_runs, share_items, shares, "
        "refresh_tokens, auth_identities, users "
        "RESTART IDENTITY CASCADE"
    )

    # 2. Drop legacy auth-only tables. Better Auth replaces both:
    #    auth_identities -> account, refresh_tokens -> session.
    op.drop_index("ix_refresh_tokens_family_id", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_token_hash", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")

    op.drop_index("ix_auth_identities_user_id", table_name="auth_identities")
    op.drop_table("auth_identities")
    # Drop the orphaned PG enum type now that no column uses it.
    op.execute("DROP TYPE IF EXISTS auth_provider")

    # 3. Alter users to Better Auth's expected shape.
    #    Existing columns (id, name, email, is_admin, avatar_url, orcid_id,
    #    last_orcid_sync_at, created_at, updated_at) match BA's snake_case
    #    mapping already. We add the two BA-required columns we don't have:
    op.add_column(
        "users",
        sa.Column(
            "email_verified",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column("image", sa.String(2000), nullable=True),
    )
    # BA expects email to be unique. The legacy schema allowed nulls and
    # dups. After truncation the table is empty so the unique constraint
    # is safe to add.
    op.create_unique_constraint("uq_users_email", "users", ["email"])

    # 4. Create Better Auth tables.
    #    Naming follows BA's defaults (singular table names) for everything
    #    except `users`. Column names use BA's snake_case mapping (see
    #    apps/web/src/lib/auth.ts and apps/web/src/lib/db-schema.ts).
    op.create_table(
        "session",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
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
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("token", name="uq_session_token"),
    )
    op.create_index("ix_session_user_id", "session", ["user_id"])

    op.create_table(
        "account",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("account_id", sa.String(255), nullable=False),
        sa.Column("provider_id", sa.String(64), nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("id_token", sa.Text(), nullable=True),
        sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refresh_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scope", sa.Text(), nullable=True),
        sa.Column("password", sa.Text(), nullable=True),
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
    op.create_index("ix_account_user_id", "account", ["user_id"])
    op.create_index(
        "ix_account_provider_account",
        "account",
        ["provider_id", "account_id"],
        unique=True,
    )

    op.create_table(
        "verification",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("identifier", sa.String(320), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
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
    op.create_index("ix_verification_identifier", "verification", ["identifier"])

    op.create_table(
        "jwks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("private_key", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Reverse the schema; data is NOT restored.

    Use case: rollback the cutover deploy. The legacy auth code in the
    pre-0016 image still works against the recreated empty tables, but
    every test user has to sign up again (their accounts were truncated
    in step 1 of upgrade()). This matches the rollback story we
    accepted in the ticket.
    """
    op.drop_table("jwks")
    op.drop_index("ix_verification_identifier", table_name="verification")
    op.drop_table("verification")
    op.drop_index("ix_account_provider_account", table_name="account")
    op.drop_index("ix_account_user_id", table_name="account")
    op.drop_table("account")
    op.drop_index("ix_session_user_id", table_name="session")
    op.drop_table("session")

    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_column("users", "image")
    op.drop_column("users", "email_verified")

    # Recreate auth_identities (empty). The pre-0016 model expects this
    # exact shape. We let SQLAlchemy create the auth_provider PG enum
    # automatically as a side-effect of the column type — no explicit
    # ``.create()`` call (which would emit a duplicate ``CREATE TYPE``).
    auth_provider = sa.Enum("orcid", "google", "github", "password", name="auth_provider")
    op.create_table(
        "auth_identities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", auth_provider, nullable=False),
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

    # Recreate refresh_tokens (empty).
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
            sa.ForeignKey("refresh_tokens.id", use_alter=True, name="fk_refresh_tokens_rotated_to"),
            nullable=True,
        ),
        sa.Column("revoked", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_refresh_tokens_token_hash"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"])
    op.create_index("ix_refresh_tokens_family_id", "refresh_tokens", ["family_id"])
