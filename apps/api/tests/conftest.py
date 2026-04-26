import os

# Set OAuth test credentials BEFORE any ceteris_api imports — otherwise pydantic
# Settings reads empty defaults and the OAuth provider wiring fails on
# ProviderNotConfigured. setdefault means a real env var still wins if present.
os.environ.setdefault("ORCID_CLIENT_ID", "test-orcid-client-id")
os.environ.setdefault("ORCID_CLIENT_SECRET", "test-orcid-client-secret")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-google-client-id")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-google-client-secret")
os.environ.setdefault("GITHUB_CLIENT_ID", "test-github-client-id")
os.environ.setdefault("GITHUB_CLIENT_SECRET", "test-github-client-secret")

from collections.abc import AsyncIterator, Iterator  # noqa: E402

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import event  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from ceteris_api.core.database import get_db  # noqa: E402
from ceteris_api.main import app  # noqa: E402
from ceteris_api.models import Base  # noqa: E402


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    """Fresh in-memory SQLite database per test, with FK enforcement on."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _enforce_fks(dbapi_conn, _conn_record):  # type: ignore[no-untyped-def]
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as session:
        yield session

    await engine.dispose()


@pytest.fixture
def api_client(db_session: AsyncSession) -> Iterator[TestClient]:
    """FastAPI TestClient with the DB dependency wired to the per-test
    SQLite session. Also resets slowapi's in-memory counter between tests
    so rate-limit tests don't bleed into each other."""
    from ceteris_api.core.rate_limit import limiter

    async def _override() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    limiter.reset()
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        limiter.reset()
