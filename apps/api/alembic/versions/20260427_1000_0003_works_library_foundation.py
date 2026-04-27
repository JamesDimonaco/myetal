"""works library foundation: papers, share_papers, user_papers, orcid_sync_runs

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-27 10:00:00.000000

Per `docs/tickets/works-library-and-orcid-sync.md`. Implements the schema
backbone for first-class global papers (audit S8 option A — no per-user
ownership), with reversible migration of existing `share_items` rows where
kind='paper'.

Key decisions baked in (see ticket sections in parens):
  - Papers are global, deduped on DOI (W-BL1).
  - share_papers PK is (share_id, paper_id) — within-share dedup enforced
    by the migration via lowest-position-wins (W-BL3); discarded rows are
    logged to stderr and remain available in the backup table.
  - subtitle and image_url preserved across migration onto the papers row
    (W-BL4); first-encountered values win for DOI-deduped papers.
  - Migration uses DOI-only exact dedup; non-DOI papers each get their
    own row. Fuzzy (lower(title), year) matching is reserved for ORCID
    sync where it can be reviewed (W-S2).
  - _migration_share_items_backup retains the original payloads with
    ON CONFLICT (id) DO NOTHING so partial-progress re-runs converge (W-S1).

Production safety:
  - Alembic wraps everything in one transaction; partial failures roll back.
  - The data loop is bounded by the size of share_items WHERE kind='paper';
    at this stage of the product (no real users) that's effectively empty,
    but the loop is structured to scale to a few thousand rows without
    pathological behaviour. For larger backfills, rewrite as a batched
    set-based migration with RETURNING.
  - Coordinate with the discovery ticket's social-models drop revision
    (which depends on `0003`); this revision must run first per
    works-ticket pre-reqs (W-s7).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Enum types are created idempotently via DO blocks below, then referenced
# by the table-creation calls with `create_type=False`. This avoids a known
# foot-gun: passing `sa.Enum("a", "b", name=...)` to `op.create_table` makes
# SQLAlchemy try to CREATE TYPE again (it sees a distinct instance from the
# one we called `.create()` on), which on retry-after-partial-failure fails
# with "type already exists." Using `postgresql.ENUM(..., create_type=False)`
# tells SQLAlchemy to assume the type exists and just reference it by name.
_PAPER_SOURCE = postgresql.ENUM(
    "orcid",
    "crossref",
    "openalex",
    "manual",
    name="paper_source",
    create_type=False,
)
_USER_PAPER_ADDED_VIA = postgresql.ENUM(
    "orcid",
    "manual",
    "share",
    name="user_paper_added_via",
    create_type=False,
)
_ORCID_SYNC_STATUS = postgresql.ENUM(
    "pending",
    "running",
    "completed",
    "failed",
    name="orcid_sync_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()

    # ----------- 1. Enum types (idempotent) -----------
    # `DO $$ ... EXCEPTION WHEN duplicate_object` makes these no-ops if the
    # type already exists from a previous half-run. Cheaper recovery than
    # forcing the operator to clean orphaned types by hand.
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE paper_source AS ENUM ('orcid', 'crossref', 'openalex', 'manual');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE user_paper_added_via AS ENUM ('orcid', 'manual', 'share');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE orcid_sync_status AS ENUM ('pending', 'running', 'completed', 'failed');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        """
    )

    # ----------- 2. papers -----------
    op.create_table(
        "papers",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("doi", sa.String(255), nullable=True),
        sa.Column("openalex_id", sa.String(64), nullable=True),
        sa.Column("orcid_put_code", sa.String(32), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("subtitle", sa.Text(), nullable=True),
        sa.Column("authors", sa.Text(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("venue", sa.String(500), nullable=True),
        sa.Column("abstract", sa.Text(), nullable=True),
        sa.Column("url", sa.String(2000), nullable=True),
        sa.Column("pdf_url", sa.String(2000), nullable=True),
        sa.Column("image_url", sa.String(2000), nullable=True),
        sa.Column(
            "source",
            _PAPER_SOURCE,
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
    )
    # Partial unique indexes for the identifier dedup (NULL-tolerant).
    op.create_index(
        "uq_papers_doi",
        "papers",
        ["doi"],
        unique=True,
        postgresql_where=sa.text("doi IS NOT NULL"),
    )
    op.create_index(
        "uq_papers_openalex_id",
        "papers",
        ["openalex_id"],
        unique=True,
        postgresql_where=sa.text("openalex_id IS NOT NULL"),
    )
    op.create_index(
        "ix_papers_orcid_put_code",
        "papers",
        ["orcid_put_code"],
        postgresql_where=sa.text("orcid_put_code IS NOT NULL"),
    )
    # Fuzzy dedup expression index — used only by ORCID sync, not the migration.
    op.execute("CREATE INDEX ix_papers_lower_title_year ON papers (lower(title), year)")

    # ----------- 3. share_papers -----------
    op.create_table(
        "share_papers",
        sa.Column("share_id", sa.Uuid(), nullable=False),
        sa.Column("paper_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("added_by", sa.Uuid(), nullable=True),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("share_id", "paper_id", name="pk_share_papers"),
        sa.ForeignKeyConstraint(
            ["share_id"], ["shares.id"], ondelete="CASCADE", name="fk_share_papers_share"
        ),
        sa.ForeignKeyConstraint(
            ["paper_id"], ["papers.id"], ondelete="RESTRICT", name="fk_share_papers_paper"
        ),
        sa.ForeignKeyConstraint(
            ["added_by"],
            ["users.id"],
            ondelete="SET NULL",
            name="fk_share_papers_added_by",
        ),
    )
    op.create_index("ix_share_papers_share_position", "share_papers", ["share_id", "position"])
    op.create_index("ix_share_papers_paper_id", "share_papers", ["paper_id"])

    # ----------- 4. user_papers -----------
    op.create_table(
        "user_papers",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("paper_id", sa.Uuid(), nullable=False),
        sa.Column(
            "added_via",
            _USER_PAPER_ADDED_VIA,
            nullable=False,
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("user_id", "paper_id", name="pk_user_papers"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_user_papers_user"
        ),
        sa.ForeignKeyConstraint(
            ["paper_id"], ["papers.id"], ondelete="RESTRICT", name="fk_user_papers_paper"
        ),
    )

    # ----------- 5. orcid_sync_runs -----------
    op.create_table(
        "orcid_sync_runs",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            _ORCID_SYNC_STATUS,
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("added", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unchanged", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_orcid_sync_runs_user"
        ),
    )
    op.create_index("ix_orcid_sync_runs_user_id", "orcid_sync_runs", ["user_id"])

    # ----------- 6. _migration_share_items_backup (reversibility) -----------
    op.create_table(
        "_migration_share_items_backup",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("share_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("subtitle", sa.String(500), nullable=True),
        sa.Column("url", sa.String(2000), nullable=True),
        sa.Column("image_url", sa.String(2000), nullable=True),
        sa.Column("scholar_url", sa.String(2000), nullable=True),
        sa.Column("doi", sa.String(255), nullable=True),
        sa.Column("authors", sa.Text(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    # ----------- 7. DATA MIGRATION -----------
    _migrate_paper_share_items(bind)


def _migrate_paper_share_items(bind: sa.engine.Connection) -> None:
    """Walk share_items WHERE kind='paper' → papers + share_papers + user_papers.

    Per W-S2: DOI-only dedup at migration time. Per W-BL3: within-share
    duplicate DOIs dropped, lowest position wins, discarded count logged.
    Per W-BL4: subtitle + image_url carried onto the new papers row.
    Per W-S1: backup INSERT is idempotent.
    """
    # Pull every paper-kind share_item with the owning user_id from its share.
    rows = (
        bind.execute(
            sa.text(
                """
            SELECT
                si.id, si.share_id, si.position, si.title, si.subtitle, si.doi,
                si.authors, si.year, si.url, si.image_url, si.scholar_url,
                si.notes, si.created_at, si.updated_at,
                s.owner_user_id
            FROM share_items si
            JOIN shares s ON s.id = si.share_id
            WHERE si.kind = 'paper'
            ORDER BY si.share_id, si.position, si.created_at
            """
            )
        )
        .mappings()
        .all()
    )

    if not rows:
        # Fresh database / no legacy data — nothing to migrate.
        return

    # Step 1: idempotent backup of every paper-kind share_item.
    for r in rows:
        bind.execute(
            sa.text(
                """
                INSERT INTO _migration_share_items_backup (
                    id, share_id, position, kind, title, subtitle, doi, authors,
                    year, url, image_url, scholar_url, notes, created_at, updated_at
                )
                VALUES (
                    :id, :share_id, :position, 'paper', :title, :subtitle, :doi, :authors,
                    :year, :url, :image_url, :scholar_url, :notes, :created_at, :updated_at
                )
                ON CONFLICT (id) DO NOTHING
                """
            ),
            {
                "id": r["id"],
                "share_id": r["share_id"],
                "position": r["position"],
                "title": r["title"],
                "subtitle": r["subtitle"],
                "doi": r["doi"],
                "authors": r["authors"],
                "year": r["year"],
                "url": r["url"],
                "image_url": r["image_url"],
                "scholar_url": r["scholar_url"],
                "notes": r["notes"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            },
        )

    # Step 2: walk per-share, dedup within share by normalised DOI (lowest
    # position wins), upsert paper, link via share_papers + user_papers.
    discarded: list[tuple[str, str, str]] = []  # (share_id, kept_id, dropped_id)
    deleted_share_item_ids: list[str] = []

    current_share_id = None
    seen_dois_in_share: dict[str, str] = {}  # normalised_doi -> kept share_item id

    for r in rows:
        share_id = r["share_id"]
        if share_id != current_share_id:
            current_share_id = share_id
            seen_dois_in_share = {}

        doi_normalised: str | None = None
        if r["doi"]:
            doi_normalised = r["doi"].strip().lower() or None

        # Within-share dedup: skip if we've already kept a row with this DOI
        if doi_normalised and doi_normalised in seen_dois_in_share:
            discarded.append((str(share_id), seen_dois_in_share[doi_normalised], str(r["id"])))
            deleted_share_item_ids.append(str(r["id"]))
            continue

        # Resolve or create the paper row.
        paper_id: str
        if doi_normalised:
            existing = bind.execute(
                sa.text("SELECT id FROM papers WHERE doi = :doi"),
                {"doi": doi_normalised},
            ).fetchone()
            if existing is not None:
                paper_id = existing[0]
            else:
                inserted = bind.execute(
                    sa.text(
                        """
                        INSERT INTO papers (
                            id, doi, title, subtitle, authors, year, url, image_url,
                            source, created_at, updated_at
                        )
                        VALUES (
                            gen_random_uuid(), :doi, :title, :subtitle, :authors, :year,
                            :url, :image_url, 'manual', :created_at, :updated_at
                        )
                        RETURNING id
                        """
                    ),
                    {
                        "doi": doi_normalised,
                        "title": r["title"],
                        "subtitle": r["subtitle"],
                        "authors": r["authors"],
                        "year": r["year"],
                        "url": r["url"],
                        "image_url": r["image_url"],
                        "created_at": r["created_at"],
                        "updated_at": r["updated_at"],
                    },
                ).fetchone()
                paper_id = inserted[0]
            seen_dois_in_share[doi_normalised] = str(r["id"])
        else:
            # Non-DOI: each row becomes its own paper (W-S2 — no fuzzy match here).
            inserted = bind.execute(
                sa.text(
                    """
                    INSERT INTO papers (
                        id, title, subtitle, authors, year, url, image_url,
                        source, created_at, updated_at
                    )
                    VALUES (
                        gen_random_uuid(), :title, :subtitle, :authors, :year,
                        :url, :image_url, 'manual', :created_at, :updated_at
                    )
                    RETURNING id
                    """
                ),
                {
                    "title": r["title"],
                    "subtitle": r["subtitle"],
                    "authors": r["authors"],
                    "year": r["year"],
                    "url": r["url"],
                    "image_url": r["image_url"],
                    "created_at": r["created_at"],
                    "updated_at": r["updated_at"],
                },
            ).fetchone()
            paper_id = inserted[0]

        # Link paper into the share. Composite PK + DO NOTHING handles the
        # rare race where this migration is re-run after a partial success.
        bind.execute(
            sa.text(
                """
                INSERT INTO share_papers (
                    share_id, paper_id, position, notes, added_by, added_at
                )
                VALUES (:share_id, :paper_id, :position, :notes, :added_by, :added_at)
                ON CONFLICT (share_id, paper_id) DO NOTHING
                """
            ),
            {
                "share_id": share_id,
                "paper_id": paper_id,
                "position": r["position"],
                "notes": r["notes"],
                "added_by": r["owner_user_id"],
                "added_at": r["created_at"],
            },
        )

        # Seed user_papers for the share owner (audit trail of how it landed there).
        bind.execute(
            sa.text(
                """
                INSERT INTO user_papers (user_id, paper_id, added_via, added_at)
                VALUES (:user_id, :paper_id, 'share', :added_at)
                ON CONFLICT (user_id, paper_id) DO NOTHING
                """
            ),
            {
                "user_id": r["owner_user_id"],
                "paper_id": paper_id,
                "added_at": r["created_at"],
            },
        )

        deleted_share_item_ids.append(str(r["id"]))

    # Step 3: delete migrated share_items rows.
    if deleted_share_item_ids:
        bind.execute(
            sa.text("DELETE FROM share_items WHERE id = ANY(CAST(:ids AS uuid[]))"),
            {"ids": deleted_share_item_ids},
        )

    if discarded:
        # Surface what we threw away — the backup retains everything regardless.
        import sys

        print(
            f"[migration 0003] within-share duplicate DOIs dropped: {len(discarded)} item(s)",
            file=sys.stderr,
        )
        for share_id_s, kept_id, dropped_id in discarded:
            print(
                f"  share={share_id_s} kept={kept_id} dropped={dropped_id}",
                file=sys.stderr,
            )


def downgrade() -> None:
    """Best-effort restoration from _migration_share_items_backup.

    Reinserts every backed-up row into share_items, then drops everything
    this migration created. Any share_papers rows added AFTER the migration
    (i.e. real new paper attachments) are lost — there's no way to express
    them as legacy share_items because the new model doesn't carry the
    embedded paper metadata. The downgrade only makes sense before the
    new tables have seen real writes.
    """
    bind = op.get_bind()

    # Restore migrated share_items rows from the backup.
    bind.execute(
        sa.text(
            """
            INSERT INTO share_items (
                id, share_id, position, kind, title, subtitle, url, image_url,
                scholar_url, doi, authors, year, notes, created_at, updated_at
            )
            SELECT
                id, share_id, position, kind::item_kind, title, subtitle, url,
                image_url, scholar_url, doi, authors, year, notes,
                created_at, updated_at
            FROM _migration_share_items_backup
            ON CONFLICT (id) DO NOTHING
            """
        )
    )

    # Drop the new tables in dependency order.
    op.drop_index("ix_orcid_sync_runs_user_id", table_name="orcid_sync_runs")
    op.drop_table("orcid_sync_runs")

    op.drop_table("user_papers")

    op.drop_index("ix_share_papers_paper_id", table_name="share_papers")
    op.drop_index("ix_share_papers_share_position", table_name="share_papers")
    op.drop_table("share_papers")

    op.execute("DROP INDEX IF EXISTS ix_papers_lower_title_year")
    op.drop_index("ix_papers_orcid_put_code", table_name="papers")
    op.drop_index("uq_papers_openalex_id", table_name="papers")
    op.drop_index("uq_papers_doi", table_name="papers")
    op.drop_table("papers")

    op.drop_table("_migration_share_items_backup")

    # Drop enums last (after all tables that reference them are gone).
    op.execute("DROP TYPE IF EXISTS orcid_sync_status")
    op.execute("DROP TYPE IF EXISTS user_paper_added_via")
    op.execute("DROP TYPE IF EXISTS paper_source")
