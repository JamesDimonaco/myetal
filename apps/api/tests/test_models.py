from myetal_api.models import (
    Base,
    ItemKind,
    OrcidSyncRun,
    OrcidSyncStatus,
    Paper,
    PaperSource,
    Share,
    ShareItem,
    SharePaper,
    ShareReport,
    ShareReportReason,
    ShareReportStatus,
    ShareSimilar,
    ShareTag,
    ShareType,
    ShareView,
    Tag,
    TrendingShare,
    User,
    UserPaper,
    UserPaperAddedVia,
)


def test_all_tables_registered_on_metadata() -> None:
    # Phase 2 of the Better Auth migration deletes the legacy
    # ``auth_identities`` and ``refresh_tokens`` SQLAlchemy models;
    # Better Auth's ``session``, ``account``, ``verification``, and
    # ``jwks`` tables are the replacement.
    assert set(Base.metadata.tables.keys()) == {
        "users",
        "shares",
        "share_items",
        "papers",
        "share_papers",
        "user_papers",
        "orcid_sync_runs",
        "share_views",
        "share_similar",
        "trending_shares",
        "share_reports",
        "feedback",
        "tags",
        "share_tags",
        "session",
        "account",
        "verification",
        "jwks",
        # `admin_audit` — Stage 2 of admin-analytics-dashboard ticket.
        "admin_audit",
        # `request_metrics` + `script_runs` — Stage 4 operational tables.
        "request_metrics",
        "script_runs",
    }


def test_share_type_values() -> None:
    assert {t.value for t in ShareType} == {
        "paper",
        "collection",
        "bundle",
        "grant",
        "project",
    }


def test_item_kind_values() -> None:
    # ``pdf`` was added in 0014 alongside the R2 upload pipeline (PR-C,
    # feedback-round-2 §1).
    assert {k.value for k in ItemKind} == {"paper", "repo", "link", "pdf"}


def test_paper_source_values() -> None:
    assert {s.value for s in PaperSource} == {"orcid", "crossref", "openalex", "manual"}


def test_user_paper_added_via_values() -> None:
    assert {v.value for v in UserPaperAddedVia} == {"orcid", "manual", "share"}


def test_orcid_sync_status_values() -> None:
    assert {s.value for s in OrcidSyncStatus} == {
        "pending",
        "running",
        "completed",
        "failed",
    }


def test_share_report_reason_values() -> None:
    assert {r.value for r in ShareReportReason} == {
        "copyright",
        "spam",
        "abuse",
        "pii",
        "other",
    }


def test_share_report_status_values() -> None:
    assert {s.value for s in ShareReportStatus} == {"open", "actioned", "dismissed"}


def test_models_are_classes() -> None:
    for cls in (
        User,
        Share,
        ShareItem,
        Paper,
        SharePaper,
        UserPaper,
        OrcidSyncRun,
        ShareView,
        ShareSimilar,
        TrendingShare,
        ShareReport,
        Tag,
        ShareTag,
    ):
        assert hasattr(cls, "__tablename__")


def test_tag_model_shape() -> None:
    """Tag mirrors the existing model-shape pattern: __tablename__,
    primary key, slug + label columns, default usage_count."""
    assert Tag.__tablename__ == "tags"
    cols = {c.name for c in Tag.__table__.columns}
    assert {"id", "slug", "label", "usage_count", "created_at"} <= cols


def test_share_tag_join_shape() -> None:
    """ShareTag is a composite-PK join row; cascade-delete on both FKs."""
    assert ShareTag.__tablename__ == "share_tags"
    cols = {c.name for c in ShareTag.__table__.columns}
    assert {"share_id", "tag_id", "created_at"} <= cols
    pk_cols = {c.name for c in ShareTag.__table__.primary_key.columns}
    assert pk_cols == {"share_id", "tag_id"}


async def test_share_tags_relationship_loads(db_session) -> None:  # type: ignore[no-untyped-def]
    """Share.tags relationship loads attached tags in label order."""
    from myetal_api.models import User
    from myetal_api.schemas.share import ShareCreate
    from myetal_api.services import share as share_service
    from myetal_api.services import tags as tags_service

    user = User(email="rel@example.com", name="Rel")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))
    await tags_service.set_share_tags(db_session, share.id, ["virology", "microbiome"])

    refreshed = await share_service.get_share_for_owner(db_session, share.id, user.id)
    assert refreshed is not None
    assert {t.slug for t in refreshed.tags} == {"virology", "microbiome"}
