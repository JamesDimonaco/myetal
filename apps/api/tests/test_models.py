from myetal_api.models import (
    AuthIdentity,
    AuthProvider,
    Base,
    ItemKind,
    OrcidSyncRun,
    OrcidSyncStatus,
    Paper,
    PaperSource,
    RefreshToken,
    Share,
    ShareComment,
    ShareFavorite,
    ShareItem,
    SharePaper,
    ShareType,
    User,
    UserPaper,
    UserPaperAddedVia,
)


def test_all_tables_registered_on_metadata() -> None:
    assert set(Base.metadata.tables.keys()) == {
        "users",
        "auth_identities",
        "refresh_tokens",
        "shares",
        "share_items",
        "share_comments",
        "share_favorites",
        "papers",
        "share_papers",
        "user_papers",
        "orcid_sync_runs",
    }


def test_auth_provider_values() -> None:
    assert {p.value for p in AuthProvider} == {"orcid", "google", "github", "password"}


def test_share_type_values() -> None:
    assert {t.value for t in ShareType} == {
        "paper",
        "collection",
        "poster",
        "grant",
        "project",
    }


def test_item_kind_values() -> None:
    assert {k.value for k in ItemKind} == {"paper", "repo", "link"}


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


def test_models_are_classes() -> None:
    for cls in (
        User,
        AuthIdentity,
        RefreshToken,
        Share,
        ShareItem,
        ShareComment,
        ShareFavorite,
        Paper,
        SharePaper,
        UserPaper,
        OrcidSyncRun,
    ):
        assert hasattr(cls, "__tablename__")
