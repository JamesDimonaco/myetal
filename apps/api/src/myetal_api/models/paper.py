"""Global papers table — first-class deduplicated papers, no per-user ownership.

Per the works-library ticket (audit S8 option A), papers are deduplicated
globally on DOI rather than owned per-user. The "who added this paper to
which share" relationship lives on `SharePaper.added_by`. The "what's in my
personal library" relationship lives on `UserPaper`.

Edits to paper rows are NOT user-driven in v1 (per W-S4): the metadata is
populated from authoritative sources (ORCID + Crossref + OpenAlex) and the
works-library UI only allows hiding from library + per-share notes. Global
metadata edits are a deliberate v2 feature.
"""

from __future__ import annotations

import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Enum, Index, Integer, String, Text, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myetal_api.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from myetal_api.models.share_paper import SharePaper
    from myetal_api.models.user_paper import UserPaper


class PaperSource(enum.StrEnum):
    """Origin of a paper row. Single-value (not a history) per W-S7.

    `manual` covers both user DOI-add and migration backfill from legacy
    share_items rows — distinguishing the two would require a richer
    provenance model that we don't need yet.
    """

    ORCID = "orcid"
    CROSSREF = "crossref"
    OPENALEX = "openalex"
    MANUAL = "manual"


class Paper(Base, TimestampMixin):
    __tablename__ = "papers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # Primary identifiers — at most one paper row per non-null value of each.
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)
    openalex_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Per-ORCID-user code; not unique globally because two ORCID users can
    # legitimately have the same numeric put-code referring to different works.
    # Used only as a hint inside the per-user sync flow.
    orcid_put_code: Mapped[str | None] = mapped_column(String(32), nullable=True)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    subtitle: Mapped[str | None] = mapped_column(Text, nullable=True)
    authors: Mapped[str | None] = mapped_column(Text, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    venue: Mapped[str | None] = mapped_column(String(500), nullable=True)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    pdf_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    source: Mapped[PaperSource] = mapped_column(
        Enum(
            PaperSource,
            name="paper_source",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )

    share_links: Mapped[list[SharePaper]] = relationship(
        back_populates="paper",
        cascade="all, delete-orphan",
    )
    library_entries: Mapped[list[UserPaper]] = relationship(
        back_populates="paper",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # Primary global dedup: DOI is unique when present.
        Index(
            "uq_papers_doi",
            "doi",
            unique=True,
            postgresql_where=text("doi IS NOT NULL"),
        ),
        # OpenAlex IDs are unique when present.
        Index(
            "uq_papers_openalex_id",
            "openalex_id",
            unique=True,
            postgresql_where=text("openalex_id IS NOT NULL"),
        ),
        # ORCID put-code lookup; non-unique (per-ORCID-user only).
        Index(
            "ix_papers_orcid_put_code",
            "orcid_put_code",
            postgresql_where=text("orcid_put_code IS NOT NULL"),
        ),
        # Fuzzy fallback dedup for ORCID sync (NOT used by the migration — see W-S2).
        # Expression index on lower(title), year — declared in the Alembic migration.
    )
