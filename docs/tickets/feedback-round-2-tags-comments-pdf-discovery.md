# Feedback Round 2 — Tags, Comments, PDF, Discovery

**Status:** Proposal — for review
**Created:** 2026-05-07
**Owner:** James
**Depends on:** `orcid-import-and-polish.md` (for the Bundle rename being in production), `public-discovery-and-collaboration.md` (Browse + sitemap + tombstone substrate already in place)
**Effort estimate:** ~14–18 days, multi-PR (4 PRs proposed; see "Suggested PR sequence")

---

## TL;DR

Real users came back with five asks: search by author name (already shipped this round), filtering on the public home, tags to express domain (Comp / bacterial / virus), discovery + people-search while logged in, and comments. Plus one comprehension bug — they expected "add to a Bundle" to mean "upload a poster PDF." This plan covers tags, PDF upload, comments, public-home filtering, in-app discovery, and a copy audit. Owner needs to make ~15 decisions before any code. **Google Scholar import is not in this plan and will not happen** — see "What's NOT in this round."

---

## Open questions for owner (READ FIRST)

PDF upload (§1)

1. Storage: **A** Backblaze B2 (already used for backups, S3-compatible, ~$0.005/GB-month) or **B** something else? Recommendation: **A**.
2. Per-file size cap: **10 MB** vs **25 MB** vs **50 MB**? Posters can be 30+ MB if uncompressed. Recommendation: **25 MB**, hard limit, surface a "compress your PDF" hint above the limit.
3. MIME validation strictness: **A** trust client `Content-Type`, **B** sniff first 8 bytes server-side (`%PDF-`) and reject mismatches, **C** also run `pdfinfo` to verify the file parses. Recommendation: **B**.
4. Virus scanning at upload time: **yes** (ClamAV daemon on the Pi) or **no** (accept the risk; researchers, not random web)? Recommendation: **no for v1**, document the deferral.
5. Public-share viewer rendering: **A** inline preview (PDF.js or `<embed>`), **B** thumbnail + download link, **C** download link only? Recommendation: **B** — first-page thumbnail rendered server-side at upload, prominent download button.
6. Copyright disclaimer required at upload time: yes (forced checkbox) or no (terms-page only)? Recommendation: **yes**, single-line acknowledgement that gates the upload button.

Tags (§2)

7. Schema: **A** separate `share_tags` table (normalized, future-proof for "tag pages"), **B** `tags TEXT[]` column on `shares` (simpler, GIN-indexed, cheaper)? Recommendation: **A** — we know we'll want tag landing pages.
8. Canonicalization: **A** lowercased + trimmed only, **B** also strip plurals / synonyms (curated alias table). Recommendation: **A** for v1; punt aliases.
9. Tag source: **A** free-form, autocomplete from existing tags, **B** curated whitelist (50–100 starter tags), **C** hybrid (curated suggested, free-form allowed). Recommendation: **C**.
10. Max tags per share: **5** or **8**? Recommendation: **5**.

Comments (§3)

11. Visibility model: **A** one toggle per comment (`public` vs `share_owner_only`), **B** owner-controlled per-share setting (allow public comments yes/no, all DMs otherwise), **C** drop the user's "public + closed" framing and ship reactions only (📚 / 🔬 / ⭐) for v1. Recommendation: **B** is the cleanest mental model; **C** if owner thinks moderation is too heavy.
12. Notifications: **A** in-app badge only, **B** in-app + email digest (daily), **C** none. Recommendation: **A** for v1, defer email.
13. Authentication required to comment: **yes** (signed in only) or **no** (anon with rate limit + flag-for-review)? Recommendation: **yes**.

Discovery + audit (§4–§6)

14. Public-home filtering deployment: **A** extend the existing `/public/browse` endpoint with optional `tags` + `sort` params (additive), or **B** route it through `/public/search?q=` with empty `q` (the search page already has filters/sort). Recommendation: **A** — keeps SSR home cacheable.
15. User profile pages: **A** `/u/{user_id}` (works today, ugly URL), **B** `/u/{handle}` (requires a `handle` field + uniqueness logic — a separate ticket), **C** punt entirely until @handles ship. Recommendation: **C** — link from share owner-name to a search filtered by `owner_id` instead.

---

## 1. PDF upload as a Bundle item type

### Current state

- `ItemKind` enum in `apps/api/src/myetal_api/models/share.py:24-28` has only `paper`, `repo`, `link`. No `pdf` value, no file storage.
- The add-item flow on web (`apps/web/src/components/add-item-modal.tsx`, 1167 LOC) and mobile (`apps/mobile/app/add-item.tsx`, 1411 LOC) only accepts URLs / DOIs / manual text. No file picker, no upload.
- `ShareItem` columns include `image_url` (intended for paper hero images, not user uploads). No `file_url`, no `file_size`, no `mime_type`.
- Backblaze B2 is already a project dependency (used for Pi backups — see `project_infra.md`). No bucket/credentials wired into the API yet.

### Proposed state

- New `ItemKind.PDF = "pdf"` enum value (additive — no rename, no risk to existing rows).
- New columns on `share_items`: `file_url VARCHAR(2000) NULL`, `file_size_bytes INTEGER NULL`, `file_mime VARCHAR(64) NULL`, `thumbnail_url VARCHAR(2000) NULL`. All nullable so existing rows keep working.
- New endpoint `POST /shares/{id}/items/upload` — multipart, accepts a single PDF, validates, stores to B2, generates a first-page thumbnail (server-side via `pdf2image` + `Pillow` — `pdf2image` requires `poppler-utils` on the Pi; document the install step), returns `{ file_url, thumbnail_url, file_size_bytes }` for the editor to attach to a new ShareItem.
- B2 bucket layout: `myetal-uploads/shares/{share_id}/{item_id}.pdf` and `.../{item_id}-thumb.jpg`. Public-read ACL on the bucket; we don't need signed URLs for v1 (the share is public anyway).
- Public viewer (`apps/web/src/app/c/[code]/page.tsx`) renders PDF items as: thumbnail card → click opens download in new tab. No inline embed in v1 — `<embed>` and PDF.js both have layout/perf issues on mobile browsers.

### Decision points

- **Question 1** — B2 vs alternative.
- **Question 2** — size cap (drives B2 cost ceiling: at 25 MB × 1000 shares × 5 PDFs/share = 125 GB ≈ **$0.62/month**; trivial).
- **Question 3** — MIME validation depth.
- **Question 4** — virus scanning v1 or deferred.
- **Question 5** — viewer rendering (inline / thumbnail / download).
- **Question 6** — copyright checkbox at upload time.

### Mobile considerations

- Use `expo-document-picker` (already a dep — used nowhere yet, but in the supported list). On Android, `type: 'application/pdf'`; on iOS, `type: 'com.adobe.pdf'`.
- Upload progress: native `FormData` + `fetch` handles upload but doesn't expose progress events on RN. Options: **A** `expo-file-system` `uploadAsync` with `onUploadProgress` callback (works on both platforms, supports resumable), **B** show indeterminate spinner only. Recommendation: **A**.
- Flaky-connection handling: client-side retry with exponential backoff (max 3 attempts), then surface a "save and retry later" affordance. Don't block the editor on a stuck upload — leave the item in a `pending_upload` local state and let the user navigate away.

### Effort

~3 days backend (B2 client wrapper, upload route, thumbnail generation, MIME validation, copyright checkbox, tests) + ~1.5 days web UI (file picker in `add-item-modal.tsx`, progress bar, copyright checkbox, viewer thumbnail rendering in `c/[code]/page.tsx`) + ~1.5 days mobile UI (`expo-document-picker` integration, `uploadAsync` progress, retry UI) = **~6 days**.

---

## 2. Tags on shares

### Current state

- No tag schema. No tag UI. No tag filtering.
- `Share.type` (`paper` | `collection` | `bundle` | `grant` | `project`) is structural, not topical — answers "what kind of thing" not "what's it about."
- Search (`apps/api/src/myetal_api/services/share.py:335-460`) matches share name, description, and paper authors via `pg_trgm` + `ILIKE`. It does NOT match a topical signal.

### Proposed state

- New `tags` table — `id UUID PK, slug VARCHAR(50) UNIQUE NOT NULL, label VARCHAR(80) NOT NULL, usage_count INTEGER DEFAULT 0`. `slug` is the canonical lowercased form; `label` is a presentation form ("microbiology" vs "Microbiology").
- New `share_tags` join — `share_id UUID, tag_id UUID, PRIMARY KEY (share_id, tag_id)`. Tags cascade-delete on share delete; tag rows themselves persist.
- Tag editor on share creation: free-form input + autocomplete dropdown over existing tags (top-N by `usage_count`). Comma- or enter-separated. Lowercased + slugified on submit.
- Public discovery filtering: `GET /public/browse?tags=virology,microbiome` returns only shares whose tag set intersects. Multiple tags = OR (more permissive, more useful for discovery; AND would yield empty sets too often).
- Tag autocomplete endpoint: `GET /public/tags?q=vir&limit=10` — anon-readable, hits the `tags.slug` `pg_trgm` index.

### Decision points

- **Question 7** — schema (separate table vs `TEXT[]`).
- **Question 8** — canonicalization depth.
- **Question 9** — free-form vs whitelist vs hybrid.
- **Question 10** — max tags per share.

### Web vs mobile parity

- **Web share editor** (`apps/web/src/components/share-editor.tsx`): tag-input component below `description`, comma-or-enter to commit, autocomplete dropdown, X-to-remove chips. Visual: pill row matching the existing TYPE filter pill style in `apps/web/src/app/dashboard/search/search-results.tsx:202-215`.
- **Mobile share editor** (`apps/mobile/app/(authed)/share/[id].tsx`, 1027 LOC): same input + chip pattern using a `TextInput` + `FlatList` of suggestions. Confirm pattern works at iPhone SE width before scaling up.
- **Public share card surface** — show first 2 tags inline on the card, "+N more" if overflow. Detail screen shows all tags as tappable pills that filter the browse list. Same on web and mobile.

### Effort

~2 days backend (migration, models, autocomplete endpoint, browse filter param, tests) + ~1 day web UI + ~1 day mobile UI = **~4 days**.

---

## 3. Comments on shares

### Current state

- `models/social.py` was deleted in the discovery ticket (D13, see `public-discovery-and-collaboration.md`), specifically because comments / replies / likes were "out of scope, not a social network." We are reversing that choice with explicit user demand.
- No comment schema, no comment UI. The discovery ticket's audit row at D-S-Iss4 enumerated all the cleanup paths — re-introducing comments means a NEW migration and a NEW model file, not resurrecting the deleted one.

### Proposed state

- New `share_comments` table — `id UUID PK, share_id UUID FK, author_user_id UUID FK NOT NULL, body TEXT NOT NULL, visibility share_comment_visibility NOT NULL DEFAULT 'public', created_at, updated_at`. Comments are authored — no anon comments in v1 (Question 13).
- New enum `share_comment_visibility AS ENUM ('public', 'owner_only')`.
- Per-share owner setting `Share.allow_public_comments BOOLEAN NOT NULL DEFAULT true` — owner can disable public comments entirely; closed-only ("DM the curator") still works. This collapses the user's "public AND closed" ask into one toggle owners actually understand.
- Endpoints:
  - `POST /shares/{id}/comments` — body `{ body, visibility }`. Auth required. Rate-limited (10/user/hour). 403 if `visibility='public' AND share.allow_public_comments=false`.
  - `GET /public/c/{short_code}/comments` — anon read. Returns only `visibility='public'` comments.
  - `GET /me/shares/{id}/comments` — owner read. Returns all comments (public + owner-only).
  - `DELETE /shares/{id}/comments/{cid}` — owner can delete any; author can delete own.
  - `POST /shares/{id}/comments/{cid}/report` — anyone signed in can report. Reuses `share_reports` pattern.

### Decision points

- **Question 11** — visibility model (per-comment toggle vs per-share owner setting vs reactions-only).
- **Question 12** — notifications scope.
- **Question 13** — auth required to comment.

### Abuse / moderation

- Rate limit: 10 comments/user/hour, 3 reports/IP/hour anon (already the discovery ticket's `share_reports` rate limit at D16 — reuse).
- Owner-can-delete: any comment on their share, no review.
- Author-can-delete: their own comment, soft-delete with tombstone (`deleted_at`) so threading isn't shattered.
- Report flow: surfaces in the existing `/admin` queue alongside share reports.

### Web vs mobile UX

- **Web** — comment thread inline at the bottom of `apps/web/src/app/c/[code]/page.tsx`, below the items list. Composer above the thread. Visibility toggle radio next to compose: "Visible to everyone" / "Only the curator sees this."
- **Mobile** — separate sheet (`@gorhom/bottom-sheet` if already a dep, otherwise modal screen) opened from a "Comments (N)" button on the share view. Inline thread on phone screens is too cramped.

### "Drop your DOI here" alternative

The user's verbatim suggestion was *"public and closed comments... add to other people's shares."* A reactions-only model (Question 11C) is genuinely cheaper and arguably better-aligned to the QR-poster wedge — a viewer who scanned a poster doesn't want to write a comment, they want to express interest. **Owner should pick one for this round; do not ship both.**

### Effort

If full comments (Q11A or Q11B): ~2.5 days backend + ~1.5 days web + ~1.5 days mobile = **~5.5 days**. If reactions-only (Q11C): ~1 day backend + ~0.5 day web + ~0.5 day mobile = **~2 days**.

---

## 4. Public-shares filtering on home

### Current state

- Web home `apps/web/src/app/page.tsx` is a marketing-first landing. `SavedSharesSection` is the only dynamic surface; no public browse grid.
- The search page (`apps/web/src/app/dashboard/search/page.tsx`, then `search-results.tsx`) is currently nested under `/dashboard/` (now requires sign-in). It calls `/public/browse` for trending+recent and `/public/search?q=` for typed search. It already has type-filter pills (line 202-231) and a sort dropdown (relevance / newest / most_items).
- `/public/browse` (`apps/api/src/myetal_api/api/routes/search.py:27-48`) returns `{ trending, recent, total_published }`. **Cached at the CDN edge with `s-maxage=300`** — any new query params will fragment the cache key.

### Proposed state

- Public anonymous browse moves out of `/dashboard/search` and gets a stable home at `/browse` (web). Existing `/dashboard/search` stays for authed users (it's the same component; just two routes pointing at it).
- `/public/browse` gains optional `?tags=` (comma-list, OR semantics) and `?sort=` (`recent` | `popular`) params. Cache key includes these; high-traffic combos (no params; one popular tag; sort=recent) stay edge-cached.
- The home page (`apps/web/src/app/page.tsx`) gets a "Browse public collections" section above the feature grid with: tag chip row (top 8 tags by `usage_count`) + a snapshot of 6 trending shares. Click a tag → `/browse?tags=<slug>`.
- Mobile `apps/mobile/app/(authed)/discover.tsx` already exists and matches this shape (tag chip row at top, then trending + recent sections). The gap: no tag filter param plumbing in `useBrowse`, no tap-to-filter on cards. Add `tags` param to `useBrowse`, add a TagPill row above the search entry, persist filter in screen state (don't urlencode — mobile route stack handles it).

### Decision points

- **Question 14** — extend `/public/browse` with params vs reroute through `/public/search`.

### Effort

~1 day backend (browse-filter params, cache-key plumbing, tag-popularity sort) + ~1 day web (home page browse section + new `/browse` route) + ~0.5 day mobile (extend Discover) = **~2.5 days**. **Gated on Tags landing first.**

---

## 5. Public discovery while logged in

### Current state

- Web: once logged in, `/dashboard` is the landing. There is **no link** from the dashboard to public browse / search. Authed users can only reach the search page by typing the URL or coming through the marketing home.
- Web `/dashboard/layout.tsx` is the nav surface; auditing it after the rename round will tell us where to slot a "Browse" link.
- Mobile: Discover tab (`apps/mobile/app/(authed)/discover.tsx`) is already in the bottom-nav. **Mobile is ahead of web here.**
- "Search for other users" — does not exist anywhere. Search currently scopes to shares + papers + paper-authors (the new author-search shipped this round). Users-as-entities are not a search target.

### Proposed state

- **Web nav** — add a "Browse" link to `/dashboard/layout.tsx`'s top-nav, alongside "Library" / "Shares" / "Profile." Points at `/browse` (the public route from §4).
- **Search scope expansion** — `/public/search` already covers shares + paper authors. Add a `users` result block: `/public/search?q=alice` returns top-N matching `User.name` rows whose user has at least one published share (non-published-share users are not surfaced — privacy default). Result block renders below shares; tappable card links to a per-user view.
- **Per-user view** — for v1, **no `/u/{handle}` route**. Owner-name links route to `/browse?owner_id={user_id}` (Question 15C — punts the URL-aesthetics decision until handles ship). Add `owner_id` to `/public/browse` filters. The browse page header shows the owner's name + their share count. This costs almost nothing and unblocks the "see other users' shares" ask without committing to handle uniqueness.
- **Follow / favorite users** — explicitly OUT for this round. Flag for the soft-network ticket (vocabulary already locked at `connection`, see discovery ticket D18).

### Decision points

- **Question 15** — profile page route shape (`/u/{user_id}` vs `/u/{handle}` vs punt).

### Effort

~0.5 day web nav (Browse link, dashboard layout) + ~1 day backend (user search block, owner_id browse filter, owner-card serializer) + ~1 day web `/browse?owner_id=` rendering + ~0.5 day mobile equivalent (Discover already has the structure; just plumb owner_id through `useBrowse`) = **~3 days**.

---

## 6. Poster terminology cleanup beyond the rename

### Current state

The DB-level + UI-level rename is shipped this round (migration `0011_rename_share_kind_poster_to_bundle.py` + the `ShareType.BUNDLE` enum value at `apps/api/src/myetal_api/models/share.py:19`). But "poster" is still used colloquially in product copy where it shouldn't confuse — and in some places where it should now be revisited:

- `apps/web/src/app/page.tsx:85` — *"A paper. A reading list. A poster you're standing in front of."* This is fine — it's describing the **physical artifact** you stick a QR on, not the type of share. **Keep.**
- `README.md:3` — *"a scannable QR for their poster, slides, or CV."* Same as above. **Keep.**
- `docs/tickets/works-library-and-orcid-sync.md:734` — *"For preprints, posters, grey literature -- anything not in Crossref / OpenAlex."* This is doc-internal. **Keep.**
- The user's comprehension bug (*"add poster, then add item options are only paper, repo, etc via links or manual"*) is a flow problem, not a copy problem — fixed by §1 (PDF upload as a Bundle item type). The Bundle rename alone doesn't fix it.

### Proposed audit checklist

- [ ] After the Bundle rename ships, grep `apps/web/`, `apps/mobile/`, `README.md` for `poster` (case-insensitive). Each hit must be classified as **physical artifact** (keep) vs **type of share** (must already be "bundle" post-rename). Fail the audit if any "type of share" hits remain.
- [ ] Check the demo flow `apps/web/src/app/demo/demo-tour.tsx` — it walks new users through creating their first share. After the rename, does the demo still describe the Bundle type with terminology that matches what the user sees in the editor? Run it, screen-record, log discrepancies.
- [ ] Onboarding empty state on `apps/web/src/app/dashboard/page.tsx` and mobile equivalent — do they explain what a Bundle is in a way that pre-empts the *"is poster a PDF upload?"* question? Almost certainly no. Add a one-liner: *"A bundle gathers papers, repos, and PDFs behind one QR."* (The "and PDFs" half lands in §1.)

### Effort

~0.5 day audit + copy edits across both platforms.

---

## What's NOT in this round

- **Google Scholar import.** Scholar has no official API. All Scholar scrapers (`scholarly`, `serpapi`'s Scholar engine) are either against ToS or commercial paid endpoints with brittle CSS selectors that break monthly. The cost-of-maintenance + ToS exposure is not justified given that ORCID + Crossref + OpenAlex already cover the same papers via DOI. Document this in user-facing FAQ once Round 2 ships: *"We don't import from Google Scholar — Scholar has no API. We do import from ORCID; if your works are in ORCID, they're already importable."*
- **Account linking** — Phase B, blocked on Better Auth migration (already in `better-auth-migration.md`).
- **`@handle` syntax + uniqueness** — punted (Question 15C). Owner-name search routes to `?owner_id=`. Real handles ship in their own ticket, with profile pages.
- **Following users / favoriting users** — soft-network ticket (discovery D18). Flagged here, not built.
- **Email notifications for comments** — Question 12 punts to in-app only.
- **Inline PDF preview in the public viewer** — Question 5 picks thumbnail+download; PDF.js / `<embed>` revisited if users ask.
- **Virus scanning at upload time** — Question 4 punts to v2; document the deferral.
- **Reactions in addition to comments** — Question 11 picks one, doesn't ship both.
- **Tag aliases / synonyms / plural-stripping** — Question 8 punts to v2; lowercased + trimmed only.
- **AND-semantics tag filter** — first version is OR only; AND is more code and less useful for discovery at our scale.
- **Hand-edited `tags.label` distinct from `slug`** — Question 8 keeps it auto (label = title-case of slug).

---

## Suggested PR sequence

1. **PR-A — Tags.** Schema, autocomplete endpoint, browse-filter param, web + mobile editor UIs, web + mobile share-card surfaces. Unblocks PR-B's filtering UI. Independent of comments / PDF. **Land first.** ~4 days.
2. **PR-B — Public-home filtering + in-app discovery.** Builds on PR-A. Adds `/browse` route on web, "Browse" nav link, tag chip row on the home page, mobile Discover tag-filter plumbing, user-search block, `owner_id` filter. ~5.5 days.
3. **PR-C — PDF upload as Bundle item type.** Independent of PR-A and PR-B. Backend (B2 wiring, upload route, thumbnail), web file picker + viewer thumbnail, mobile `expo-document-picker` + progress. ~6 days.
4. **PR-D — Comments OR reactions (whichever Question 11 picks).** Independent of all above; keeps it isolated so it can ship or be pulled if moderation concerns surface late. ~5.5 days for comments OR ~2 days for reactions.

Plus a half-day **Audit PR** (§6) folded into PR-A — runs the rename grep after the rename hits main, fixes any "type of share" stragglers, updates the demo + onboarding empty-state copy.

Total: **~14–18 days** depending on Question 11 outcome and PR overlap.

---

## Acceptance checklist

TBD after open questions are answered.
