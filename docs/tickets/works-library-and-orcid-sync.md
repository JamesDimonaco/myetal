# Ticket: Works Library + ORCID Sync

**Status:** Draft / not started
**Owner:** James
**Created:** 2026-04-27
**Last revised:** 2026-04-26 (review pass — see "What changed in review pass")
**Estimate:** ~2 weeks elapsed, ~5 focused days of work, split across two phases
**Depends on:** ORCID OAuth (already in plan, pending sandbox approval)
**Related:** `public-discovery-and-collaboration.md` (Phase 4 / week-2 of that ticket consumes the `share_papers` table this one builds; Phase 5's editor role consumes `share_papers.added_by`)

---

## What changed in review pass (2026-04-26)

Changelog of fixes applied in this review pass — review-finding IDs in brackets so the lineage is traceable to the per-ticket review report.

- **Cross-ticket: papers are global, full stop.** Discovery ticket no longer leaves the door open to "single-owner papers safe to keep / S8 dodged." Both tickets now reference the global model uniformly. [W-BL1]
- **Migration position-namespace rule made explicit.** `share_items` (kind=repo|link) and `share_papers` share a single per-share `position` integer namespace. Read paths sort across both tables together by `position`. Editor refactor in week 2 must support cross-table drag-reorder. Discovery ticket inherits this rule. [W-BL2]
- **Within-share duplicate paper handling.** Migration keeps the lowest-position row per `(share_id, paper_id)`, drops the rest, logs the discarded count. Editor shows a toast "you already have this paper in this share" if user re-adds. Test case added. [W-BL3]
- **Migration preserves `subtitle` and `image_url`** by adding both to the `papers` table (subtitle Text nullable, image_url String 2000 nullable). [W-BL4]
- **Backup-table inserts are idempotent.** `_migration_share_items_backup` INSERT uses `ON CONFLICT (id) DO NOTHING` so a partially-progressed migration converges on retry. [W-S1]
- **Migration dedup is DOI-only.** Fuzzy `(lower(title), year)` matching dropped from the migration global dedup path — too many false-positive textbook merges. Non-DOI papers each get their own row at migration time. Fuzzy matching stays available inside the per-user ORCID sync flow where it can be reviewed/undone. [W-S2]
- **ORCID sync runs in the background.** `POST /me/works/sync-orcid` now returns 202 + `sync_run_id`. Per-source concurrency cap (3 Crossref, 5 OpenAlex), 429 backoff. New `orcid_sync_runs` table tracks state; `GET /me/works/sync-runs/{id}` exposes status. [W-S3]
- **No global paper edits in v1.** Works-library "edit metadata" UI is locked to per-share `share_papers.notes` only; never edits `papers` rows directly. Defers the "your edit silently changes everyone's view" trap to a follow-up. Moots the open Q6 about global-paper-edit precedence. [W-S4 / W-S6]
- **`user_papers` join table confirmed.** Schema added to DDL section (Q1 resolved). Migration seeds it from each share's owner. [W-S5 / Q1]
- **Open Q2 reframed:** `papers.source` is single-value origin, not a history. Wording corrected. [W-S7]
- **Pre-reqs note Alembic head ordering.** Works ticket's migration runs before the discovery ticket's `social.py` removal migration. [W-s7]
- **Composite PK on `share_papers` retained.** Reviewer's surrogate-UUID alternative rejected — composite PK enforces dedup at the DB level, and `(share_id, position)` index covers ordering reads. [W-A1]
- **Follow-up cleanup section added.** 90 days post-migration: drop `_migration_share_items_backup` and remove `'paper'` from `item_kind` enum. Tracked as a future ticket. [W-A2]
- **`papers.source` uses a real Postgres ENUM**, mirroring `share_type` / `item_kind` patterns in `models/share.py`. [W-A3]
- Smaller fixes: future co-author-network needs `paper_authors` join (out of scope here, noted) [W-s1]; trimmed varchar widths on `openalex_id` (64) and `orcid_put_code` (32) [W-s2]; ORCID fetcher 0.5d → 1d [W-s3]; web e2e tests 0.25d → 0.5d [W-s4]; renamed week-1 task row to `services/papers.py:lookup_doi_openalex` (existing `search_papers` is full-text only) and added 0.25d to OpenAlex hydration [W-s6].

---

## Why this rewrite happened (background)

The original draft had `papers.owner_user_id` — every paper belonged to one
user. The discovery-ticket audit (`public-discovery-and-collaboration-AUDIT.md`,
section S8) called that out as a blocker for editor-role collaboration: an
editor adding a paper to my share would either own it themselves or force a
clone, and neither story is clean. This rewrite addresses that by making
**papers global** (audit S8 option A): one row per paper for the whole platform,
deduplicated on DOI, and the "who put this in this share" relationship moves
onto the join row (`share_papers.added_by`).

This decision is now binding cross-ticket — the discovery ticket's "who else
shares this paper" / "similar shares" / collaboration-related text all assumes
global papers. See discovery ticket D7 + cross-references.

Other shape changes in this pass:

- Phasing aligned with the agreed two-week plan (option 2): foundations in
  week 1, UI surfaces in week 2.
- Migration story made explicit and reversible — original `share_items`
  payloads stashed in a backup table so the down migration can rehydrate.
- Author disambiguation explicitly deferred, ORCID-or-DOI is the v1 floor.
- "Source of paper data" section added so it's clear Google Scholar is
  permanently out, not "later."
- Cross-references to the discovery ticket's week-2 surfaces + future
  collaboration phase added so the data model decisions are legible to the
  agent picking up that work.

---

## The user-facing pitch

> Sign in. Connect your ORCID. We pull your publications. When you create
> a share, you tick the papers you want — no DOI typing, no manual entry.
> The same paper can live in many shares, and when your collaborator adds
> a paper to a shared collection, it's the same paper in the same row, not
> a duplicate.

---

## Why not "Google Scholar sync"?

Google Scholar has no API. The realistic options are:

- **Scrape it** — works until Google's anti-bot kicks in (days to weeks),
  then captchas, then prod IP banned. Against ToS. Indefinite maintenance
  burden.
- **SerpAPI's Scholar wrapper** — paid (~$50/mo for 5k queries), legal grey
  area, papers over Google's blocks for you.
- **Use ORCID + OpenAlex + Crossref instead** — legit APIs, free, structured
  data, designed for this. Same outcome from the user's POV.

**Decision: ORCID + Crossref + OpenAlex, permanently.** Frame this as "your
works library, populated from ORCID" rather than "Scholar sync." Same UX,
real foundation. **Not revisited if a tester asks for Scholar** — academics
know ORCID, and Scholar scraping is a maintenance trap we will not enter.

---

## Source of paper data (explicit list)

| Source | Role | Where it's wired |
|---|---|---|
| ORCID `/v3/{orcid}/works` | Primary list of a user's works (post-OAuth) | New: `services/orcid_works.py` |
| Crossref `/works/{doi}` | DOI hydration — title, authors, year, venue | Existing: `services/papers.py:lookup_doi` |
| OpenAlex `/works` | Fallback hydration when Crossref 404s; future citation counts | New: `services/papers.py:lookup_doi_openalex` (W-s6 — existing `search_papers` is full-text only and not used as the hydration entry point) |
| Manual DOI add | Any user, including Google/GitHub-only sign-ins | New: `POST /me/works` |
| Google Scholar | **Not used. Ever.** | n/a |

---

## Current data model (what we're changing)

`apps/api/src/myetal_api/models/share.py`:

- `Share` — owner, name, type, items[]
- `ShareItem` — embedded paper data (title, doi, authors, year, url,
  scholar_url, image_url, notes) + position + kind enum (paper / repo / link)

Paper data is **denormalised into each share_item row.** Same paper in two
shares = two rows with duplicated DOI/title/authors. Fine for "scan poster,
get list," wrong for "library of MY papers, drop into many shares" — and
actively wrong for the editor-role collaboration the discovery ticket adds
later (audit S8).

---

## Target data model

Two new tables. `share_items` stays for `kind in (repo, link)` — the paper
kind moves out entirely.

### `papers` (global, no per-user ownership)

Addresses audit S8 by making papers global rather than per-user. Same DOI =
same paper for everyone. No `owner_user_id`. The "who attached this paper to
this share" question moves to `share_papers.added_by`.

```sql
-- W-A3: real Postgres ENUM, mirrors share_type / item_kind patterns in models/share.py.
CREATE TYPE paper_source AS ENUM ('orcid', 'crossref', 'openalex', 'manual');

CREATE TABLE papers (
    id              uuid          PRIMARY KEY,
    doi             text          NULL,           -- normalised, lowercase, bare 10.x/y
    openalex_id     varchar(64)   NULL,           -- W-s2: trimmed
    orcid_put_code  varchar(32)   NULL,           -- W-s2: trimmed; backup dedup key when DOI is missing
    title           text          NOT NULL,
    subtitle        text          NULL,           -- W-BL4: preserved from share_items.subtitle
    authors         text          NULL,           -- denormalised "Smith J, Jones A, ..."
    year            integer       NULL,
    venue           varchar(500)  NULL,           -- journal / conference name
    abstract        text          NULL,
    url             varchar(2000) NULL,           -- canonical landing page
    pdf_url         varchar(2000) NULL,           -- if known + open-access (link only, not hosted)
    image_url       varchar(2000) NULL,           -- W-BL4: preserved from share_items.image_url
    source          paper_source  NOT NULL,       -- W-A3: enum, single-value origin (NOT a history)
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);

-- Primary dedup: DOI is globally unique (case-insensitive on the normalised form).
CREATE UNIQUE INDEX uq_papers_doi ON papers (doi) WHERE doi IS NOT NULL;

-- Backup dedup for works ORCID returned without a DOI (preprints, theses).
-- Not unique by itself — a put-code is per-ORCID-user, so two users can have
-- the same put-code value referring to different works. Used only as a hint
-- inside the per-user sync flow, never as a global key.
CREATE INDEX ix_papers_orcid_put_code ON papers (orcid_put_code) WHERE orcid_put_code IS NOT NULL;

-- For "find by OpenAlex id" (future citation-count refresh).
CREATE UNIQUE INDEX uq_papers_openalex_id ON papers (openalex_id) WHERE openalex_id IS NOT NULL;

-- Fuzzy fallback hint, used ONLY by the ORCID sync flow (not the migration —
-- W-S2 dropped fuzzy global dedup at migration time). Application-side
-- upsert checks (lower(title), year) before inserting; not a unique constraint.
CREATE INDEX ix_papers_lower_title_year ON papers (lower(title), year);
```

> **Note (W-s1):** future co-author networks need a `paper_authors`
> (paper_id, author_id, position) join, with an `authors` table for canonical
> author records (ORCID-keyed where possible). **Out of scope for this
> ticket** — `papers.authors` text remains the v1 surface.

SQLAlchemy shape (mirrors the patterns in `models/share.py`):

```python
class PaperSource(enum.StrEnum):
    ORCID = "orcid"
    CROSSREF = "crossref"
    OPENALEX = "openalex"
    MANUAL = "manual"


class Paper(Base, TimestampMixin):
    __tablename__ = "papers"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)
    openalex_id: Mapped[str | None] = mapped_column(String(64), nullable=True)   # W-s2
    orcid_put_code: Mapped[str | None] = mapped_column(String(32), nullable=True)  # W-s2
    title: Mapped[str] = mapped_column(Text, nullable=False)
    subtitle: Mapped[str | None] = mapped_column(Text, nullable=True)            # W-BL4
    authors: Mapped[str | None] = mapped_column(Text, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    venue: Mapped[str | None] = mapped_column(String(500), nullable=True)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    pdf_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)   # W-BL4
    source: Mapped[PaperSource] = mapped_column(
        Enum(PaperSource, name="paper_source", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    # Indexes/constraints declared in __table_args__, see DDL above.
```

### `share_papers` (join)

Per-share placement of a (global) paper. `added_by` records who attached it
— this is what makes the future editor-role story coherent (see
`public-discovery-and-collaboration.md` Phase 5).

> **Position-namespace rule (W-BL2 — binding cross-ticket).**
> `share_items` (kind ∈ {repo, link}) and `share_papers` share a **single
> per-share `position` integer namespace.** Read paths sort across both
> tables together by `position` (UNION ALL ORDER BY position). Drag-reorder
> in the editor must compute new positions across both tables in one pass
> (the week-2 editor refactor owns this). Discovery ticket inherits this
> rule for any read paths it adds.

```sql
CREATE TABLE share_papers (
    share_id    uuid        NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    paper_id    uuid        NOT NULL REFERENCES papers(id) ON DELETE RESTRICT,
    position    integer     NOT NULL DEFAULT 0,
    notes       text        NULL,                       -- per-share annotation
    added_by    uuid        NULL REFERENCES users(id) ON DELETE SET NULL,
                                                        -- nullable: legacy migrated rows have no known adder
    added_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (share_id, paper_id)
);

CREATE INDEX ix_share_papers_paper_id ON share_papers (paper_id);
-- ^ feeds the discovery ticket's "who else shares this paper" panel.

CREATE INDEX ix_share_papers_share_position ON share_papers (share_id, position);
```

Notes on the FK choices:

- `paper_id` is `ON DELETE RESTRICT` — global papers are never auto-deleted
  by removing them from a share. They linger until an admin GC pass cleans
  up orphans (out of scope v1; just don't garbage-collect papers).
- `added_by` is `ON DELETE SET NULL` so deleting the editor doesn't blow
  away the share's content. The owner keeps the paper; we just lose the
  "who added this" attribution.
- `PRIMARY KEY (share_id, paper_id)` enforces "same paper at most once per
  share" at the DB level — see W-BL3 for migration dedup behaviour and
  editor-side toast.

### `user_papers` (per-user library — W-S5 / Q1 resolved)

The user's library is the set of papers they've imported via ORCID sync OR
manually added by DOI. Modelled as an explicit join table (option (a) from
Q1 — option (b), a "library" pseudo-share, was rejected because it conflates
two concepts and breaks the discovery ticket's "find shares this paper
appears in" query).

```sql
CREATE TYPE user_paper_added_via AS ENUM ('orcid', 'manual');

CREATE TABLE user_papers (
    user_id    uuid                 NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    paper_id   uuid                 NOT NULL REFERENCES papers(id) ON DELETE RESTRICT,
    added_via  user_paper_added_via NOT NULL,
    added_at   timestamptz          NOT NULL DEFAULT now(),
    hidden_at  timestamptz          NULL,                  -- soft-hide, user can hide without deleting
    PRIMARY KEY (user_id, paper_id)
);

CREATE INDEX ix_user_papers_user_added_at ON user_papers (user_id, added_at DESC);
```

The migration seeds `user_papers` from `share.owner_user_id` for every paper
attached to one of their shares (`added_via='manual'` is the safe default at
migration time — we don't know whether a legacy paper came from ORCID or
manual entry).

The discovery ticket can ignore `user_papers` for v1 — it doesn't surface
the user's library as a public discovery surface (no `/u/{handle}/works`
page yet). Noting it here so the schema is documented in one place.

### `_migration_share_items_backup` (temporary, for reversibility only)

```sql
CREATE TABLE _migration_share_items_backup (
    id          uuid        PRIMARY KEY,           -- original share_items.id
    payload     jsonb       NOT NULL,              -- full row as JSON, exact field names
    backed_up_at timestamptz NOT NULL DEFAULT now()
);
```

Drop this table once the migration is observed stable in prod for ~2 weeks.
Keep it forever in dev. Down migration reads it to rehydrate the `share_items`
rows verbatim.

### What stays

- `Share` — unchanged.
- `ShareItem` — unchanged shape, but `kind='paper'` rows are gone after the
  migration. Application code that creates new `ShareItem`s with `kind='paper'`
  is removed in week 1; the enum value stays in the DB to keep the migration
  reversible.

---

## Migration story

One Alembic revision. **Runs before the discovery ticket's `social.py`
removal migration** — the discovery ticket's week-1 cleanup is a separate
revision that follows this one (W-s7, see Pre-reqs).

Forward path:

1. Create `paper_source` and `user_paper_added_via` ENUM types.
2. Create `papers`, `share_papers`, `user_papers`,
   `_migration_share_items_backup`, `orcid_sync_runs` (W-S3) tables and
   their indexes.
3. Add `subtitle` and `image_url` columns to `papers` (W-BL4) — already in
   the DDL above; this step is the column add itself.
4. For every `share_items` row where `kind='paper'`, in
   `(share_id, position ASC, id ASC)` order:
   1. **Snapshot the row** into `_migration_share_items_backup` using
      `INSERT ... ON CONFLICT (id) DO NOTHING` (W-S1: idempotent so a
      partially-progressed migration converges on retry).
   2. **Resolve to a `papers.id`** — DOI-only exact dedup (W-S2):
      - If `doi` is present and non-empty: `INSERT ... ON CONFLICT (doi) DO
        UPDATE SET updated_at = now() RETURNING id` against the normalised
        DOI. Same DOI across shares maps to the same paper.
      - If `doi` is null: **always insert a new `papers` row** with
        `source='manual'`. No fuzzy `(lower(title), year)` matching at
        migration time — too dangerous for textbooks / theses with shared
        titles. Accept some duplication; users can merge later.
      - Preserve `subtitle`, `image_url`, `authors`, `year` from the
        `share_items` row onto the new `papers` row (W-BL4).
   3. **Within-share dedup (W-BL3):** if a `share_papers (share_id, paper_id)`
      row already exists for this share (because we just resolved another
      share_item to the same `paper_id`), keep the **first-encountered**
      row (lowest `position`) and skip this one. Increment a
      `discarded_within_share_duplicates` counter and emit it in the
      migration log so post-migration we can grep for affected users.
   4. **Insert `share_papers (share_id, paper_id, position, notes, added_by,
      added_at)`** — `added_by` set to `share.owner_user_id` (best guess for
      legacy rows; nullable in the schema, but we have a value here).
      `position` is taken verbatim from the source `share_items.position`
      so the shared position-namespace (W-BL2) is preserved.
   5. **Seed `user_papers (user_id=share.owner_user_id, paper_id,
      added_via='manual', added_at=share_items.created_at)`** with
      `ON CONFLICT (user_id, paper_id) DO NOTHING`. Migration default of
      `'manual'` is safe — at migration time we don't know if the legacy
      row came from ORCID or DOI lookup.
   6. **Delete the original `share_items` row.**
5. Leave `share_items` in place — it still serves `kind in (repo, link)`,
   sharing the per-share position namespace with `share_papers` (W-BL2).

Down path:

1. For every row in `_migration_share_items_backup`, re-insert into
   `share_items` from the JSON payload. Position, notes, ids preserved.
2. Delete the corresponding `share_papers`, `user_papers` rows.
3. Drop `papers`, `share_papers`, `user_papers`, `orcid_sync_runs`. Drop the
   backup table. Drop the new ENUM types.

The down path is allowed to be ugly. It exists so that if week-1 ships and
something is catastrophically wrong, we can roll back without losing data.
It is **not** intended for routine dev use after this migration lands.

### Migration tests (week 1, mandatory)

- Round-trip on a seed dataset that includes:
  - Same DOI in two shares owned by two different users → one `papers` row,
    two `share_papers` rows, two `user_papers` rows (one per owner).
  - Same DOI in two shares owned by the same user → one `papers` row, two
    `share_papers` rows, ONE `user_papers` row.
  - **Same DOI in the same share, two share_items rows (W-BL3 dedup):**
    one `papers` row, ONE `share_papers` row (the lowest-position one), and
    the migration log records the discarded count.
  - Paper without DOI in two shares, identical title+year (W-S2): TWO
    `papers` rows (no fuzzy global merge at migration time), two
    `share_papers` rows. Documented as expected behaviour.
  - Paper without DOI and unique title → one new `papers` row.
  - `kind='repo'` and `kind='link'` rows → unchanged in `share_items`,
    nothing in `papers`. Position values across the share remain
    contiguous after the move (W-BL2 — UNION read order is correct).
  - `share_items.subtitle` / `share_items.image_url` non-null on a paper
    row → values land on the new `papers` row (W-BL4).
- Idempotency (W-S1): running the migration twice on a partially-migrated
  DB does not duplicate rows. The backup-table insert uses
  `ON CONFLICT (id) DO NOTHING`; paper upserts are DOI-keyed
  `ON CONFLICT`; `user_papers` insert is `ON CONFLICT (user_id, paper_id)
  DO NOTHING`.
- Down then up: `_migration_share_items_backup` rehydrates, then re-running
  forward produces the same `papers` / `share_papers` / `user_papers`
  shape.

---

## Sync flow

Two entry points. Both **additive only** — never auto-delete. Re-syncs are
**idempotent on DOI (preferred) or ORCID put-code (fallback)** and return
explicit `{ added, updated, unchanged }` counts so the UI can say "We
imported 3 new papers, refreshed 2."

### A. ORCID auto-sync (post-login + manual refresh, BACKGROUND)

Triggered:

- Once on first ORCID OAuth connect (background job, non-blocking).
- On user click of "Refresh from ORCID" in the works library page.

**Synchronous request would hang for 60+ seconds on a 200-work ORCID
profile (W-S3).** All sync runs are background tasks.

```
POST /me/works/sync-orcid
  → 202 Accepted
    body: { sync_run_id: "uuid", status: "queued" }
  → enqueues a background task (existing FastAPI BackgroundTasks pattern,
    or a simple in-process worker — we don't need Celery yet)

Background task:
  → INSERT INTO orcid_sync_runs (id, user_id, status='running', started_at=now())
  → fetches /v3/{orcid}/works (paginated through summary pages)
  → for each work summary, with per-source concurrency caps:
      - Crossref: max 3 in-flight at once (Crossref's polite-pool limit)
      - OpenAlex: max 5 in-flight at once
      - 429 backoff: exponential, max 4 retries, then mark item failed and
        continue (don't fail the whole sync)
      - if DOI present: hydrate via Crossref (fallback OpenAlex on 404)
      - else: rely on ORCID's own minimal metadata + put-code dedup,
        with optional fuzzy `(lower(title), year)` lookup against existing
        papers — surfaces the candidate match in the sync run summary so
        the user can review and undo (NOT auto-merged silently; W-S2 fuzzy
        merges happen here, with audit, not in the migration).
  → upsert into papers (dedup precedence: doi > openalex_id > orcid_put_code
    > reviewed (lower(title), year))
  → insert into user_papers (user_id, paper_id, added_via='orcid')
    ON CONFLICT (user_id, paper_id) DO NOTHING
  → insert nothing into share_papers — sync only populates the user's library;
    placing into shares is an explicit user action
  → UPDATE orcid_sync_runs SET status='succeeded', finished_at=now(),
    added_count=N, updated_count=M, unchanged_count=K, fuzzy_candidates=...

GET /me/works/sync-runs/{id}
  → 200 { status, started_at, finished_at, added_count, updated_count,
          unchanged_count, fuzzy_candidates: [...], errors: [...] }
  → web/mobile poll this every ~3s while the sync is running and surface
    progress + the {added,updated,unchanged} toast on completion
```

Note: ORCID's `/works` endpoint returns sparse metadata (title + put-code
only at the summary level). Crossref/OpenAlex hydration is what gives us
authors / year / venue. Treat the ORCID call as the **list** and Crossref as
the **detail**.

#### `orcid_sync_runs` DDL

```sql
CREATE TYPE orcid_sync_status AS ENUM ('queued', 'running', 'succeeded', 'failed');

CREATE TABLE orcid_sync_runs (
    id                 uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status             orcid_sync_status NOT NULL DEFAULT 'queued',
    started_at         timestamptz       NULL,
    finished_at        timestamptz       NULL,
    added_count        integer           NOT NULL DEFAULT 0,
    updated_count      integer           NOT NULL DEFAULT 0,
    unchanged_count    integer           NOT NULL DEFAULT 0,
    fuzzy_candidates   jsonb             NULL,    -- list of (paper_id, candidate_paper_id, score)
    errors             jsonb             NULL,    -- list of {work_summary_id, source, message}
    created_at         timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX ix_orcid_sync_runs_user_created ON orcid_sync_runs (user_id, created_at DESC);
```

### B. Manual add by DOI (any user)

For Google/GitHub-only users, or for papers ORCID doesn't have (preprints
not yet linked, papers from before the user got an ORCID).

```
POST /me/works
  body: { doi: "10.1038/..." }
  → resolves via services/papers.py:lookup_doi (Crossref) → lookup_doi_openalex fallback (W-s6)
  → upserts paper, returns it
  → inserts into user_papers (added_via='manual') ON CONFLICT DO NOTHING
```

### Per-user "library" semantics

A user's library is the set of papers they have either (a) imported via
ORCID sync or (b) manually added by DOI. Recorded explicitly in the
`user_papers` join table (W-S5 / Q1 resolved — see DDL above). ORCID sync
inserts with `added_via='orcid'`; manual `POST /me/works` inserts with
`added_via='manual'`. Migration seeds `user_papers` from each share owner's
attached papers (see migration story above).

### Why additive-only

Academics are jumpy about silent deletions. If a paper disappears from
ORCID (rare, but it happens — author moves a preprint to a journal version
and removes the preprint), the user removes it manually. The cost of the
occasional stale row is much lower than the cost of one user opening MyEtal
to find their thesis missing.

---

## What never happens in this ticket

- We do **not** host PDFs. Link out only — `papers.url` for landing,
  `papers.pdf_url` for the PDF if open-access. Same as the original draft.
  S3 cost + copyright exposure aren't worth it pre-launch. Revisit only if
  a tester explicitly asks for "read inside the app."
- We do **not** do author disambiguation. ORCID gives us one ID = one human;
  that's the v1 floor. Name-based search ("find my works on OpenAlex by
  surname") is deferred — too many false positives for a single-author
  product without a "is this you?" picker, and that picker is its own UX
  rabbit hole.
- We do **not** garbage-collect orphan `papers` rows. A paper with zero
  `share_papers` and zero `user_papers` references is still in the table.
  This is fine until we have millions of papers; revisit later.
- We do **not** sync citation counts in v1. OpenAlex offers them free;
  it's a one-field add later. Defer.

---

## UI changes (Week 2)

### New: Works library page

Web: `/dashboard/works`. Mobile: a new tab in the dashboard.

- List of papers with title / authors / year / venue / source badge
  (orcid / crossref / openalex / manual).
- "Refresh from ORCID" button (only shown if ORCID identity is connected).
  Triggers the background sync (W-S3); button disables + shows progress
  spinner while `orcid_sync_runs.status IN ('queued','running')`. Polls
  `GET /me/works/sync-runs/{id}` every 3s. Shows the
  `{ added, updated, unchanged }` toast on completion.
- "Add by DOI" input — single field, paste DOI or DOI URL, submit.
- Per-paper actions:
  - Hide from my library (sets `user_papers.hidden_at = now()`; never
    deletes the global `papers` row).
  - "Find in shares" — lists all shares this paper appears in (uses
    `share_papers` directly).
  - **NO "edit paper metadata" button in v1 (W-S4).** Editing the global
    `papers` row would silently change every other share that uses the
    same paper. Deferred to a follow-up "global metadata edit with
    audit + propagation" ticket.

### Changed: Share editor

Replace the "add paper" modal's DOI-search-only flow with a tabbed picker:

- **From your library** (default if library is non-empty) — searchable list
  of the user's `user_papers` (excluding `hidden_at IS NOT NULL`),
  multi-select, drag to reorder, attaches via
  `share_papers (share_id, paper_id, added_by=current_user)`.
- **By DOI** — the existing flow, kept for one-offs that don't need to land
  in the library. Behind the scenes this still upserts into `papers` and
  inserts a `share_papers` row, but does NOT add to `user_papers`. (Citing
  a colleague's work in a teaching collection without claiming it as your
  own.)

**Per-share annotation**: the "edit notes" affordance writes to
`share_papers.notes` only — never to the global `papers` row (W-S4).
This is the only "metadata edit" surface available in v1.

**Within-share duplicate guard (W-BL3):** if the user attempts to attach a
paper that's already in this share (DOI match → resolves to the same
`papers.id` → would violate `PRIMARY KEY (share_id, paper_id)`), the
editor shows a toast: "You already have this paper in this share." No
insert is performed.

**Cross-table drag-reorder (W-BL2):** the editor renders papers
(`share_papers`) interleaved with repos/links (`share_items` of kind ∈
{repo, link}) by `position`. Drag-to-reorder must reassign positions
across both tables in one transaction. Backend takes a single
`PATCH /shares/{id}/order` payload of
`[{kind: 'paper'|'repo'|'link', id, position}, ...]` and updates each
table's `position` column accordingly.

### Changed: Item view in shared collections

No changes for visitors. The relational refactor is transparent — they
still see title / authors / year. Per-share `notes` (was on `share_items`,
now on `share_papers`) is schema-equivalent at the API surface.

### Mobile

Same surfaces, list-first UI, same endpoints. Drag-to-reorder on mobile is
a long-press + drag (Expo's `react-native-draggable-flatlist`, already in
the bundle).

---

## Permissions implications (cross-ref to discovery ticket)

The discovery ticket adds `share_collaborators` with an `editor` role
(deferred but planned, see `public-discovery-and-collaboration.md` Phase 5).
The data model in this ticket is designed to accommodate that without
changes:

- An editor adds a paper to a share they don't own. The paper itself isn't
  owned by anyone (it's global), so there's no ownership-transfer question.
- The `share_papers.added_by` row records who attached it. If the editor
  later loses access or deletes their account, the paper stays in the share
  (FK is `SET NULL`).
- The owner can detach any paper from their share regardless of who added
  it. Editor can detach papers they added; cannot detach owner's papers.
  (Permission enforcement is the discovery ticket's Phase 5 job, not this
  ticket's — but the model supports it.)

This is the audit-S8 fix in one paragraph: papers as a global commons,
attribution per share-attachment, no per-user paper ownership at all.

---

## Phasing — slot into the agreed two-week plan ("option 2")

### Week 1 — Foundations (no UI changes yet)

| Task | Effort | Risk | Notes |
|---|---|---|---|
| Schema migration: `papers`, `share_papers`, `user_papers`, `orcid_sync_runs`, backup table | 0.5d | Low | DDL above; migration patterns already exist in repo. Runs BEFORE discovery ticket's social.py removal (W-s7). |
| Walk + migrate existing `share_items` rows (DOI-only dedup, within-share dedup) | 0.5d | Medium | W-BL3 + W-S2 logic; careful seed-data tests around within-share duplicates and DOI-less papers |
| ORCID `/works` fetcher (`services/orcid_works.py`) — paginated, polite-pool aware | 1d | Medium | W-s3: bumped from 0.5d to 1d. Pagination + 429 backoff + per-source concurrency caps; ORCID sandbox sign-off is the gating risk, not the code |
| New: `services/papers.py:lookup_doi_openalex` (W-s6: existing `search_papers` is full-text only) | 0.5d | Low | W-s6: bumped from 0.25d → 0.5d. Crossref already wired via `lookup_doi`; OpenAlex by-DOI is one new function |
| `POST /me/works/sync-orcid` (202 + background task) + `GET /me/works/sync-runs/{id}` | 0.5d | Low | W-S3: glue fetcher → hydrate → upsert + run-tracking endpoint |
| `POST /me/works` (manual DOI add) | 0.25d | Low | Pure reuse of `lookup_doi_openalex` + upsert + `user_papers` insert |
| Tests: migration round-trip (incl. W-BL3 within-share dup), sync idempotency, dedup correctness | 0.25d | Low | W-s3: redistributed 0.25d into the ORCID fetcher. Most-important box on this list |
| **Week 1 total** | **~3.5d** | — | |

### Week 2 — UI surfaces

| Task | Effort | Risk | Notes |
|---|---|---|---|
| Works library page (web, `/dashboard/works`) | 0.5d | Low | List + add-by-DOI + refresh-with-progress (polls sync-runs endpoint) |
| Works library on mobile (list, manual add, refresh-with-progress) | 0.5d | Medium | Net new screen; reuse existing list component patterns |
| Share editor tabbed picker + cross-table drag-reorder (W-BL2) + within-share dup toast (W-BL3) | 0.75d | Medium | Refactor of existing modal. Cross-table drag-reorder is the new bit and the highest week-2 risk. |
| Web tests (Playwright e2e on works flows + reorder) | 0.5d | Low | W-s4: bumped from 0.25d → 0.5d |
| Mobile tests (Detox or unit on the picker + reorder) | 0.25d | Low | |
| **Week 2 total** | **~2.5d** | — | |

**Combined: ~6 focused days, slotted into a 2-week elapsed window** to
allow for ORCID sandbox response time, real-tester ORCID hammering, and
the inevitable migration-edge-case-found-in-staging cycle.

---

## Open questions

1. **Where does the user-to-paper "this is in my library" link live?**
   **RESOLVED (W-S5):** explicit `user_papers (user_id, paper_id, added_via,
   added_at, hidden_at)` join table. DDL above. Migration seeds it from
   legacy share owners.
2. **Does ORCID disconnect wipe imported papers?** No — keep them. The
   user can hide via `user_papers.hidden_at` or remove manually.
   `papers.source` is the **single-value origin** of the row's first
   creation (W-S7) — not a history. If we later want history (e.g. "this
   paper was added via ORCID, then re-confirmed via manual DOI lookup"),
   that's a separate `paper_provenance` log table; out of scope here.
3. **Public works library URL?** e.g. `myetal.app/u/{handle}/works` — out
   of scope v1, but the model supports it cheaply. Aligns with the
   discovery ticket's deferred per-user public profile.
4. **Citation counts** — pull from OpenAlex? Nice-to-have, free, one extra
   field. Defer unless asked.
5. **`papers.title` collation for the fuzzy-dedup index** — `lower(title)`
   handles case but not whitespace, punctuation, or Unicode normalisation.
   The fuzzy index is now used **only by the ORCID sync flow** (W-S2),
   not by the migration, and matches surface as "candidate matches"
   for user review rather than auto-merging — so collation imperfection is
   tolerable for v1.
6. **What does "edit metadata" mean for a global paper?**
   **RESOLVED (W-S4):** v1 has NO global-paper-edit UI. Edits are scoped
   to per-share `share_papers.notes`. This sidesteps the "your edit
   silently changes everyone's view" trap. Global-paper-edit (with audit
   log + propagation rules) is a follow-up ticket.

---

## What this is NOT

- Full-text search across abstracts (Postgres tsvector / pg_trgm — easy
  add later, see discovery ticket's search phase).
- Co-author networks / "people who share with you also share..." — that's
  the discovery ticket's territory.
- Scholar scraping fallback. Permanently out.
- Hosting PDFs. Permanently out for v1.
- Auto-extracting figures / TL;DRs / AI summaries. Out.
- Multi-author share ownership (papers belonging to a lab, not one person)
  — the discovery ticket's collaborator phase covers shared editing; lab
  accounts as a first-class concept are deferred.
- Garbage-collecting orphan `papers` rows. Out.
- Citation counts. Out for v1.

---

## Pre-reqs before starting

- [ ] ORCID sandbox approved + production OAuth registered
- [ ] At least one tester with a real ORCID who'll let us hammer their
      `/works` endpoint
- [ ] Decide whether to do this before or after store launch (recommend
      after — store launch wants stability, this is a feature expansion)
- [x] Open question Q1 resolved (W-S5): `user_papers` table is in scope
      for this ticket's migration.
- [ ] Confirm the discovery ticket's Phase 5 will rely on
      `share_papers.added_by` (it should — this rewrite was triggered by
      that audit finding)
- [ ] **Coordinate Alembic head with discovery ticket's week-1 `social.py`
      removal migration (W-s7).** Recommend: this works ticket's migration
      runs first (creates `papers`, `share_papers`, `user_papers`,
      `orcid_sync_runs`), then the discovery ticket's migration runs second
      (drops `share_favorites`, then `share_comments`, then adds
      `Share.published_at` and `Share.deleted_at` etc.). They don't share
      table dependencies but Alembic enforces a linear head, so order
      explicitly to avoid `down_revision` confusion.

---

## Follow-up cleanup (separate future ticket — W-A2)

**~90 days post-migration**, once we've observed the new schema is stable
in prod, file a small cleanup ticket to:

- Drop the `_migration_share_items_backup` table.
- Remove `'paper'` from the `item_kind` Postgres enum (and from the
  Python `ItemKind` StrEnum) — at this point all paper rows live in
  `share_papers`, the enum value is dead weight and is also a footgun
  (someone might write code that creates a `ShareItem(kind='paper')`
  thinking that still works).
- Audit application code for any leftover `ShareItem(kind='paper')`
  references and delete them.

Tracked here so future-you doesn't forget. Don't do it during this
ticket — leaving the backup table + enum value in place is the whole
reversibility plan.

---

## Cross-references

- `public-discovery-and-collaboration.md` — week-2 surfaces ("similar
  shares" / "who else shares this paper") consume `share_papers` for the
  overlap query. The deferred collaboration phase consumes
  `share_papers.added_by`. The discovery ticket inherits the
  position-namespace rule from W-BL2.
- `public-discovery-and-collaboration-AUDIT.md` S8 — the cross-ticket
  paper-ownership inconsistency that triggered this rewrite. Resolved by
  adopting option A (papers global). Discovery ticket D7 now reflects this
  binding decision.
- `public-discovery-and-collaboration-AUDIT.md` A4 — recommends "papers in
  common" as a v1 similar-shares signal. That's a one-line query against
  `share_papers` once this ticket lands; nothing extra needed here.
- `apps/api/src/myetal_api/services/papers.py` — existing Crossref client
  via `lookup_doi`. We extend with a new `lookup_doi_openalex` (W-s6).
  The existing `search_papers` is full-text only and is NOT what the
  hydration layer calls.
- `apps/api/src/myetal_api/models/share.py` — `ShareItem` shape we are
  partially deprecating (paper kind only).
