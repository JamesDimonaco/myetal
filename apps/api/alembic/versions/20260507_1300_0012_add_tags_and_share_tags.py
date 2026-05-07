"""add tags and share_tags tables, seed curated starter tags

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-07 13:00:00.000000

Per feedback-round-2 §2 (Q7-A join table; Q8-A lowercased + trimmed
canonicalisation; Q9-C hybrid curated + free-form; Q10 max 5 tags
per share).

Schema:
* ``tags`` — id UUID PK, slug VARCHAR(50) UNIQUE NOT NULL,
  label VARCHAR(80) NOT NULL, usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now().
* ``share_tags`` — composite PK (share_id, tag_id) with cascade-delete
  on both sides so:
    - deleting a share removes its tag attachments;
    - deleting a tag (rare; admin-only later) removes attachments but
      not the share itself.

Indexes:
* ``idx_tags_slug_trgm`` — pg_trgm GIN index on slug for fast
  autocomplete (typed "vir" → matches "virology").
* ``idx_tags_usage_count_desc`` — composite (usage_count DESC, slug)
  for the home/discover top-N tag-chip row.
* ``idx_share_tags_tag_id`` — reverse lookup for "shares with tag X"
  on the browse filter path.

Seed: ~30 curated starter tags so the autocomplete dropdown is useful
on day one. Owner can override / extend the list later — the seed only
runs when the table is created.

pgcrypto (for ``gen_random_uuid()``) was enabled in 0001; pg_trgm is
re-enabled here defensively (no-op if 0007 already created it).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


SEED_TAGS: list[tuple[str, str]] = [
    ("microbiology", "Microbiology"),
    ("virology", "Virology"),
    ("immunology", "Immunology"),
    ("genetics", "Genetics"),
    ("genomics", "Genomics"),
    ("microbiome", "Microbiome"),
    ("bioinformatics", "Bioinformatics"),
    ("structural-biology", "Structural Biology"),
    ("biochemistry", "Biochemistry"),
    ("cell-biology", "Cell Biology"),
    ("neuroscience", "Neuroscience"),
    ("ecology", "Ecology"),
    ("evolution", "Evolution"),
    ("epidemiology", "Epidemiology"),
    ("public-health", "Public Health"),
    ("clinical-medicine", "Clinical Medicine"),
    ("oncology", "Oncology"),
    ("machine-learning", "Machine Learning"),
    ("data-science", "Data Science"),
    ("statistics", "Statistics"),
    ("computer-science", "Computer Science"),
    ("software-engineering", "Software Engineering"),
    ("ai-ethics", "AI Ethics"),
    ("nlp", "NLP"),
    ("physics", "Physics"),
    ("chemistry", "Chemistry"),
    ("climate", "Climate"),
    ("sustainability", "Sustainability"),
    ("psychology", "Psychology"),
    ("policy", "Policy"),
]


def upgrade() -> None:
    op.execute("""
        CREATE TABLE tags (
            id UUID PRIMARY KEY,
            slug VARCHAR(50) UNIQUE NOT NULL,
            label VARCHAR(80) NOT NULL,
            usage_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    # pg_trgm should already be enabled (0007) but be defensive.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE INDEX idx_tags_slug_trgm ON tags USING gin (slug gin_trgm_ops)")
    op.execute("CREATE INDEX idx_tags_usage_count_desc ON tags (usage_count DESC, slug)")

    op.execute("""
        CREATE TABLE share_tags (
            share_id UUID NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
            tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (share_id, tag_id)
        )
    """)
    op.execute("CREATE INDEX idx_share_tags_tag_id ON share_tags (tag_id)")

    # Seed the curated starter list. We use sa.text() with bound
    # parameters rather than f-string interpolation so the ruff S608
    # SQL-injection lint stays happy (the seed list is hardcoded above
    # so there's no real injection risk, but bound params are the right
    # idiom regardless).
    import sqlalchemy as sa

    for slug, label in SEED_TAGS:
        op.execute(
            sa.text(
                "INSERT INTO tags (id, slug, label) VALUES (gen_random_uuid(), :slug, :label)"
            ).bindparams(slug=slug, label=label)
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS share_tags")
    op.execute("DROP TABLE IF EXISTS tags")
    # Don't drop pg_trgm — other code (search) uses it.
