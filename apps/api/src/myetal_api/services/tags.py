"""Tags service — canonicalisation, get-or-create, share<->tag attach,
autocomplete, and top-N popularity queries.

Per feedback-round-2 §2:
* Q8-A canonicalisation: lowercased + trimmed + spaces→hyphens only.
  No alias / synonym layer.
* Q9-C hybrid: free-form tags allowed; missing slugs auto-created on
  attach so the editor doesn't need a separate "create tag" call.
* Q10: hard cap of 5 tags per share.
* Q14-A: browse filter uses these helpers via the share service.

The autocomplete and top-N paths use raw SQL because they rely on
PostgreSQL features (`pg_trgm` `similarity()` and the GIN index on
`tags.slug`). The in-memory SQLite test suite can't execute that SQL
end-to-end, so the service tests for autocomplete/top_tags use a
SQLite-compatible LIKE fallback when the dialect isn't postgres —
gated by ``db.bind.dialect.name``.
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import ShareTag, Tag

# Canonical slug shape: lowercase alphanumerics + hyphens, may not
# start or end with a hyphen, and may not contain consecutive hyphens
# (each hyphen must be followed by an alphanumeric). Length is enforced
# separately (see canonicalize) so the regex can stay simple.
_SLUG_RE = re.compile(r"^[a-z0-9](?:-?[a-z0-9])*$")

MAX_TAGS_PER_SHARE = 5


class InvalidTagSlug(ValueError):
    """Raised when a user-supplied label can't be canonicalised into a
    valid slug (empty, too long, or contains illegal characters after
    normalisation)."""


class TooManyTags(ValueError):
    """More than ``MAX_TAGS_PER_SHARE`` tags supplied for a single share."""


def canonicalize(label: str) -> str:
    """Turn a user-supplied label into a canonical slug.

    Steps (Q8-A — no aliases, no plural-stripping):
    1. ``str.strip()``
    2. ``str.lower()``
    3. spaces → hyphens
    4. collapse runs of hyphens
    5. validate against ``_SLUG_RE``

    Raises ``InvalidTagSlug`` on empty, too-long, or invalid input.
    """
    if not isinstance(label, str):
        raise InvalidTagSlug("tag must be a string")

    cleaned = label.strip().lower()
    if not cleaned:
        raise InvalidTagSlug("tag is empty")

    # Spaces / underscores / repeated whitespace → hyphen.
    cleaned = re.sub(r"[\s_]+", "-", cleaned)
    # Collapse repeated hyphens.
    cleaned = re.sub(r"-+", "-", cleaned)
    # Trim leading/trailing hyphens that crept in from the input.
    cleaned = cleaned.strip("-")

    if not cleaned:
        raise InvalidTagSlug("tag is empty after normalisation")
    # Explicit length cap (regex no longer enforces it) — column is
    # varchar(50) and slugs must be at least 1 char.
    if not (1 <= len(cleaned) <= 50):
        raise InvalidTagSlug("tag exceeds 50-character limit")
    if not _SLUG_RE.match(cleaned):
        raise InvalidTagSlug(f"tag contains invalid characters: {label!r}")
    return cleaned


def _label_from_slug(slug: str) -> str:
    """Title-case the slug for a human-readable display label.

    Used when ``get_or_create_tag`` is called without an explicit label
    (the common case — free-form tags coming from the editor).
    """
    return " ".join(part.capitalize() for part in slug.split("-") if part)


async def get_or_create_tag(
    db: AsyncSession,
    slug: str,
    label: str | None = None,
) -> Tag:
    """Return the existing ``Tag`` for ``slug`` or create one.

    ``slug`` MUST already be canonical (caller's job — typically via
    ``canonicalize``). If ``label`` is None we derive title-case from the
    slug. Does NOT commit; the caller is expected to commit as part of
    a larger transaction (e.g. ``set_share_tags``).
    """
    existing = await db.scalar(select(Tag).where(Tag.slug == slug))
    if existing is not None:
        return existing
    tag = Tag(
        id=uuid.uuid4(),
        slug=slug,
        label=label if label is not None else _label_from_slug(slug),
        usage_count=0,
    )
    db.add(tag)
    # Flush so the row is queryable in the same transaction (autocomplete
    # tests, set_share_tags follow-ups).
    await db.flush()
    return tag


async def set_share_tags(
    db: AsyncSession,
    share_id: uuid.UUID,
    slugs: list[str],
    *,
    commit: bool = True,
) -> list[Tag]:
    """Atomically replace ``share``'s tag set with the given slugs.

    * Canonicalises each slug (raises ``InvalidTagSlug`` on any bad
      one — atomic-ish: nothing is written if any slug is invalid).
    * Caps at ``MAX_TAGS_PER_SHARE`` (Q10) — raises ``TooManyTags``.
    * De-duplicates slugs (a user typing "virology" twice doesn't
      eat into the cap, and the join row's PK enforces uniqueness
      anyway).
    * Auto-creates missing tags (Q9-C hybrid).
    * Decrements ``usage_count`` on tags being removed; increments on
      tags being added. Untouched tags' counts are unchanged.
    * Commits before returning when ``commit=True`` (the default) so
      a direct caller can immediately re-read. Pass ``commit=False`` to
      let the outer caller (e.g. ``update_share``) commit once for the
      whole transaction.

    Returns the list of attached ``Tag`` rows in the order they appear
    on the input.
    """
    # Canonicalise + de-dupe in one pass, preserving first-seen order
    # so the returned list mirrors caller intent.
    canonical: list[str] = []
    seen: set[str] = set()
    for raw in slugs:
        slug = canonicalize(raw)
        if slug not in seen:
            seen.add(slug)
            canonical.append(slug)

    if len(canonical) > MAX_TAGS_PER_SHARE:
        raise TooManyTags(
            f"a share may have at most {MAX_TAGS_PER_SHARE} tags (got {len(canonical)})"
        )

    # Existing attachments.
    existing_rows = (
        await db.execute(
            select(Tag.id, Tag.slug)
            .join(ShareTag, ShareTag.tag_id == Tag.id)
            .where(ShareTag.share_id == share_id)
        )
    ).all()
    existing_by_slug: dict[str, uuid.UUID] = {r.slug: r.id for r in existing_rows}

    desired = set(canonical)
    current = set(existing_by_slug.keys())

    to_remove = current - desired
    to_add = desired - current

    # Detach removed tags (delete join rows + decrement usage_count).
    if to_remove:
        remove_ids = [existing_by_slug[s] for s in to_remove]
        await db.execute(
            delete(ShareTag).where(
                ShareTag.share_id == share_id,
                ShareTag.tag_id.in_(remove_ids),
            )
        )
        # Batched fetch (avoids per-tag round-trips).
        rows = await db.scalars(select(Tag).where(Tag.id.in_(remove_ids)))
        for tag in rows:
            tag.usage_count = max(0, tag.usage_count - 1)

    # Attach new tags (auto-creating any missing rows + increment counts).
    new_tag_ids: dict[str, uuid.UUID] = {}
    for slug in to_add:
        tag = await get_or_create_tag(db, slug)
        tag.usage_count += 1
        new_tag_ids[slug] = tag.id
        db.add(ShareTag(share_id=share_id, tag_id=tag.id))

    if commit:
        await db.commit()

        # Expire any cached `Share.tags` for this share_id so subsequent
        # selectinload calls see the updated set rather than the stale
        # empty list captured before set_share_tags ran.
        from myetal_api.models import Share

        cached_share = await db.get(Share, share_id)
        if cached_share is not None:
            # Expire only the relationship attribute; the rest of the
            # share's columns are still fresh.
            db.expire(cached_share, ["tags"])
    else:
        # Caller commits — flush so the join rows + usage_count updates
        # are visible to subsequent statements within the same
        # transaction (e.g. the reload at the end of update_share).
        await db.flush()

    # Reload and return in caller-supplied order. Refetch so we get the
    # post-commit usage_count values.
    if not canonical:
        return []
    final_rows = (await db.execute(select(Tag).where(Tag.slug.in_(canonical)))).scalars().all()
    by_slug = {t.slug: t for t in final_rows}
    return [by_slug[s] for s in canonical if s in by_slug]


async def autocomplete(
    db: AsyncSession,
    q: str,
    limit: int = 10,
) -> list[Tag]:
    """Return up to ``limit`` tags whose slug is similar to ``q``.

    Uses ``pg_trgm`` ``similarity()`` on Postgres for typo-tolerant,
    fast index-backed lookups. On other dialects (the SQLite test
    harness) falls back to ``slug LIKE :q || '%'`` ordered by
    ``usage_count DESC, slug``.
    """
    q_norm = q.strip().lower()
    if not q_norm:
        return []

    dialect = db.bind.dialect.name if db.bind is not None else "postgresql"

    if dialect == "postgresql":
        from sqlalchemy import text

        sql = text(
            """
            SELECT id, slug, label, usage_count, created_at
            FROM tags
            WHERE slug %% :q OR slug ILIKE :prefix
            ORDER BY similarity(slug, :q) DESC, usage_count DESC, slug
            LIMIT :limit
            """
        ).bindparams(q=q_norm, prefix=f"{q_norm}%", limit=limit)
        rows = (await db.execute(sql)).all()
        # Re-hydrate to Tag instances via id lookup so callers get
        # ORM-shaped objects (matches what get_or_create_tag returns).
        if not rows:
            return []
        ids = [r.id for r in rows]
        tags = (await db.execute(select(Tag).where(Tag.id.in_(ids)))).scalars().all()
        by_id = {t.id: t for t in tags}
        return [by_id[r.id] for r in rows if r.id in by_id]

    # SQLite test fallback: prefix match, then substring match, ordered by usage.
    stmt = (
        select(Tag)
        .where(Tag.slug.like(f"%{q_norm}%"))
        .order_by(Tag.usage_count.desc(), Tag.slug)
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())


async def top_tags(db: AsyncSession, limit: int = 8) -> list[Tag]:
    """Return up to ``limit`` tags ordered by ``usage_count DESC, slug``.

    Used by the home / discover tag-chip row. Index-backed
    (`idx_tags_usage_count_desc`) on Postgres; the same query plan is
    fine on SQLite for the test suite.
    """
    stmt = select(Tag).order_by(Tag.usage_count.desc(), Tag.slug).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


async def list_for_share(db: AsyncSession, share_id: uuid.UUID) -> list[Tag]:
    """All tags attached to ``share_id``, ordered by label."""
    stmt = (
        select(Tag)
        .join(ShareTag, ShareTag.tag_id == Tag.id)
        .where(ShareTag.share_id == share_id)
        .order_by(Tag.label)
    )
    return list((await db.execute(stmt)).scalars().all())
