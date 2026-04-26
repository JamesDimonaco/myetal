from myetal_api.models import (
    AuthIdentity,
    AuthProvider,
    Base,
    ItemKind,
    RefreshToken,
    Share,
    ShareComment,
    ShareFavorite,
    ShareItem,
    ShareType,
    User,
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


def test_models_are_classes() -> None:
    for cls in (
        User,
        AuthIdentity,
        RefreshToken,
        Share,
        ShareItem,
        ShareComment,
        ShareFavorite,
    ):
        assert hasattr(cls, "__tablename__")
