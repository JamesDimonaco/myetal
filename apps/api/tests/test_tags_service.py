"""Tests for the tags service: canonicalisation, get-or-create,
share<->tag attach with usage_count maintenance, autocomplete (SQLite
fallback path), and top_tags ordering.

Per feedback-round-2 §2 spec.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.schemas.share import ShareCreate
from myetal_api.services import share as share_service
from myetal_api.services import tags as tags_service
from myetal_api.services.tags import InvalidTagSlug, TooManyTags
from tests.conftest import make_user


async def _make_user(db: AsyncSession, email: str = "tagger@example.com"):
    return await make_user(db, email=email, name="Tagger")


# ---------- canonicalize ----------


def test_canonicalize_lowercases_and_trims() -> None:
    assert tags_service.canonicalize("  Virology  ") == "virology"


def test_canonicalize_replaces_spaces_with_hyphens() -> None:
    assert tags_service.canonicalize("Machine Learning") == "machine-learning"


def test_canonicalize_collapses_repeated_separators() -> None:
    assert tags_service.canonicalize("public   health") == "public-health"
    assert tags_service.canonicalize("ai__ethics") == "ai-ethics"


def test_canonicalize_strips_leading_trailing_hyphens() -> None:
    assert tags_service.canonicalize("-virology-") == "virology"


def test_canonicalize_rejects_empty() -> None:
    with pytest.raises(InvalidTagSlug):
        tags_service.canonicalize("")
    with pytest.raises(InvalidTagSlug):
        tags_service.canonicalize("   ")


def test_canonicalize_rejects_only_hyphens() -> None:
    with pytest.raises(InvalidTagSlug):
        tags_service.canonicalize("---")


def test_canonicalize_rejects_too_long() -> None:
    with pytest.raises(InvalidTagSlug):
        tags_service.canonicalize("a" * 51)


def test_canonicalize_rejects_invalid_chars() -> None:
    with pytest.raises(InvalidTagSlug):
        tags_service.canonicalize("c++")
    with pytest.raises(InvalidTagSlug):
        tags_service.canonicalize("micro/biology")
    with pytest.raises(InvalidTagSlug):
        tags_service.canonicalize("café")


# ---------- get_or_create_tag ----------


async def test_get_or_create_returns_existing(db_session: AsyncSession) -> None:
    a = await tags_service.get_or_create_tag(db_session, "virology")
    await db_session.commit()
    b = await tags_service.get_or_create_tag(db_session, "virology")
    assert a.id == b.id
    assert a.slug == "virology"
    # Default label derives from slug.
    assert a.label == "Virology"


async def test_get_or_create_creates_new_with_derived_label(
    db_session: AsyncSession,
) -> None:
    tag = await tags_service.get_or_create_tag(db_session, "machine-learning")
    assert tag.slug == "machine-learning"
    assert tag.label == "Machine Learning"


# ---------- set_share_tags ----------


async def test_set_share_tags_attaches_and_increments_usage(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))

    await tags_service.set_share_tags(db_session, share.id, ["virology", "microbiome"])

    # Usage counts incremented to 1 each.
    v = await tags_service.get_or_create_tag(db_session, "virology")
    m = await tags_service.get_or_create_tag(db_session, "microbiome")
    assert v.usage_count == 1
    assert m.usage_count == 1


async def test_set_share_tags_atomic_replace_decrements_removed(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))

    await tags_service.set_share_tags(db_session, share.id, ["virology", "microbiome"])
    # Replace with a single different tag.
    await tags_service.set_share_tags(db_session, share.id, ["genomics"])

    v = await tags_service.get_or_create_tag(db_session, "virology")
    m = await tags_service.get_or_create_tag(db_session, "microbiome")
    g = await tags_service.get_or_create_tag(db_session, "genomics")
    assert v.usage_count == 0
    assert m.usage_count == 0
    assert g.usage_count == 1


async def test_set_share_tags_empty_clears_all(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))

    await tags_service.set_share_tags(db_session, share.id, ["virology"])
    await tags_service.set_share_tags(db_session, share.id, [])

    v = await tags_service.get_or_create_tag(db_session, "virology")
    assert v.usage_count == 0

    attached = await tags_service.list_for_share(db_session, share.id)
    assert attached == []


async def test_set_share_tags_dedupes_input(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))

    # Same slug appearing twice should count once toward usage_count + cap.
    await tags_service.set_share_tags(
        db_session,
        share.id,
        ["virology", "Virology", "virology"],
    )
    v = await tags_service.get_or_create_tag(db_session, "virology")
    assert v.usage_count == 1


async def test_set_share_tags_enforces_cap_of_5(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))

    six_slugs = ["a-tag", "b-tag", "c-tag", "d-tag", "e-tag", "f-tag"]
    with pytest.raises(TooManyTags):
        await tags_service.set_share_tags(db_session, share.id, six_slugs)


async def test_set_share_tags_invalid_slug_raises(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))

    with pytest.raises(InvalidTagSlug):
        await tags_service.set_share_tags(db_session, share.id, ["valid", "c++"])


async def test_set_share_tags_auto_creates_unknown_slugs(
    db_session: AsyncSession,
) -> None:
    """Q9-C hybrid: unknown free-form slugs are created on demand."""
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))

    await tags_service.set_share_tags(db_session, share.id, ["totally-novel-tag"])

    new = await tags_service.get_or_create_tag(db_session, "totally-novel-tag")
    assert new.usage_count == 1
    assert new.label == "Totally Novel Tag"


# ---------- autocomplete ----------


async def test_autocomplete_returns_prefix_matches(db_session: AsyncSession) -> None:
    """SQLite fallback: substring match. Postgres path is exercised in
    integration; this just confirms the API contract."""
    await tags_service.get_or_create_tag(db_session, "virology")
    await tags_service.get_or_create_tag(db_session, "virtual-reality")
    await tags_service.get_or_create_tag(db_session, "ecology")
    await db_session.commit()

    results = await tags_service.autocomplete(db_session, "vir", limit=10)
    slugs = {t.slug for t in results}
    assert "virology" in slugs
    assert "virtual-reality" in slugs
    assert "ecology" not in slugs


async def test_autocomplete_respects_limit(db_session: AsyncSession) -> None:
    for s in ["virology", "virtual-reality", "viroid", "viral"]:
        await tags_service.get_or_create_tag(db_session, s)
    await db_session.commit()

    results = await tags_service.autocomplete(db_session, "vir", limit=2)
    assert len(results) == 2


async def test_autocomplete_empty_query(db_session: AsyncSession) -> None:
    assert await tags_service.autocomplete(db_session, "", limit=10) == []
    assert await tags_service.autocomplete(db_session, "   ", limit=10) == []


# ---------- top_tags ----------


async def test_top_tags_orders_by_usage_count_desc(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    share_a = await share_service.create_share(db_session, user.id, ShareCreate(name="a"))
    share_b = await share_service.create_share(db_session, user.id, ShareCreate(name="b"))
    share_c = await share_service.create_share(db_session, user.id, ShareCreate(name="c"))

    # virology used 3x, microbiome 2x, ecology 1x
    await tags_service.set_share_tags(db_session, share_a.id, ["virology", "ecology"])
    await tags_service.set_share_tags(db_session, share_b.id, ["virology", "microbiome"])
    await tags_service.set_share_tags(db_session, share_c.id, ["virology", "microbiome"])

    results = await tags_service.top_tags(db_session, limit=3)
    slugs = [t.slug for t in results]
    assert slugs[0] == "virology"
    assert slugs[1] == "microbiome"
    assert slugs[2] == "ecology"


async def test_top_tags_respects_limit(db_session: AsyncSession) -> None:
    for s in ["a-tag", "b-tag", "c-tag", "d-tag"]:
        await tags_service.get_or_create_tag(db_session, s)
    await db_session.commit()

    results = await tags_service.top_tags(db_session, limit=2)
    assert len(results) == 2
