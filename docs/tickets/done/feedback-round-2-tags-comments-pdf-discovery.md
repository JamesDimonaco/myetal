# Feedback Round 2 — Tags, Comments, PDF, Discovery

**Status:** Approved — all questions answered, PR-A can start
**Created:** 2026-05-07
**Last updated:** 2026-05-07 (Q11 locked by owner — full comments per Q11-B)
**Owner:** James
**Depends on:** `orcid-import-and-polish.md` (Bundle rename in production), `public-discovery-and-collaboration.md` (Browse + sitemap + tombstone substrate already in place)
**Related (split out):** `pdf-virus-scanning-future.md` — virus scanning deferred from PR-C, captured as a separate future ticket per owner direction. `discovery-and-handles-future.md` — `/u/{handle}` profiles deferred from Q15. `email-notifications-future.md` — comment email digests deferred from Q12.
**Effort estimate:** ~14–18 days, multi-PR (4 PRs proposed; see "Suggested PR sequence")

---

## TL;DR

Real users came back with five asks: search by author name (already shipped this round), filtering on the public home, tags to express domain (Comp / bacterial / virus), discovery + people-search while logged in, and comments. Plus one comprehension bug — they expected "add to a Bundle" to mean "upload a poster PDF."

This round adds tags, PDF upload (**Cloudflare R2**, S3-compatible, zero egress fees, ~$0.015/GB-month), comments (full text, owner-controlled visibility per Q11-B), public-home filtering, in-app discovery, a copy audit, and a new dedicated **empty-states pass** (§7) that catches the moments where the product silently fails the new user. All decisions locked. The four UploadThing-arch questions (Q16–Q19) are resolved by the R2 decision — there's no SDK asymmetry between web and mobile, and the credentials live on FastAPI alone.

**Google Scholar import is not in this plan and will not happen** — see "What's NOT in this round."

---

## Open questions (READ FIRST)

### Locked (owner answered, do not revisit without new evidence)

- **Q1 Storage** → **Cloudflare R2.** Owner initially provisioned an `UPLOADTHING_TOKEN`, then asked for alternatives ("*give me other options uplaod thins is just something i know and maybe there are better otpins*"). Compared B2, R2, UploadThing, Vercel Blob, S3, and self-hosting on the Pi. Owner picked R2 for: zero egress fees (matters for a download-heavy app), $0.015/GB-month (~10x cheaper than UploadThing at scale), S3-compatible (use `boto3`, no proprietary SDK), and works identically from web + mobile via presigned URLs. Bucket created (`myetal-uploads`), public-dev URL enabled, S3 token issued, credentials saved to local + Pi `.env`. The `UPLOADTHING_TOKEN` is no longer used and can be removed.
- **Q2 Per-file size cap** → **25 MB hard limit.** Surface a "compress your PDF" hint above the limit.
- **Q3 MIME validation** → **B (sniff first 8 bytes server-side, expect `%PDF-`).** Reject mismatches before persisting.
- **Q4 Virus scanning v1** → **Deferred.** Captured as a separate future ticket: `docs/tickets/pdf-virus-scanning-future.md`.
- **Q5 Public-share viewer rendering** → **B (server-side first-page thumbnail + prominent download button).**
- **Q6 Copyright disclaimer at upload** → **Yes**, single-line acknowledgement that gates the upload button.
- **Q7 Tag schema** → **A (separate `share_tags` join table).**
- **Q8 Tag canonicalisation** → **A (lowercased + trimmed only, no aliases v1).**
- **Q9 Tag source** → **C (hybrid — curated suggested, free-form allowed).**
- **Q10 Max tags per share** → **5.**
- **Q12 Comment notifications** → **A (in-app badge only).** Owner confirmed: *"in app only"*. Email digests captured as a future ticket (`email-notifications-future.md`).
- **Q13 Auth required to comment** → **yes (signed-in only).** Owner confirmed.
- **Q14 Public browse endpoint shape** → **A (extend `/public/browse` with optional `tags` + `sort` params).** Owner confirmed.
- **Q15 User profile route** → **C (punt; route owner-name links to `/browse?owner_id=`).** Owner: *"whatever you think is best is fine by me"*. Real `/u/{handle}` profiles captured as a future ticket (`discovery-and-handles-future.md`).
- **Q11 Comments visibility** → **B (per-share owner setting `Share.allow_public_comments BOOLEAN`).** Owner confirmed: *"option B — Owner-controlled per-share setting (cleanest)... it's a nice to have for sure"*. Reactions-only (C) was on the table as cheaper but the owner's read is that comments are nice-to-have-not-must-have, not that they should be skipped. Owner picks one toggle per share; comment thread defaults to public when the toggle is on.

### Resolved by the R2 decision (was Q16–Q19, now collapsed)

The vendor swap from UploadThing to Cloudflare R2 collapses what were four open architectural questions into a single coherent design. R2 is S3-compatible, has no proprietary SDK, and works identically from web and mobile — so the asymmetries that drove Q16–Q19 evaporate.

- ~~**Q16~~ Upload pipeline → presigned POST policies from FastAPI.** Backend uses `boto3.generate_presigned_post()` against the R2 S3 endpoint to issue 5-minute presigned POST policies (with `content-length-range` baked in — see Bug 5 in §1). Web and mobile both `POST` multipart/form-data directly to R2. After upload, the client calls a record endpoint on FastAPI to create the `ShareItem`. Resolved.
- ~~**Q17~~ Where the credentials live → FastAPI only.** `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` live in `apps/api/.env` (already saved) and the Pi prod `.env`. Web and mobile never see them. The original `UPLOADTHING_TOKEN` on the Next.js app can be removed.
- ~~**Q18~~ Mobile strategy → multipart `POST` against the presigned URL.** Same as web. `expo-document-picker` produces a file URI, `expo-file-system` `uploadAsync` (`uploadType: MULTIPART`, `fieldName: 'file'`) POSTs it to R2 with progress events. No SDK to install on RN.
- ~~**Q19~~ Thumbnail pipeline → synchronous on the API after upload completion.** Same recommendation as before. Client confirms upload to FastAPI, FastAPI downloads the PDF from R2, runs `pdf2image` + `Pillow` to extract the first page, uploads the thumbnail to R2 (separate key), persists both URLs on the `ShareItem`. Adds ~1–2 s to the record call. We still need `poppler-utils` on the Pi.

---

## 1. PDF upload as a Bundle item type

### Current state

- `ItemKind` enum in `apps/api/src/myetal_api/models/share.py:24-28` has only `paper`, `repo`, `link`. No `pdf` value, no file storage.
- The add-item flow on web (`apps/web/src/components/add-item-modal.tsx`, 1167 LOC) and mobile (`apps/mobile/app/add-item.tsx`, 1411 LOC) only accepts URLs / DOIs / manual text. No file picker, no upload.
- `ShareItem` columns include `image_url` (intended for paper hero images, not user uploads). No `file_url`, no `file_size`, no `mime_type`.
- Cloudflare R2 bucket (`myetal-uploads`) provisioned by owner. Public dev URL enabled. S3-compatible credentials saved to `apps/api/.env` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_PUBLIC_URL`). Same env block goes on the Pi `.env`. No FastAPI client wrapper or migration shipped yet.

### Proposed state

- New `ItemKind.PDF = "pdf"` enum value (additive — no rename, no risk to existing rows).
- New columns on `share_items`: `file_url VARCHAR(2000) NULL`, `file_size_bytes INTEGER NULL`, `file_mime VARCHAR(64) NULL`, `thumbnail_url VARCHAR(2000) NULL`. All nullable so existing rows keep working.
- New module `apps/api/src/myetal_api/services/r2_client.py` — thin `boto3` S3-client wrapper:
  - `presign_upload(key, mime_type, max_size_bytes, expires_in=300) -> dict` — returns a 5-minute presigned **POST policy** (URL + form fields) generated via `boto3.generate_presigned_post()` with a `content-length-range` condition. This binds the size limit into the presigned upload itself so R2 rejects oversize bodies at upload time, not just on record-call.
  - `public_url(key) -> str` — returns the R2 public URL for downloads (`{R2_PUBLIC_URL}/{key}`).
  - `download(key) -> bytes` — for the thumbnail step.
  - `upload(key, bytes, mime_type)` — for storing the generated thumbnail back to R2.
  - `move(src_key, dst_key)` — copies + deletes; used when promoting `pending/{uuid}.pdf` to `shares/{share_id}/items/{uuid}.pdf` on successful record.
- **Upload pipeline (R2 + presigned POST):**
  1. Client requests a presigned upload: `POST /shares/{id}/items/upload-url` body `{ filename, size_bytes, mime_type }` → returns `{ upload_url, fields, file_key, public_url, expires_at }`. FastAPI validates auth, share ownership, claimed size ≤ 25 MB, MIME starts with `application/pdf`. Generates a unique key under `pending/{uuid}.pdf`. Calls `r2_client.presign_upload(...)` with `max_size_bytes=26_214_400` and returns the POST policy.
  2. Client `POST`s the bytes directly to `upload_url` as `multipart/form-data` (the presigned form fields + a `file` field). Web uses `FormData` + `fetch(url, { method: 'POST', body: form })`. Mobile uses `expo-file-system` `uploadAsync` with `uploadType: FileSystemUploadType.MULTIPART` and `fieldName: 'file'` for progress events.
  3. Client calls `POST /shares/{id}/items` with discriminated body — for PDFs: `{ kind: 'pdf', file_key, copyright_ack: true }`. (See "Route shape" below for how this coexists with URL/DOI adds.) FastAPI:
    - Validates the key matches the presigned key it issued (cache the presign in an in-memory dict on the FastAPI single worker — Pi has no Redis. On API restart, in-flight uploads' record calls will 400 (lost presign). Acceptable — user retries from the upload picker.).
    - Downloads the file from R2 to verify the first 8 bytes are `%PDF-` (Q3). Note: the Content-Type the client claimed at presign time is NOT trusted for validation — it's only used as the POST upload header. The first-8-byte sniff after upload is the only authoritative MIME check.
    - Verifies the actual size is ≤ 25 MB (belt-and-braces — the POST policy `content-length-range` already enforced this at upload time, but server-side recheck is good defense in depth).
    - Verifies `copyright_ack` is true (Q6).
    - On pass: creates the `ShareItem` row, **moves** the object from `pending/{uuid}.pdf` to `shares/{share_id}/items/{uuid}.pdf`, runs `pdf2image` + `Pillow` to extract the first page as a JPEG, uploads the thumb to R2 at `shares/{share_id}/items/{uuid}-thumb.jpg`, stores both `public_url`s on the `ShareItem`. Returns the new item.
    - On fail (any validation): deletes the uploaded PDF from R2 (cleanup), returns the appropriate 4xx.
  4. Failure modes: presign expired → 403 from R2, client re-requests; size cap exceeded → R2 rejects at upload time (POST policy), or 413 from FastAPI on record (belt-and-braces) with the "compress your PDF" hint; not a real PDF → 415; copyright not acknowledged → 400.
- **Note: on the Pi, expect 3-8s for the record call when generating thumbnails.** The Pi is a Raspberry Pi running single-worker FastAPI; `pdf2image` on a 25 MB PDF can take longer than the desktop ~1-2s figure. If this proves too slow at scale, move to a background-task model in v2 (record returns 202 immediately, thumbnail backfilled).
- **Route shape for adding PDF item:** the same `POST /shares/{id}/items` endpoint is used for URL/DOI adds and PDF adds, with a discriminated body. `AddItemRequest` accepts either `{ kind: 'paper'|'repo'|'link', identifier: str }` (existing) or `{ kind: 'pdf', file_key: str, copyright_ack: bool }` (new). The route handler validates the discriminator and dispatches accordingly. No parallel endpoint.
- **Validation steps summary:**
  - Claimed Content-Type at presign time → NOT trusted (informational only, used as upload header).
  - Presigned POST `content-length-range` condition → enforced by R2 at upload time (Bug 5).
  - First-8-byte `%PDF-` sniff after upload → authoritative MIME check.
  - Server-side actual-size recheck on record → belt-and-braces.
  - `copyright_ack=true` → required at record time.
- **Rate limit:** 20 PDF uploads per user per hour (mirrors the comment rate limit pattern in §3). Per-share concurrency: no explicit limit; presigns are short-lived (5 min) so the abuse window is bounded.
- **Thumbnail spec:** 800px wide, JPEG quality 80, ~50 KB per thumb. Generated via `pdf2image.convert_from_bytes(..., size=(800, None), fmt='jpeg')`.
- **Bucket-key share_id leakage:** layout is `pending/{uuid}.pdf` then `shares/{share_id}/items/{uuid}.pdf` — share IDs are exposed in the public URLs of imported PDFs. Acceptable: share IDs are already in the public `/c/{short_code}` viewer's URL, so no new info leak.
- **Orphan cleanup:** R2 lifecycle rule on the `pending/` prefix auto-deletes objects older than 24 hours. The presigned upload generates keys under `pending/{uuid}.pdf`; on successful record-call, FastAPI moves the object to its final key (`shares/{share_id}/items/{uuid}.pdf`). Orphaned uploads (client crashed, never recorded) self-clean within 24 h. No code, just a one-time R2 config — owner adds via the CF dashboard before PR-C ships (see "Owner-task before PR-C ships").
- Public viewer (`apps/web/src/app/c/[code]/page.tsx`) renders PDF items as: thumbnail card → click opens the R2 public URL in a new tab (browser's native PDF viewer or download). No inline embed in v1 — `<embed>` and PDF.js both have layout/perf issues on mobile browsers.
- Pi prod: `apt install poppler-utils` is required on the Pi host before the new image runs. Add to `apps/api/DEPLOY.md` §1 (Compose stack on the Pi). Add `boto3`, `pdf2image`, `Pillow` to `apps/api/pyproject.toml`.

### Owner-task before PR-C ships

Two one-time bucket configurations required (no code, owner does these via the Cloudflare dashboard):

1. **Lifecycle rule** on the `pending/` prefix → delete objects older than 24 hours (handles orphan cleanup, per Bug 6 above).
2. **CORS rules** on the bucket → required for web-browser uploads (mobile uploads don't trigger CORS, no Origin header — this is web-only):

```json
[
  {
    "AllowedOrigins": ["https://myetal.app", "https://www.myetal.app", "https://*.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "POST"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

### Decision points

All four prior architecture questions (Q16–Q19) are resolved by the R2 decision — see "Resolved by the R2 decision" near the top of this doc. No remaining decisions for §1 itself; PR-C can start whenever PR-A wraps (or in parallel — they're independent).

### Mobile considerations

- Use `expo-document-picker` (already a dep — used nowhere yet, but in the supported list). On Android, `type: 'application/pdf'`; on iOS, `type: 'com.adobe.pdf'`.
- Upload progress: `expo-file-system` `uploadAsync` with `onUploadProgress` callback works on both platforms. Pass the presigned URL from FastAPI as the target. Method is `POST` (multipart/form-data) — we use a presigned POST policy so R2 can enforce `content-length-range` at upload time (see Bug 5 in §1). Use `uploadType: FileSystemUploadType.MULTIPART` and `fieldName: 'file'`, plus the policy fields from the presign response.
- Flaky-connection handling: client-side retry with exponential backoff (max 3 attempts), then surface a "save and retry later" affordance. Don't block the editor on a stuck upload — leave the item in a `pending_upload` local state and let the user navigate away.

### Effort

~~3 days backend (`r2_client.py` boto3 wrapper, presign + record routes, MIME validation, copyright field plumbing, sync thumbnail pipeline, migration for new `share_items` columns + `ItemKind.PDF` enum value, tests) + ~1.5 days web UI (file picker in `add-item-modal.tsx`, progress bar, copyright checkbox, viewer thumbnail rendering in `c/[code]/page.tsx`) + ~1.5 days mobile UI (`expo-document-picker` + presigned-URL `POST` via `uploadAsync`, progress, retry UI) + ~0.5 day for the empty-state copy on the upload flow (see §7) = **~~6.5 days**. Includes ~0.25 day owner copy work for the copyright acknowledgement text (single-line legal-ish disclaimer). Owner writes; not on dev path. Owner also configures the R2 lifecycle rule + CORS JSON before PR-C ships (one-time, ~5 min in CF dashboard).

---

## 2. Tags on shares

### Current state

- No tag schema. No tag UI. No tag filtering.
- `Share.type` (`paper` | `collection` | `bundle` | `grant` | `project`) is structural, not topical — answers "what kind of thing" not "what's it about."
- Search (`apps/api/src/myetal_api/services/share.py:335-460`) matches share name, description, and paper authors via `pg_trgm` + `ILIKE`. It does NOT match a topical signal.

### Proposed state (locked answers folded in)

- New `tags` table — `id UUID PK, slug VARCHAR(50) UNIQUE NOT NULL, label VARCHAR(80) NOT NULL, usage_count INTEGER DEFAULT 0`. `slug` is the canonical lowercased + trimmed form (Q8-A); `label` is title-cased of slug for display.
- New `share_tags` join (Q7-A) — `share_id UUID, tag_id UUID, PRIMARY KEY (share_id, tag_id)`. Tags cascade-delete on share delete; tag rows themselves persist.
- Tag editor on share creation: free-form input + autocomplete dropdown over existing tags (top-N by `usage_count`) (Q9-C). Comma- or enter-separated. Lowercased + slugified on submit. Hard cap at **5 tags per share** (Q10).
- Curated starter set: ship a list of ~30 seed tags via migration to make autocomplete useful on day one (microbiology, virology, microbiome, machine-learning, structural-biology, etc.). Owner picks the seed list before PR-A merges.
- Public discovery filtering: `GET /public/browse?tags=virology,microbiome` returns only shares whose tag set intersects. Multiple tags = OR (more permissive, more useful for discovery; AND would yield empty sets too often).
- Tag autocomplete endpoint: `GET /public/tags?q=vir&limit=10` — anon-readable, hits the `tags.slug` `pg_trgm` index. **Note:** this endpoint may share infrastructure with the user-search block in §5 (both autocomplete patterns) — flag if it does, share the debounce + dropdown component.

### Web vs mobile parity

- **Web share editor** (`apps/web/src/components/share-editor.tsx`): tag-input component below `description`, comma-or-enter to commit, autocomplete dropdown, X-to-remove chips. Visual: pill row matching the existing TYPE filter pill style in `apps/web/src/app/dashboard/search/search-results.tsx:202-215`.
- **Mobile share editor** (`apps/mobile/app/(authed)/share/[id].tsx`, 1027 LOC): same input + chip pattern using a `TextInput` + `FlatList` of suggestions. Confirm pattern works at iPhone SE width before scaling up.
- **Public share card surface** — show first 2 tags inline on the card, "+N more" if overflow. Detail screen shows all tags as tappable pills that filter the browse list. Same on web and mobile.

### Effort

~~2 days backend (migration, models, autocomplete endpoint, browse filter param, seed-tag migration, tests) + ~1 day web UI + ~1 day mobile UI + ~0.5 day for tag-related empty states (§7 E6) = **~~4.5 days**. Includes ~0.5 day of owner copywriting (seed-tag list of ~30 starter tags). Owner picks names; not on dev critical path but blocks PR-A merge.

---

## 3. Comments on shares

### Current state

- `models/social.py` was deleted in the discovery ticket (D13, see `public-discovery-and-collaboration.md`), specifically because comments / replies / likes were "out of scope, not a social network." We are reversing that choice with explicit user demand.
- No comment schema, no comment UI.

### Proposed state (Q11-B locked: per-share owner setting; Q12-A, Q13 yes locked)

> **Decision lens — pick C (reactions) if you expect scan-and-leave traffic from QR-on-a-poster viewers; pick A or B (comments) if you expect lab-internal threading and discussion.**

- New `share_comments` table — `id UUID PK, share_id UUID FK, author_user_id UUID FK NOT NULL, body TEXT NOT NULL, visibility share_comment_visibility NOT NULL DEFAULT 'public', created_at, updated_at`. Comments are authored — no anon comments in v1 (Q13 locked yes).
- New enum `share_comment_visibility AS ENUM ('public', 'owner_only')`.
- Per-share owner setting `Share.allow_public_comments BOOLEAN NOT NULL DEFAULT true` (Q11-B) — owner can disable public comments entirely; closed-only ("DM the curator") still works. This collapses the user's "public AND closed" ask into one toggle owners actually understand.
- Endpoints:
  - `POST /shares/{id}/comments` — body `{ body, visibility }`. Auth required. Rate-limited (10/user/hour). 403 if `visibility='public' AND share.allow_public_comments=false`.
  - `GET /public/c/{short_code}/comments` — anon read. Returns only `visibility='public'` comments.
  - `GET /me/shares/{id}/comments` — owner read. Returns all comments (public + owner-only).
  - `DELETE /shares/{id}/comments/{cid}` — owner can delete any; author can delete own.
  - `POST /shares/{id}/comments/{cid}/report` — anyone signed in can report. Reuses `share_reports` pattern.

### Decision points (still open)

No remaining decisions for §3 — Q11 locked B, Q12 locked A, Q13 locked yes. PR-D can start whenever its sequence slot opens.
- ~~Q12, Q13~~ — both locked (see Open questions section). Q12 is in-app only; email digests are deferred to `email-notifications-future.md`. Q13 requires sign-in to comment.

### Abuse / moderation

- Rate limit: 10 comments/user/hour, 3 reports/IP/hour anon (already the discovery ticket's `share_reports` rate limit at D16 — reuse).
- Owner-can-delete: any comment on their share, no review.
- Author-can-delete: their own comment, soft-delete with tombstone (`deleted_at`) so threading isn't shattered.
- Report flow: surfaces in the existing `/admin` queue alongside share reports.

### Web vs mobile UX

- **Web** — comment thread inline at the bottom of `apps/web/src/app/c/[code]/page.tsx`, below the items list. Composer above the thread. Visibility toggle radio next to compose: "Visible to everyone" / "Only the curator sees this."
- **Mobile** — separate sheet (`@gorhom/bottom-sheet` if already a dep, otherwise modal screen) opened from a "Comments (N)" button on the share view. Inline thread on phone screens is too cramped.

### Effort

~2.5 days backend + ~1.5 days web + ~1.5 days mobile + ~0.5 day for empty-state copy (§7) = **~6 days** (Q11-B path locked).

---

## 4. Public-shares filtering on home

### Current state

- Web home `apps/web/src/app/page.tsx` is a marketing-first landing. `SavedSharesSection` is the only dynamic surface; no public browse grid.
- The search page (`apps/web/src/app/dashboard/search/page.tsx`, then `search-results.tsx`) is currently nested under `/dashboard/` (now requires sign-in). It calls `/public/browse` for trending+recent and `/public/search?q=` for typed search. It already has type-filter pills (line 202-231) and a sort dropdown (relevance / newest / most_items).
- `/public/browse` (`apps/api/src/myetal_api/api/routes/search.py:27-48`) returns `{ trending, recent, total_published }`. **Cached at the CDN edge with `s-maxage=300`** — any new query params will fragment the cache key.

### Proposed state (Q14-A locked)

- Public anonymous browse moves out of `/dashboard/search` and gets a stable home at `/browse` (web). Existing `/dashboard/search` stays for authed users (it's the same component; just two routes pointing at it).
- `/public/browse` gains optional `?tags=` (comma-list, OR semantics) and `?sort=` (`recent` | `popular`) params. Cache key includes these; high-traffic combos (no params; one popular tag; sort=recent) stay edge-cached.
- The home page (`apps/web/src/app/page.tsx`) gets a "Browse public collections" section above the feature grid with: tag chip row (top 8 tags by `usage_count`) + a snapshot of 6 trending shares. Click a tag → `/browse?tags=<slug>`.
- Mobile `apps/mobile/app/(authed)/discover.tsx` already exists and matches this shape (tag chip row at top, then trending + recent sections). The gap: no tag filter param plumbing in `useBrowse`, no tap-to-filter on cards. Add `tags` param to `useBrowse`, add a TagPill row above the search entry, persist filter in screen state (don't urlencode — mobile route stack handles it).

### Decision points

- ~~Q14~~ — locked: extend `/public/browse` (A).

### Effort

~~1 day backend (browse-filter params, cache-key plumbing, tag-popularity sort) + ~1 day web (home page browse section + new `/browse` route) + ~0.5 day mobile (extend Discover) + ~0.5 day for empty-state copy (§7 E5, E6, E7, E11) = **~~3 days**. **Gated on Tags landing first.**

---

## 5. Public discovery while logged in

### Current state

- Web: once logged in, `/dashboard` is the landing. There is **no link** from the dashboard to public browse / search. Authed users can only reach the search page by typing the URL or coming through the marketing home.
- Web `/dashboard/layout.tsx` is the nav surface; auditing it after the rename round will tell us where to slot a "Browse" link.
- Mobile: Discover tab (`apps/mobile/app/(authed)/discover.tsx`) is already in the bottom-nav. **Mobile is ahead of web here.**
- "Search for other users" — does not exist anywhere. Search currently scopes to shares + papers + paper-authors (the new author-search shipped this round). Users-as-entities are not a search target.

### Proposed state (Q15-C locked)

- **Web nav** — add a "Browse" link to `/dashboard/layout.tsx`'s top-nav, alongside "Library" / "Shares" / "Profile." Points at `/browse` (the public route from §4).
- **Search scope expansion** — `/public/search` already covers shares + paper authors. Add a `users` result block: `/public/search?q=alice` returns top-N matching `User.name` rows whose user has at least one published share (non-published-share users are not surfaced — privacy default). Result block renders below shares; tappable card links to a per-user view.
- **Per-user view** — for v1, **no `/u/{handle}` route**. Owner-name links route to `/browse?owner_id={user_id}` (Q15-C — punts the URL-aesthetics decision until handles ship). Add `owner_id` to `/public/browse` filters. The browse page header shows the owner's name + their share count. This costs almost nothing and unblocks the "see other users' shares" ask without committing to handle uniqueness.
- **Follow / favorite users** — explicitly OUT for this round. Flag for the soft-network ticket (vocabulary already locked at `connection`, see discovery ticket D18).

### Decision points

- ~~Q15~~ — locked: punt; route owner-name links to `/browse?owner_id={user_id}`. Real `/u/{handle}` profiles captured as `discovery-and-handles-future.md`.

### Effort

~~0.5 day web nav (Browse link, dashboard layout) + ~1 day backend (user search block, owner_id browse filter, owner-card serializer) + ~1 day web `/browse?owner_id=` rendering + ~0.5 day mobile equivalent + ~0.5 day for empty-state copy (§7 E5) = **~~3.5 days**.

---

## 6. Poster terminology cleanup beyond the rename

### Current state

The DB-level + UI-level rename is shipped this round (migration `0011_rename_share_kind_poster_to_bundle.py` + the `ShareType.BUNDLE` enum value at `apps/api/src/myetal_api/models/share.py:19`). But "poster" is still used colloquially in product copy where it shouldn't confuse — and in some places where it should now be revisited:

- `apps/web/src/app/page.tsx:85` — *"A paper. A reading list. A poster you're standing in front of."* This is fine — it's describing the **physical artifact** you stick a QR on, not the type of share. **Keep.**
- `README.md:3` — *"a scannable QR for their poster, slides, or CV."* Same as above. **Keep.**
- `docs/tickets/works-library-and-orcid-sync.md:734` — *"For preprints, posters, grey literature -- anything not in Crossref / OpenAlex."* Doc-internal. **Keep.**
- The user's comprehension bug (*"add poster, then add item options are only paper, repo, etc via links or manual"*) is a flow problem, not a copy problem — fixed by §1 (PDF upload as a Bundle item type). The Bundle rename alone doesn't fix it.

### Proposed audit checklist

- After the Bundle rename ships, grep `apps/web/`, `apps/mobile/`, `README.md` for `poster` (case-insensitive). Each hit must be classified as **physical artifact** (keep) vs **type of share** (must already be "bundle" post-rename). Fail the audit if any "type of share" hits remain.
- Check the demo flow `apps/web/src/app/demo/demo-tour.tsx` — it walks new users through creating their first share. After the rename, does the demo still describe the Bundle type with terminology that matches what the user sees in the editor? Run it, screen-record, log discrepancies.
- Onboarding copy on `apps/web/src/app/dashboard/page.tsx` and mobile equivalent — see §7 E1, E3 for the specific empty-state copy.

### Effort

~0.5 day audit + copy edits across both platforms.

---

## 7. Empty states (NEW — major addition)

Owner quote: *"think about what happens when users have no papers or anything on there please."*

This is a checklist. Each item names the surface, the current behaviour, the proposed copy, and the file/component to edit. **Bundle the implementation into the existing PRs** — these aren't a separate PR, they're polish that ships with the feature that exposes the empty state. Roughly ~0.5 day per affected screen, 13 items, ~3.5 days total spread across PRs (E10–E13 are mostly copy-only, the budget hasn't grown).

For each item: owner reads the proposed copy and either ships it or rewrites it inline. No further design pass needed.

### E1. Brand-new user (signed in, no `orcid_id`, no shares, no library)

- **Web `/dashboard`** (`apps/web/src/app/dashboard/share-list.tsx:133-148`)
  - Today: shows "No shares yet" + "Create your first share to generate a QR for a poster, a slide, or your CV page." + "Create a share" button. Decent but doesn't mention ORCID.
  - Propose: keep the current copy, but ADD a top-of-page banner above `<ShareList />` (in `apps/web/src/app/dashboard/page.tsx`) when the user has no `orcid_id` AND no shares: *"Welcome. Add your ORCID iD on your profile to auto-import your papers, or paste a DOI in your library to get started."* — with two link buttons: `Add ORCID` (→ `/dashboard/profile`) and `Open library` (→ `/dashboard/library`).
- **Web `/dashboard/library*`* (`apps/web/src/app/dashboard/library/library-list.tsx:329-332`)
  - Today: *"Your library is empty. Paste a DOI above to get started."* — fine, but doesn't surface ORCID.
  - Propose: when `user.orcid_id` is null, swap to: *"Your library is where your papers live. Add your ORCID iD on your profile to auto-import them, or paste a DOI above to add one manually."*
- **Mobile dashboard** (`apps/mobile/app/(authed)/dashboard.tsx:97-113`)
  - Today: "No shares yet" + create button — same as web. No ORCID prompt.
  - Propose: same banner pattern as web. Render above the FlatList when `!orcid_id && shares.length === 0`.
- **Mobile library** (`apps/mobile/app/(authed)/library.tsx:412-422`)
  - Today: *"Your library is empty. Paste a DOI above to add your first paper."*
  - Propose: when `!orcid_id`: *"Your library is where your papers live. Add your ORCID iD on your profile to auto-import them, or paste a DOI above."*

### E2. User signed in via ORCID, ORCID record empty (no works yet)

- The auto-import fires, returns 0 added, the library is still empty. Today: silently empty.
- **Server behaviour:** `apps/api/src/myetal_api/services/works.py:245` already stamps `last_orcid_sync_at` regardless of count — confirmed correct, the "stamp even when 0 works" behaviour is already in place. **No change needed there.**
- **Web library copy** (same file as E1): when `user.orcid_id IS NOT NULL` AND `last_orcid_sync_at IS NOT NULL` AND library is empty: *"We synced your ORCID record but didn't find any works yet. Add your first paper at orcid.org, or paste a DOI here to get started."*
- **Mobile library:** same copy, same condition.

### E3. User has papers but no shares

- **Web `/dashboard*`* (`share-list.tsx:133-148`)
  - When `library.length > 0 && shares.length === 0`: change the empty-state copy to *"You have N papers in your library. Click any to add it to a new share — that's how you get a QR code."* Keep the "Create a share" button. Library count comes from the same `/me` endpoint already loaded for the nav.
- **Mobile dashboard** (`apps/mobile/app/(authed)/dashboard.tsx:97-113`)
  - Same logic, same copy.

### E4. User has shares but they're all unpublished / private

- The user's published-discover surfaces (Discover, profile-on-search-results) show none of their work. Today: this looks identical to "no shares" from outside. Owner sees this as "where are my shares?".
- **Web** — in `share-list.tsx`, add a "Drafts" badge to any unpublished share row. Surface a one-line nudge above the list when ALL shares are unpublished: *"None of your shares are published yet. Open one and toggle 'Publish' to make it discoverable."*
- **Mobile** — same: badge on the card + the same one-liner above the FlatList.

### E5. Search with no results (any query)

- **Web** (`apps/web/src/app/dashboard/search/search-results.tsx:241-257`)
  - Today: *"No collections matched 'foo'. Try different keywords or check the spelling."* — already decent.
  - Propose: ADD a fallback link: *"...or browse all collections →"* pointing at `/browse`. This becomes more important once `/browse` exists (§4).
- **Mobile** (`apps/mobile/app/search.tsx`) — same change.
- **For the user-search block** (§5): when `q` matches no users, render *"No people matched 'foo'."* under the shares no-results block — separate empty state per result type.

### E6. Tag filter with no shares

- New, ships with PR-A.
- **Web `/browse?tags=virology*`* when result set is empty: *"No shares tagged 'virology' yet. Be the first to tag one — open any of your bundles and add the tag."* Render only when the user is signed in; otherwise drop the second sentence.
- **Mobile Discover** when a tag pill is active and result set is empty: same copy.

### E7. Public discover with no shares (early days, brand new app)

- The home page (`apps/web/src/app/page.tsx`) browse section has zero published shares. Today: empty.
- Propose: server-render a fallback marketing card in that slot — *"No public collections to browse yet — be one of the first. Share a paper, a reading list, or a poster, and it shows up here."* with a "Sign up" CTA. Hide the trending/recent sections entirely when `total_published === 0` so the page doesn't show two empties.
- This also covers the same condition on mobile Discover (`apps/mobile/app/(authed)/discover.tsx:110-122` already has a *"Be the first / Publish a collection and it will appear here."* fallback; tweak copy to match the web message for consistency).

### E8. Mobile-specific: ORCID auto-import network failure on first sign-in

- A fresh user signs in with ORCID, the auto-import runs in the background, ORCID is down or the network drops → silent failure today. Library is empty with no explanation.
- **Mobile library** (`apps/mobile/app/(authed)/library.tsx`)
  - Read the auto-import status from the same hook that triggers it (or a dedicated `useOrcidImportStatus`). When status is `error` and the library is empty, render a banner: *"We couldn't reach ORCID. Pull down to retry, or paste a DOI to add a paper manually."* with a Retry button that re-calls the import endpoint.
- **Web library** — same banner pattern, same condition. Less likely to hit on web (longer sessions, retries on focus) but the banner pattern should match for consistency.

### E9. New share, no items added yet (PR-C)

- The user's "is poster a PDF upload?" comprehension bug is partly this — they create a Bundle, see an empty editor, can't tell what to do.
- **Mobile** (`apps/mobile/app/(authed)/share/[id].tsx:554-558`)
  - Today: has the helper text added in the rename round. Confirm the current copy is *"A bundle gathers papers, repos, and PDFs behind one QR. Start by adding an item."* If not, update to that.
- **Web share editor** (`apps/web/src/components/share-editor.tsx`)
  - Today: presumably no equivalent. Add a placeholder card in the items list when items are empty, with the same copy as mobile: *"A bundle gathers papers, repos, and PDFs behind one QR. Start by adding an item."* with a "+ Add item" CTA.
- E9 ships with PR-C, so the "and PDFs" phrasing is real by definition — no conditional drop required.

### E10. Comments thread with zero comments (PR-D)

- Web/mobile public viewer with comments enabled but no comments yet.
- When the share allows public comments: *"Be the first to comment."*
- When the share is owner-only-comments: *"The curator gets your private feedback. They won't be shared publicly."*

### E11. Search initial state — blank query, page just loaded (PR-B)

- Once `/browse` exists, `/dashboard/search` could feel weird with a blank query.
- Web `search-results.tsx`: when `q` is blank, render the trending+recent cards with a header *"Public collections — search above or browse all →"*.

### E12. DOI lookup network failure (folded into PR-A audit)

- Library add-by-DOI Crossref/OpenAlex unreachable → today: probably ugly error.
- Web + mobile library: when the DOI lookup returns 503, show *"Couldn't reach Crossref to fetch metadata. Try again in a moment, or paste the title manually."* Same banner pattern as ORCID auto-import failure (E8).

### E13. Public viewer for an unpublished share (folded into PR-A audit)

- `/c/{code}` for an unpublished share — what does the public viewer return?
- Confirm by reading `apps/api/src/myetal_api/api/routes/public.py` and `apps/web/src/app/c/[code]/page.tsx`. Verify the response is a clean 404 (or 410 for tombstoned). If currently leaks "draft" state, write the empty-state copy: *"This collection isn't published yet."* with no CTA. If already 404, just confirm in the doc and note it's already correct.

### Empty-states summary


| #   | Surface                             | File                                                                                          | New copy needed    | PR                            |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------- | ------------------ | ----------------------------- |
| E1  | New-user dashboard banner           | `apps/web/src/app/dashboard/page.tsx`, `apps/mobile/app/(authed)/dashboard.tsx`               | yes                | PR-A or audit PR              |
| E1  | Library "no ORCID" prompt           | `apps/web/src/app/dashboard/library/library-list.tsx`, `apps/mobile/app/(authed)/library.tsx` | yes                | PR-A or audit PR              |
| E2  | ORCID synced but empty              | same library files                                                                            | yes                | PR-A                          |
| E3  | Has papers, no shares               | `apps/web/src/app/dashboard/share-list.tsx`, mobile `dashboard.tsx`                           | yes                | PR-A                          |
| E4  | Drafts-only state                   | same files                                                                                    | yes                | PR-A                          |
| E5  | Search no results + browse fallback | `search-results.tsx`, mobile `search.tsx`                                                     | yes (one new line) | PR-B                          |
| E6  | Tag filter empty                    | `/browse` route, mobile Discover                                                              | yes                | PR-A                          |
| E7  | Brand-new app: no public shares     | `apps/web/src/app/page.tsx`, mobile `discover.tsx`                                            | yes                | PR-B                          |
| E8  | ORCID import network failure banner | mobile + web library                                                                          | yes                | PR-A or audit PR              |
| E9  | New share, no items                 | mobile `share/[id].tsx`, web `share-editor.tsx`                                               | yes                | PR-C (PDF wording lands here) |
| E10 | Comments thread with zero comments  | web `c/[code]/page.tsx`, mobile comments sheet                                                | yes                | PR-D                          |
| E11 | Search initial state, blank query   | `search-results.tsx`                                                                          | yes                | PR-B                          |
| E12 | DOI lookup network failure          | web + mobile library                                                                          | yes                | PR-A audit                    |
| E13 | Unpublished-share public viewer     | `apps/api/src/myetal_api/api/routes/public.py`, web `c/[code]/page.tsx`                       | maybe (verify 404) | PR-A audit                    |


---

## What's NOT in this round

- **Google Scholar import.** Scholar has no official API. All Scholar scrapers (`scholarly`, `serpapi`'s Scholar engine) are either against ToS or commercial paid endpoints with brittle CSS selectors. Document in user-facing FAQ once Round 2 ships.
- **Account linking** — Phase B, blocked on Better Auth migration (already in `better-auth-migration.md`).
- `**@handle` syntax + uniqueness** — punted (Q15 locked C). Owner-name search routes to `?owner_id=`. Real handles ship in their own ticket (`discovery-and-handles-future.md`).
- **Following users / favoriting users** — soft-network ticket (discovery D18).
- **Email notifications for comments** — Q12 locked in-app only. Email digests captured as `email-notifications-future.md`.
- **Inline PDF preview in the public viewer** — Q5 picks thumbnail+download; PDF.js / `<embed>` revisited if users ask.
- **Virus scanning at upload time** — Q4 deferred. See `docs/tickets/pdf-virus-scanning-future.md`.
- **Reactions in addition to comments** — Q11 picks one, doesn't ship both.
- **Tag aliases / synonyms / plural-stripping** — Q8 punts to v2.
- **AND-semantics tag filter** — first version is OR only.
- **Hand-edited `tags.label` distinct from `slug*`* — auto only (label = title-case of slug).
- **PDF upload v1 limits (driven by R2 + scope, not vendor):**
  - Files larger than 25 MB (Q2 cap).
  - Non-PDF uploads — no images, no video, no audio. The `ItemKind.PDF` value is intentionally narrow; if we want video posters later, that's a new enum value and a new validation path.
  - Multi-file batch upload — one PDF per `ShareItem`.
  - Resumable uploads beyond what `expo-file-system`'s `uploadAsync` provides natively.
  - Custom domain for the R2 public URL (`cdn.myetal.app` etc.) — the rate-limited `pub-*.r2.dev` host is fine for v1; swap to a custom domain later when traffic warrants.
  - Inline PDF preview in the public viewer — Q5 picks thumbnail + download; PDF.js / `<embed>` revisited if users ask.

---

## Suggested PR sequence

PR-A and PR-B include their associated empty-state work; PR-C bundles E9 and the upload-flow specifics; the audit PR sweeps E8, E12, E13 and any leftover copy.

1. **PR-A — Tags + tag-related empty states.** Schema, autocomplete endpoint, browse-filter param, web + mobile editor UIs, web + mobile share-card surfaces. Empty states E1, E2, E3, E4, E6. Includes the §6 audit (rename grep), the seed-tag migration, and the audit-PR sweep (E8, E12, E13). Note: tag-autocomplete dropdown component may share infrastructure with the user-search autocomplete shipped in PR-B — flag if PR-A's component should be built reusable from day one. Land first. **~5 days** (was 4; +0.5 for empty states + 0.5 for the seed list / audit folded in). Includes ~0.5 day owner copywriting for the seed-tag list (~30 starter tags); not on dev critical path but blocks PR-A merge.
2. **PR-B — Public-home filtering + in-app discovery + remaining empty states.** Builds on PR-A. Adds `/browse` route on web, "Browse" nav link, tag chip row on the home page, mobile Discover tag-filter plumbing, user-search block, `owner_id` filter. Empty states E5, E7, E11. User-search autocomplete should reuse the dropdown component shipped in PR-A's tag autocomplete — flag if it doesn't, share the debounce + dropdown component. **~3.5 days**.
3. **PR-C — PDF upload as Bundle item type.** Independent of PR-A and PR-B (no shared autocomplete component — PR-C has no autocomplete). Backend (`r2_client.py` boto3 wrapper, presign + record routes, MIME validation, sync thumbnail via `pdf2image`), web file picker + viewer thumbnail + copyright checkbox, mobile `expo-document-picker` + presigned-URL `POST` + progress. Empty state E9. **~6.5 days.** Includes ~0.25 day owner copy work for the copyright acknowledgement text (single-line legal-ish disclaimer); owner writes, not on dev path. Owner also configures R2 lifecycle rule + CORS JSON before PR-C ships (one-time, ~5 min in CF dashboard) — on the critical path. No external sign-offs needed (Q16–Q19 resolved by R2).
4. **PR-D — Comments (Q11-B locked).** Independent of all above. Per-share owner toggle `allow_public_comments`, comment composer + thread on web/mobile, owner-only feedback inbox, soft-delete + report flow. Empty state E10 (zero comments). **~6 days.**

Plus a **half-day Audit PR** folded into PR-A — runs the rename grep after the Bundle rename hits main, fixes any "type of share" stragglers, ships the empty-state copy for E8 (ORCID network failure banner, mobile + web), E12 (DOI lookup failure banner), and verifies E13 (unpublished-share public viewer).

Total: **~18 days** with Q11-B locked. Empty states add ~3.5 days but are spread across all four PRs. Owner-tasks (CORS rules, lifecycle rule, seed tags, copyright text) sit on the critical path of their respective PRs.

---

## Acceptance checklist

TBD — populated when each PR's implementation prompt is written. All decision points locked.

For empty states specifically, the bar is: a fresh-signup user, with no ORCID ID and no manual paper, can land on every screen in this list and see helpful copy that tells them what to do next. No silent empties.