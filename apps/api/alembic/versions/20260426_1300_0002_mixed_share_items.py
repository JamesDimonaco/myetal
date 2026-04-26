"""mixed-kind share items

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-26 13:00:00.000000

Adds:
  - new enum item_kind ('paper', 'repo', 'link')
  - share_items.kind, share_items.url, share_items.subtitle, share_items.image_url
  - share_type enum gains a 'project' value

Production safety:
  - Existing share_items rows take server_default 'paper' for kind. Postgres
    fills the new column with the constant default in-place without a table
    rewrite (PG 11+ optimisation for non-volatile defaults). url/subtitle/
    image_url are NULLable with no default — also no rewrite. The only locks
    held are ACCESS EXCLUSIVE on share_items for the column-add itself, which
    is metadata-only and effectively instant on a populated table.
  - ALTER TYPE share_type ADD VALUE 'project' is metadata-only (no row scan).
    It cannot run inside a transaction block, so it is wrapped in an alembic
    autocommit_block.

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. New enum type for item kind.
    item_kind = sa.Enum("paper", "repo", "link", name="item_kind")
    item_kind.create(op.get_bind(), checkfirst=True)

    # 2. New columns on share_items. kind has a server_default so existing
    #    rows backfill to 'paper' without a rewrite.
    op.add_column(
        "share_items",
        sa.Column(
            "kind",
            sa.Enum("paper", "repo", "link", name="item_kind", create_type=False),
            server_default="paper",
            nullable=False,
        ),
    )
    op.add_column("share_items", sa.Column("url", sa.String(2000), nullable=True))
    op.add_column("share_items", sa.Column("subtitle", sa.String(500), nullable=True))
    op.add_column("share_items", sa.Column("image_url", sa.String(2000), nullable=True))

    # 3. Extend share_type enum with 'project'. ALTER TYPE ... ADD VALUE must
    #    run outside a transaction on Postgres.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE share_type ADD VALUE IF NOT EXISTS 'project'")


def downgrade() -> None:
    op.drop_column("share_items", "image_url")
    op.drop_column("share_items", "subtitle")
    op.drop_column("share_items", "url")
    op.drop_column("share_items", "kind")
    sa.Enum(name="item_kind").drop(op.get_bind(), checkfirst=True)
    # Note: Postgres has no ALTER TYPE ... DROP VALUE. The 'project' value
    # remains in share_type after downgrade. Any rows using it would need to
    # be migrated by the operator before downgrading.
