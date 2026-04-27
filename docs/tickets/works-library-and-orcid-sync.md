# Ticket: Works Library + ORCID Sync

**Status:** Draft / not started
**Owner:** James
**Created:** 2026-04-27
**Estimate:** 2–3 focused days
**Depends on:** ORCID OAuth (already in plan, pending sandbox approval)

---

## The user-facing pitch

> Sign in. Connect your ORCID. We pull your publications. When you create
> a share, you tick the papers you want — no DOI typing, no manual entry.
> The same paper can live in many shares.

## Why not "Google Scholar sync"?

Google Scholar has no API. The realistic options are:

- **Scrape it** — works until Google's anti-bot kicks in (days to weeks), then captchas, then prod IP banned. Against ToS. Indefinite maintenance burden.
- **SerpAPI's Scholar wrapper** — paid ($50/mo for 5k queries), legal grey area, papers over Google's blocks for you.
- **Use ORCID + OpenAlex + Crossref instead** — legit APIs, free, structured data, designed for this. Same outcome from the user's POV.

**Decision:** frame this as "your works library, populated from ORCID" rather than "Scholar sync." Same UX, real foundation. Revisit if a tester explicitly demands Scholar (unlikely — academics know ORCID).

---

## Current data model (what we're changing)

`apps/api/src/myetal_api/models/share.py`:

- `Share` — owner, name, type, items[]
- `ShareItem` — embedded paper data (title, doi, authors, year, url, scholar_url, image_url, notes) + position + kind enum (paper / repo / link)

Paper data is **denormalised into each share_item row.** Same paper in two shares = two rows with duplicated DOI/title/authors. Fine for "scan poster, get list," wrong for "library of MY papers, drop into many shares."

## Target data model

Add two new tables, keep `share_items` for non-paper kinds.

```
papers
├── id (uuid, pk)
├── owner_user_id (uuid, fk users)
├── doi (string, nullable, unique per owner)
├── openalex_id (string, nullable)
├── title (text)
├── authors (text)               -- denormalised author list, source of truth
├── year (int, nullable)
├── venue (string, nullable)     -- journal / conference name
├── abstract (text, nullable)
├── url (string, nullable)       -- canonical landing page
├── pdf_url (string, nullable)   -- if known + open-access
├── source (enum: orcid|openalex|crossref|manual)
├── source_record_id (string)    -- e.g. ORCID put-code, for re-sync
├── created_at, updated_at

share_papers (join)
├── share_id (uuid, fk shares)
├── paper_id (uuid, fk papers)
├── position (int)
├── notes (text, nullable)       -- per-share annotation
└── PK (share_id, paper_id)
```

`ShareItem` stays for kind in (`repo`, `link`) — non-paper stuff still embeds.

**Unique constraint:** `(owner_user_id, doi)` where doi is non-null — same DOI for the same user is one paper. ORCID put-code provides backup dedup key for works without DOIs (preprints, theses).

---

## Migration story

Alembic revision walks existing `share_items` rows where `kind='paper'`:

1. For each row, upsert into `papers` (owner = share.owner, dedupe on `(owner, doi)` — fall back to `(owner, title, year)` if no DOI).
2. Insert a `share_papers` join row pointing at the new paper.
3. Delete the original `share_items` row.

Reversible: store the original `share_items` payload as JSON sidecar on the migration so a downgrade can rehydrate.

**Tests required:**
- Migration round-trip on a seed dataset (papers in 0, 1, multiple shares; with/without DOI; same DOI different owners)
- Downgrade restores the embedded form

---

## Sync flow

Two entry points:

### A. ORCID auto-sync (post-login)

Triggered on first ORCID OAuth connect, and via a manual "refresh from ORCID" button on the works library page.

```
POST /me/works/sync-orcid
  → fetches /v3/{orcid}/works (paginated)
  → for each work: hydrate via DOI from Crossref/OpenAlex if available
                    (ORCID's own metadata is sparse — title + put-code only)
  → upsert into papers table (dedup on doi or put-code)
  → returns { added: 12, updated: 3, unchanged: 47 }
```

### B. Manual add by DOI (any user)

For Google/GitHub-only users, or papers ORCID doesn't have.

```
POST /me/works
  body: { doi: "10.1038/..." }
  → resolves via Crossref → OpenAlex fallback
  → upserts paper, returns it
```

Both flows are **additive only.** Never auto-delete. If a paper disappears from ORCID, the user removes it manually — academics are jumpy about silent deletions.

---

## UI changes

### New: Works library page (`/dashboard/works`)
- List of papers with title / authors / year / venue / source badge
- "Refresh from ORCID" button (only shown if ORCID connected)
- "Add by DOI" input
- Per-paper: edit, delete, "find in shares" link

### Changed: Share editor
- Replace the "add paper" modal's DOI-search-only flow with a tabbed picker:
  - **From your library** (default if library non-empty) — searchable list, multi-select, drag to reorder
  - **By DOI** (existing flow, kept for one-offs that don't need to land in the library)
- Existing manual add stays — sometimes you want a paper in a share without it being "yours" (citing a colleague's work in a teaching collection)

### Changed: Item view in shared collections
No changes for visitors. The relational refactor is transparent — they still see title / authors / year. The only surface change is per-share `notes` (was on `share_items`, now on `share_papers`) — schema-equivalent.

---

## Author disambiguation

ORCID-first sidesteps it entirely (one ORCID = one human). If we ever offer "search OpenAlex by name" for users without ORCID:
- Show top 5 candidate author profiles with "is this you?" picker
- Cache the chosen `openalex_author_id` on `User`
- Don't auto-import — only "show me works under this profile, I'll tick what's mine"

Out of scope for v1. ORCID-or-DOI is enough.

---

## PDF storage

**Decision: link out, do not host.**

- Scholar/ORCID/OpenAlex give us a landing page URL, sometimes a PDF URL
- Store both, render "View paper" + "View PDF" (where present)
- No S3, no copyright questions
- Revisit only if a tester explicitly asks for "read inside the app"

---

## Difficulty breakdown

| Piece | Effort | Risk |
|---|---|---|
| `papers` + `share_papers` tables + Alembic migration | 0.5d | Low — mechanical, well-tested patterns |
| ORCID `/works` fetcher + Crossref/OpenAlex hydration | 0.5d | Low — Crossref already wired in `services/papers.py` |
| Sync endpoint + idempotent upsert | 0.5d | Low |
| Works library page (web + mobile) | 1d | Medium — net new UI, mobile especially |
| Share editor "pick from library" tab | 0.5d | Low — refactor of existing modal |
| Tests + migration verification | 0.5d | Low |
| **Total** | **~3.5d** | — |

---

## Open questions

- Do we want share-level paper ordering to persist across re-syncs? (Yes — `share_papers.position` is independent of `papers.created_at`.)
- Should ORCID disconnect wipe imported papers? (No — keep them, mark `source` history. User can delete manually.)
- Public works library URL? (e.g. `myetal.app/me/{handle}/works` — out of scope v1, but model supports it cheaply.)
- Citation counts — pull from OpenAlex? (Nice-to-have, free, one extra field. Defer unless asked.)

---

## Out of scope (record so we don't scope creep later)

- Full-text search across abstracts (Postgres tsvector — easy add later)
- Co-author networks / "people who share with you also share..."
- Scholar scraping fallback
- Hosting PDFs
- Auto-extracting figures / TL;DRs
- Multi-author share (papers belonging to a lab, not one person)

---

## Pre-reqs before starting

- [ ] ORCID sandbox approved + production OAuth registered
- [ ] At least one tester with a real ORCID who'll let us hammer their `/works` endpoint
- [ ] Decide whether to do this before or after store launch (recommend after — store launch wants stability, this is a feature expansion)
