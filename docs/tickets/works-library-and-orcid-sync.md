# Ticket: Works Library + ORCID Sync

**Status:** Draft / not started
**Owner:** James
**Created:** 2026-04-27
**Last revised:** 2026-04-26 (post-audit rewrite — see "What changed in this revision")
**Estimate:** ~2 weeks elapsed, ~5 focused days of work, split across two phases
**Depends on:** ORCID OAuth (already in plan, pending sandbox approval)
**Related:** `public-discovery-and-collaboration.md` (Phase 4 of that ticket consumes the `share_papers` table this one builds; Phase 5's editor role consumes `share_papers.added_by`)

---

## What changed in this revision

The original draft had `papers.owner_user_id` — every paper belonged to one
user. The discovery-ticket audit (`public-discovery-and-collaboration-AUDIT.md`,
section S8) called that out as a blocker for editor-role collaboration: an
editor adding a paper to my share would either own it themselves or force a
clone, and neither story is clean. This rewrite addresses that by making
**papers global** (audit S8 option A): one row per paper for the whole platform,
deduplicated on DOI, and the "who put this in this share" relationship moves
onto the join row (`share_papers.added_by`).

Other changes in this pass:

- Phasing aligned with the agreed two-week plan (option 2): foundations in
  week 1, UI surfaces in week 2.
- Migration story made explicit and reversible — original `share_items`
  payloads stashed in a backup table so the down migration can rehydrate.
- Author disambiguation explicitly deferred, ORCID-or-DOI is the v1 floor.
- "Source of paper data" section added so it's clear Google Scholar is
  permanently out, not "later."
- Cross-references to the discovery ticket's Phase 4 + Phase 5 added so the
  data model decisions are legible to the agent picking up that work.

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
| OpenAlex `/works` | Fallback hydration when Crossref 404s; future citation counts | Existing: `services/papers.py:search_papers` (extend with by-DOI) |
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
CREATE TABLE papers (
    id              uuid        PRIMARY KEY,
    doi             text        NULL,           -- normalised, lowercase, bare 10.x/y
    openalex_id     text        NULL,
    orcid_put_code  text        NULL,           -- backup dedup key when DOI is missing
    title           text        NOT NULL,
    authors         text        NULL,           -- denormalised "Smith J, Jones A, ..."
    year            integer     NULL,
    venue           text        NULL,           -- journal / conference name
    abstract        text        NULL,
    url             text        NULL,           -- canonical landing page
    pdf_url         text        NULL,           -- if known + open-access (link only, not hosted)
    source          text        NOT NULL,       -- enum-like: orcid|crossref|openalex|manual
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
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

-- Fuzzy fallback dedup (preprints with no DOI, no put-code) — used by the
-- migration and by the ORCID sync upsert. Not a unique constraint; the
-- application-side upsert checks (lower(title), year) before inserting.
CREATE INDEX ix_papers_lower_title_year ON papers (lower(title), year);
```

SQLAlchemy shape (mirrors the patterns in `models/share.py`):

```python
class Paper(Base, TimestampMixin):
    __tablename__ = "papers"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)
    openalex_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    orcid_put_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    authors: Mapped[str | None] = mapped_column(Text, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    venue: Mapped[str | None] = mapped_column(String(500), nullable=True)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    pdf_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
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

One Alembic revision. Forward path:

1. Create `papers`, `share_papers`, `_migration_share_items_backup` tables
   and their indexes.
2. For every `share_items` row where `kind='paper'`:
   1. Snapshot the row into `_migration_share_items_backup` (id + JSON
      payload of all columns).
   2. Resolve to a `papers.id`:
      - If `doi` is present and non-empty: `INSERT ... ON CONFLICT (doi) DO
        UPDATE SET updated_at = now() RETURNING id` against the normalised
        DOI. Same DOI across shares maps to the same paper.
      - If `doi` is null: lookup by `(lower(title), year)`. If a match
        exists, reuse it (fuzzy — preprint sharers across labs, theses).
        Otherwise insert a new row with `source='manual'` (we don't know
        better at migration time).
   3. Insert `share_papers (share_id, paper_id, position, notes, added_by,
      added_at)` — `added_by` set to `share.owner_user_id` (best guess for
      legacy rows; nullable in the schema, but we have a value here).
   4. Delete the original `share_items` row.
3. Leave `share_items` in place — it still serves `kind in (repo, link)`.

Down path:

1. For every row in `_migration_share_items_backup`, re-insert into
   `share_items` from the JSON payload. Position, notes, ids preserved.
2. Delete the corresponding `share_papers` rows.
3. Drop `papers`, `share_papers`. Drop the backup table.

The down path is allowed to be ugly. It exists so that if week-1 ships and
something is catastrophically wrong, we can roll back without losing data.
It is **not** intended for routine dev use after this migration lands.

### Migration tests (week 1, mandatory)

- Round-trip on a seed dataset that includes:
  - Same DOI in two shares owned by two different users → one `papers` row,
    two `share_papers` rows.
  - Same DOI in two shares owned by the same user → one `papers` row, two
    `share_papers` rows.
  - Paper without DOI but with matching `(lower(title), year)` across two
    shares → one `papers` row, two `share_papers` rows.
  - Paper without DOI and unique title → one new `papers` row.
  - `kind='repo'` and `kind='link'` rows → unchanged in `share_items`,
    nothing in `papers`.
- Idempotency: running the migration twice on a partially-migrated DB does
  not duplicate rows. (Achieved by `ON CONFLICT` and by the backup table
  being a deterministic snapshot of the source rows.)
- Down then up: `_migration_share_items_backup` rehydrates, then re-running
  forward produces the same `papers` / `share_papers` shape.

---

## Sync flow

Two entry points. Both **additive only** — never auto-delete. Re-syncs are
**idempotent on DOI (preferred) or ORCID put-code (fallback)** and return
explicit `{ added, updated, unchanged }` counts so the UI can say "We
imported 3 new papers, refreshed 2."

### A. ORCID auto-sync (post-login + manual refresh)

Triggered:

- Once on first ORCID OAuth connect (background job, non-blocking).
- On user click of "Refresh from ORCID" in the works library page.

```
POST /me/works/sync-orcid
  → fetches /v3/{orcid}/works (paginated through summary pages)
  → for each work summary:
      - if DOI present: hydrate via Crossref (fallback OpenAlex on 404)
      - else: rely on ORCID's own minimal metadata + put-code dedup
  → upsert into papers (dedup precedence: doi > openalex_id > orcid_put_code > (lower(title), year))
  → insert nothing into share_papers — sync only populates the user's library;
    placing into shares is an explicit user action
  → returns { added: 12, updated: 3, unchanged: 47 }
```

Note: ORCID's `/works` endpoint returns sparse metadata (title + put-code
only at the summary level). Crossref/OpenAlex hydration is what gives us
authors / year / venue. Treat the ORCID call as the **list** and Crossref as
the **detail**.

### B. Manual add by DOI (any user)

For Google/GitHub-only users, or for papers ORCID doesn't have (preprints
not yet linked, papers from before the user got an ORCID).

```
POST /me/works
  body: { doi: "10.1038/..." }
  → resolves via Crossref → OpenAlex fallback (existing services/papers.py)
  → upserts paper, returns it
```

### Per-user "library" semantics

There is no `users.library` table. A user's library is **the set of papers
they have either (a) imported via ORCID sync or (b) manually added by DOI.**
We need to record that link somewhere — see open question Q1 below. The
simplest answer is a thin `user_papers (user_id, paper_id, added_via,
added_at)` join. Decide before week 1 starts.

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
  Shows the `{ added, updated, unchanged }` toast on completion.
- "Add by DOI" input — single field, paste DOI or DOI URL, submit.
- Per-paper actions: edit metadata (title/authors only — sources of truth
  stay where they came from), remove from library, "find in shares"
  (lists all shares this paper appears in; uses `share_papers` directly).

### Changed: Share editor

Replace the "add paper" modal's DOI-search-only flow with a tabbed picker:

- **From your library** (default if library is non-empty) — searchable list
  of the user's `user_papers`, multi-select, drag to reorder, attaches via
  `share_papers (share_id, paper_id, added_by=current_user)`.
- **By DOI** — the existing flow, kept for one-offs that don't need to land
  in the library. Behind the scenes this still upserts into `papers` and
  inserts a `share_papers` row, but does NOT add to `user_papers`. (Citing
  a colleague's work in a teaching collection without claiming it as your
  own.)

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
| Schema migration: `papers`, `share_papers`, backup table | 0.5d | Low | DDL above; migration patterns already exist in repo |
| Walk + migrate existing `share_items` rows | 0.5d | Medium | Fuzzy `(lower(title), year)` fallback needs careful seed-data tests |
| ORCID `/works` fetcher (`services/orcid_works.py`) | 0.5d | Medium | Pagination + retry; ORCID sandbox sign-off is the gating risk, not the code |
| Crossref/OpenAlex DOI hydration (extend `services/papers.py`) | 0.25d | Low | Crossref already wired; OpenAlex by-DOI is one new function |
| `POST /me/works/sync-orcid` endpoint | 0.25d | Low | Glue: fetcher → hydrate → upsert |
| `POST /me/works` (manual DOI add) | 0.25d | Low | Pure reuse of `lookup_doi` + upsert |
| Tests: migration round-trip, sync idempotency, dedup correctness | 0.5d | Low | Most-important box on this list |
| **Week 1 total** | **~2.75d** | — | |

### Week 2 — UI surfaces

| Task | Effort | Risk | Notes |
|---|---|---|---|
| Works library page (web, `/dashboard/works`) | 0.5d | Low | List + add-by-DOI + refresh button |
| Works library on mobile (list, manual add, refresh) | 0.5d | Medium | Net new screen; reuse existing list component patterns |
| Share editor tabbed picker (from-library / by-DOI) | 0.5d | Low | Refactor of existing modal |
| Web tests (Playwright happy-path on works flows) | 0.25d | Low | |
| Mobile tests (Detox or unit on the picker) | 0.25d | Low | |
| **Week 2 total** | **~2d** | — | |

**Combined: ~4.75 focused days, slotted into a 2-week elapsed window** to
allow for ORCID sandbox response time, real-tester ORCID hammering, and
the inevitable migration-edge-case-found-in-staging cycle.

---

## Open questions

1. **Where does the user-to-paper "this is in my library" link live?** Two
   options: (a) a `user_papers (user_id, paper_id, added_via, added_at)`
   join table — explicit, easy to query "my library." (b) Derive it from
   `share_papers.added_by` plus a "library" pseudo-share owned by the user
   — clever, but conflates two concepts. **Recommend (a)**, decide before
   week 1 starts. Migration would seed `user_papers` from the legacy
   `share_items` rows during the same Alembic revision.
2. **Does ORCID disconnect wipe imported papers?** No — keep them, mark
   `source` history. User can delete manually. (Carried over from original
   draft; still right.)
3. **Public works library URL?** e.g. `myetal.app/u/{handle}/works` — out
   of scope v1, but the model supports it cheaply. Aligns with the
   discovery ticket's per-user public profile.
4. **Citation counts** — pull from OpenAlex? Nice-to-have, free, one extra
   field. Defer unless asked.
5. **`papers.title` collation for the fuzzy-dedup index** — `lower(title)`
   handles case but not whitespace, punctuation, or Unicode normalisation.
   Probably fine for v1 (most preprint titles are stable strings); revisit
   if we see duplicate-paper bugs.
6. **What does "edit metadata" mean for a global paper?** If user A edits
   the title, does user B see it? Recommend: yes, edits are global, with
   an audit log added later if abuse appears. Pre-launch this is fine; one
   user controlling their own paper's metadata is the common case.

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
- [ ] Resolve open question Q1 (`user_papers` table yes/no) before writing
      the migration
- [ ] Confirm the discovery ticket's Phase 5 will rely on
      `share_papers.added_by` (it should — this rewrite was triggered by
      that audit finding)

---

## Cross-references

- `public-discovery-and-collaboration.md` — Phase 4 ("similar shares" /
  "who else shares this paper") consumes `share_papers` for its overlap
  query. Phase 5 (collaborators) consumes `share_papers.added_by`.
- `public-discovery-and-collaboration-AUDIT.md` S8 — the cross-ticket
  paper-ownership inconsistency that triggered this rewrite. Resolved by
  adopting option A (papers global).
- `public-discovery-and-collaboration-AUDIT.md` A4 — recommends "papers in
  common" as a v1 similar-shares signal. That's a one-line query against
  `share_papers` once this ticket lands; nothing extra needed here.
- `apps/api/src/myetal_api/services/papers.py` — existing Crossref +
  OpenAlex client, reused as the hydration layer.
- `apps/api/src/myetal_api/models/share.py` — `ShareItem` shape we are
  partially deprecating (paper kind only).
