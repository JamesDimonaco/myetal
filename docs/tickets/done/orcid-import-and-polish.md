# ORCID — Works Import + UX Polish (Phase A.5)

**Status:** Proposal — for review
**Created:** 2026-05-07
**Owner:** James
**Depends on:** orcid-integration-and-account-linking.md (Phase A)
**Effort estimate:** ~5–7 days, single PR

---

## TL;DR

Phase A landed sign-in with ORCID, manual `orcid_id` entry on the profile, the `PATCH /auth/me` endpoint, and the recent fix-ups (hijack hardening, TOCTOU race, web SVG/types, mobile edit-clobber). It works, but the **headline benefit isn't real yet**: signing in with ORCID currently does *nothing* with the user's actual works. They land on an empty library page.

This PR ships the missing piece — **read the user's public works from ORCID, hydrate them via Crossref, drop them into the existing library** — and *at the same time* tightens the surrounding UX so the feature reads as honest. The polish items make sense to ride along: the trust statement ("we only read") is half-true without a real import flow; the "Save (clear)" button doesn't matter until users actually have a reason to set their iD; the duplicate-account warning on sign-in matters more once ORCID sign-in actually pays off.

**Trigger model:** the import auto-fires the *first* time a user lands on the library page after their `orcid_id` is set. The user's act of setting an `orcid_id` is the consent signal; we don't repeat-pull on every visit (that would burn rate limit and surprise users who hid papers). Re-sync is a button. We track this via a new `users.last_orcid_sync_at` column — null = "first sync hasn't happened yet"; setting it (or clearing the orcid_id and setting a new one) re-arms the auto-trigger.

Account linking, write-back to ORCID, background scheduled sync, and the Better Auth migration are explicitly out of scope.

---

## Current vs Proposed (at a glance)

| Aspect | Today | After this PR |
|---|---|---|
| **What ORCID sign-in actually does** | Stores `orcid_id`, that's it | Same, plus the user can pull their public works in one tap |
| **Importing papers** | Manual DOI paste only | Manual DOI paste **+** "Import from ORCID" button **+ auto-import on first library visit** after `orcid_id` is set |
| **Backend ORCID API client** | Doesn't exist | `services/orcid_client.py` — token cache + works fetch |
| **Sync endpoint** | None | `POST /me/works/sync-orcid` → `{ added, updated, unchanged, skipped, errors }` |
| **Re-import idempotency** | n/a | Re-importing is a no-op for already-saved papers; previously hidden papers stay hidden |
| **Trust statement (read-only)** | Absent on both platforms | Single sentence on profile + sign-in: *"We only read — we never write to your ORCID record."* |
| **Profile description copy** | Web: *"Connect your ORCID record so you can import your works."* Mobile: *"Link your ORCID iD so collaborators can find your work."* | Identical sentence on both platforms with the read-only clause |
| **Save button states** | Web: *"Save"* / *"Save (clear)"* / separate *"Remove"* | One primary button per state — *"Save"* when adding/changing; *"Remove"* (destructive) when clearing |
| **Sign-in linking warning** | None | One quiet line under the ORCID button: *"Already signed up with Google or GitHub? Add your ORCID iD on your profile instead — signing in with ORCID will create a separate account."* |
| **Mobile sign-in icon** | Text only | Adds the official ORCID glyph, matching web |
| **"What's an ORCID iD?" link** | Mobile only | Both platforms |
| **Web Remove confirmation** | Removes silently | Confirmation dialog mirroring mobile's `Alert.alert` |
| **Mobile keyboard avoidance** | Save button hidden under keyboard on small screens | Wrapped in `KeyboardAvoidingView` |
| **Mobile dev-paste UI** | Says *"Finish GitHub sign-in"* even for Google/ORCID; ships in production | Renamed to *"Finish OAuth sign-in"*, gated behind `__DEV__` |
| **Error string parity** | Wording drift between platforms | One canonical string set used on both |
| **Web a11y** | Input lacks `aria-invalid` / `aria-describedby` | Added |

---

# Part 1 — Works import (the main feature)

## 1.1 Backend: ORCID API client

**New module:** `apps/api/src/myetal_api/services/orcid_client.py`

Two responsibilities:

### a. Client-credentials token cache

ORCID's Public API uses a 2-legged OAuth token (separate from the user's OAuth tokens) to read any user's public data. Per ORCID docs, this token lasts ~20 years.

```python
# Pseudo:
async def get_read_public_token(client: httpx.AsyncClient) -> str:
    if _cached_token and not _is_expired(_cached_token):
        return _cached_token.access_token
    # POST {orcid_base}/oauth/token
    # form: client_id, client_secret, grant_type=client_credentials, scope=/read-public
    # response: { access_token, expires_in, ... }
    _cached_token = ...
    return _cached_token.access_token
```

Cache lives in module-level state (process memory). Single-worker prod constraint already holds, so no shared-cache concerns. On startup, the cache is empty; first import request warms it. On 401, invalidate and refetch once.

### b. Works fetch

```python
async def fetch_works(orcid_id: str, *, http: httpx.AsyncClient) -> list[OrcidWorkSummary]:
    token = await get_read_public_token(http)
    # GET {orcid_pub_base}/v3.0/{orcid_id}/works
    # Authorization: Bearer {token}, Accept: application/json
    # walk response['group'][i]['work-summary'][0] (preferred work in each group)
    # extract: title, type, publication date, journal, external-ids
```

Notes:
- The API returns *groups* — ORCID treats multiple works with the same external-id as one logical work. Take `work-summary[0]` from each group as the canonical entry.
- External-ids: `external-id-type` is `"doi"`, `"pmid"`, `"isbn"`, etc. Pull `doi` first; ignore the rest in this PR.
- Skip works with no DOI — they can't be deduped against the existing `papers` table without one. Count them as `skipped` in the sync result.

**Sandbox vs prod**: read `settings.orcid_use_sandbox` for the base URL — same toggle used by the OAuth flow:
- Token: `https://{orcid|sandbox.orcid}.org/oauth/token`
- Works: `https://pub.{orcid.org|sandbox.orcid.org}/v3.0/{id}/works`

## 1.2 Backend: migration for sync state

**New migration:** `apps/api/alembic/versions/20260507_NNNN_0010_add_last_orcid_sync_at_to_users.py` (next sequential rev).

```python
def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN last_orcid_sync_at TIMESTAMPTZ NULL")

def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_orcid_sync_at")
```

Add the matching SQLAlchemy column on `User` (`models/user.py`): `Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)`.

Expose on `UserResponse` (`schemas/user.py`) so the clients can read it on `/auth/me`.

**Reset rule** in `set_user_orcid_id` (`services/auth.py`): when the user's `orcid_id` *changes* (set to a different value, or cleared and re-set), reset `last_orcid_sync_at = None`. This re-arms the auto-trigger so the new ID gets a fresh first sync.

## 1.3 Backend: sync service

**Extend:** `apps/api/src/myetal_api/services/works.py`

```python
@dataclass
class OrcidSyncResult:
    added: int       # new entries in user's library (paper may or may not be new globally)
    updated: int     # paper existed globally; just linked to user
    unchanged: int   # already in user's library, not hidden
    skipped: int     # works without a DOI, or otherwise unimportable
    errors: list[str]  # per-DOI failure messages, capped at 10

async def sync_from_orcid(db, user_id: uuid.UUID) -> OrcidSyncResult:
    user = await db.get(User, user_id)
    if not user.orcid_id:
        raise OrcidIdNotSet  # 400 from the route
    works = await orcid_client.fetch_works(user.orcid_id)

    counts = OrcidSyncResult(0, 0, 0, 0, [])
    for w in works:
        doi = _pick_doi(w)
        if not doi:
            counts.skipped += 1
            continue
        try:
            paper, entry, status = await add_paper_by_doi(
                db, user_id, doi, added_via=UserPaperAddedVia.ORCID
            )
        except (PaperNotFound, PaperUpstreamError) as exc:
            if len(counts.errors) < 10:
                counts.errors.append(f"{doi}: {exc}")
            counts.skipped += 1
            continue
        # Classify based on status returned by add_paper_by_doi:
        #   "added" → new user_papers row this call
        #   "unchanged" → row already existed and not hidden
        #   "hidden" → row exists but hidden_at is set; leave alone, count as unchanged
        ...

    user.last_orcid_sync_at = datetime.now(UTC)
    await db.commit()
    return counts
```

**Hidden-at preservation rule** (from parent ticket W-S5): if the user has previously hidden a `user_papers` row, the sync **must not** restore it. The existing `add_paper_by_doi` helper needs a small extension to honour this on the ORCID path — pass `via=ORCID` and skip the restore branch.

## 1.4 Backend: HTTP route

**Extend:** `apps/api/src/myetal_api/api/routes/works.py`

```python
@router.post("/sync-orcid", response_model=OrcidSyncResponse)
@limiter.limit("5/minute")
async def sync_orcid(request: Request, user: CurrentUser, db: DbSession) -> OrcidSyncResponse:
    try:
        result = await works_service.sync_from_orcid(db, user.id)
    except works_service.OrcidIdNotSet:
        raise HTTPException(400, detail="set your ORCID iD on your profile first")
    except orcid_client.UpstreamError as exc:
        raise HTTPException(503, detail="ORCID is unavailable, try again in a minute") from exc
    return OrcidSyncResponse(**asdict(result))
```

**Synchronous, not background.** Request hangs until done. Reasoning:
- Median ORCID record has <30 works. Crossref hydration is cached after first fetch and most papers will hit the cache on re-sync.
- A typical first-time sync should complete in 5–15 seconds. Worst case (~100 works, no Crossref cache, slow upstream) is ~60 seconds. Server-side request timeout already covers that.
- A background-task model (sync runs table, polling endpoint) doubles the surface area for ~zero user-visible benefit at this scale.
- If we hit users with 200+ works, we revisit. Phase A.6.

**Rate limit `5/minute` per user.** Researchers don't need to hammer it.

## 1.5 Web UI

**Modify:** `apps/web/src/app/dashboard/library/library-list.tsx` and `page.tsx`

The page currently loads only `/me/works`; we need `user.orcid_id` and `user.last_orcid_sync_at`. Add `serverFetch('/auth/me')` alongside `/me/works` in `page.tsx`, pass both fields into `<LibraryList>`.

**Auto-fire on first visit:** in a `useEffect` (or a `useQuery` with `enabled` gate), when `orcid_id != null && last_orcid_sync_at == null`, call `POST /me/works/sync-orcid` immediately on mount. While running, show a single dismissible banner *"Importing your works from ORCID…"* with a spinner. The library list shows whatever's currently saved (manual DOIs etc.), so the page isn't visually empty during the sync.

**Re-sync button** lives next to the manual "Add by DOI" form, behavior:

- **Disabled** with tooltip *"Add your ORCID iD on your profile first"* when `orcid_id` is null.
- **Enabled** otherwise. Label: *"Import from ORCID"* on first never-synced state, *"Re-sync from ORCID"* once `last_orcid_sync_at` is set. (Same endpoint, different label.)
- On click → call `POST /me/works/sync-orcid` via `clientApi`.
- Loading state: button shows spinner + *"Importing from ORCID…"*.
- On 200: result banner *"Imported {added} new, {updated} updated, {unchanged} already in your library, {skipped} skipped."* Auto-dismiss after 8s. Invalidate `['works']` AND `['me']` queries so the list refreshes and the new `last_orcid_sync_at` is picked up (so future visits don't auto-fire).
- On 400: redirect to profile with a flash *"Add your ORCID iD to import works."*
- On 503: banner *"ORCID is unavailable right now. Try again in a minute."*
- On 429: banner *"Slow down — try again in a minute."*

**Edge case** — the auto-fire and the manual button must share a single mutation hook with a `isAlreadyRunning` guard so a user who taps the button mid-auto-import doesn't kick off a second concurrent request.

## 1.6 Mobile UI

**Modify:** `apps/mobile/app/(authed)/library.tsx` and `apps/mobile/hooks/useWorks.ts`

Same trigger model as web:

- **Auto-fire on first mount** when `user.orcid_id != null && user.last_orcid_sync_at == null`. Show a banner at the top of the FlatList: *"Importing your works from ORCID…"* with `ActivityIndicator`. The library list shows whatever's currently saved.
- **Re-sync row** above the manual-add form, with the ORCID glyph (see §2.4) + label *"Import from ORCID"* / *"Re-sync from ORCID"*. Same disabled state and labels as web.
- On press: call sync endpoint via a new `useSyncOrcid()` hook in `useWorks.ts`.
- Result: native `Alert.alert` with counts (consistent with the existing destructive flows).
- Errors: same alert pattern.
- Same single-mutation-with-guard rule.

## 1.7 Tests (backend)

- `tests/test_orcid_client.py` (new):
  - Token fetch happy path (mock `httpx.MockTransport`).
  - Token cache reuse on second call.
  - Token refresh on 401.
  - Works parse: groups → primary work-summary; DOI extraction; multiple external-ids; no DOI.
- `tests/test_works.py` (extend):
  - `sync_from_orcid` happy path: mock `fetch_works` to return 3 works (2 with DOI, 1 without). Assert 2 added, 1 skipped.
  - Re-sync idempotency: run twice, second call returns 3 unchanged.
  - Hidden-at preservation: pre-hide an entry, sync, assert it stays hidden and counts as unchanged.
  - 400 path: user with no `orcid_id`.
  - 503 path: ORCID upstream error.
  - **Sets `user.last_orcid_sync_at`** to a `datetime` value on success.
- `tests/test_auth_service.py` (extend):
  - `set_user_orcid_id` resets `last_orcid_sync_at` to None when the orcid_id *changes* (different value), but leaves it alone when the same value is re-set (idempotent set).
- Route-level test for `POST /me/works/sync-orcid` covering 200, 400, 503, 429.

---

# Part 2 — UX Polish

These items make sense to ship in the same PR because the works-import button is the missing piece that makes the trust copy honest.

## 2.1 Trust statement (highest impact)

**Why:** Researchers' first reaction to "Connect ORCID" is *"is this thing going to write to my record?"* Academic CVs are sensitive and ORCID's Member API is a known write surface. Neither platform answers this today.

**Current copy**

- Web — `apps/web/src/app/dashboard/profile/orcid-section.tsx:105-107`: *"Connect your ORCID record so you can import your works."*
- Mobile — `apps/mobile/app/(authed)/profile.tsx:187-189`: *"Link your ORCID iD so collaborators can find your work."*
- Sign-in screens say nothing about read-only.

**Proposed copy** (used on both profile screens; truncated form on sign-in screens):

> *"Add your ORCID iD to import your public works. We only read — we never write to your ORCID record."*

**Files:** `orcid-section.tsx`, mobile `profile.tsx`.

## 2.2 Collapse the dual-action button

**Why:** The current model has Save handle three concepts (add, change, clear-and-save) plus a separate Remove. Users get a *"Save (clear)"* string nobody understands and a Remove button that does the same thing.

**Proposed:**

| Input state | Button shown |
|---|---|
| Empty, nothing saved | (none) |
| Differs from saved (and valid) | **Save** |
| Matches saved | **Remove** (destructive, with confirm) |
| Empty, value previously saved | **Remove** |

Removes the *"Save (clear)"* string from the codebase entirely.

**Files:** web `orcid-section.tsx`, mobile `profile.tsx`.

## 2.3 Account-linking footgun on sign-in

**Why:** A user who already signed up with Google months ago has no hint that *"Continue with ORCID"* will create a *separate* account. That's how duplicate-account support tickets are born.

**Proposed:** quiet single-line caption directly under the ORCID button on both sign-in screens (muted text token, no icon, no CTA — guardrail not action):

> *"Already signed up with Google or GitHub? Add your ORCID iD on your profile instead — signing in with ORCID will create a separate account."*

**Files:** `apps/web/src/app/sign-in/page.tsx:60`, `apps/mobile/app/sign-in.tsx:245`.

## 2.4 Cross-platform parity (icon, helper link, error strings)

**Why:** The two platforms read like they were written by different people. The user shouldn't be able to tell.

**Concrete changes:**

- **Mobile sign-in icon**: new file `apps/mobile/components/orcid-icon.tsx` using `react-native-svg` (already a dep). Mirror the web SVG paths exactly (the corrected ones, post-`v48.4` removal).
- **"What's an ORCID iD?" link**: standardize on mobile's pattern (separate link below the input). Drop web's inline *"Find your ORCID iD"*.
- **Canonical error strings**, used identically on both platforms:
  - Validation: *"That doesn't look like a valid ORCID iD. Use the format 0000-0000-0000-0000 (last digit may be X)."*
  - Conflict: *"That ORCID iD is already linked to another account."*
  - Generic save: *"Could not save your ORCID iD."*
  - Generic import: *"Couldn't import from ORCID. Try again in a minute."*
- **Web Remove confirmation**: native `confirm()` dialog mirroring mobile's `Alert.alert`. Acceptable for this use case; no new dependency.

**Files:** new mobile icon component, both `orcid-section.tsx` and `profile.tsx`, both sign-in screens.

## 2.5 Mobile UX safety

- **`KeyboardAvoidingView`** on the profile screen, matching `sign-in.tsx`. The Save button currently hides beneath the keyboard on iPhone SE-class screens.
- **Dev-paste UI rename + gate**: title hardcoded as *"Finish GitHub sign-in"* even when triggered by Google/ORCID. Rename to *"Finish OAuth sign-in"*. Wrap the entire `showGithubPaste` block (and three callsites that set it) behind `__DEV__` so production builds can never render it.
- **A11y**: `accessibilityRole="button"` on the profile Save/Remove pressables.

**Files:** `apps/mobile/app/(authed)/profile.tsx`, `apps/mobile/app/sign-in.tsx`.

## 2.6 Code-quality follow-ups

Lower priority. Fold in if cheap:

- Backend uniqueness helper: change `exclude_user_id: object` to `uuid.UUID | None`.
- Migration vs plan-doc mismatch: parent ticket specifies a partial unique index (`WHERE orcid_id IS NOT NULL`), migration shipped a plain `UNIQUE`. Pick one — they're equivalent on Postgres for NULL-distinct, but the docs should agree. **Recommendation:** update the plan doc to match the shipped plain `UNIQUE` (simpler, no migration needed).
- Migration style: replace raw `op.execute("ALTER TABLE …")` with `op.add_column` / `op.create_unique_constraint` for revertability and consistency with the rest of `alembic/versions/`. Cosmetic.
- Mobile DRY: `handleGithub`, `handleGoogle`, `handleOrcid` in `apps/mobile/app/sign-in.tsx:112-163` are 90% the same. Extract `runOAuth(provider)` returning a discriminated result.
- Web a11y: `<input>` in `orcid-section.tsx` should set `aria-invalid={!!error}` and `aria-describedby` pointing at the error `<p>`.

---

## What's NOT in this PR

- **Account linking** — sign in with GitHub then connect ORCID to the same account. Phase B, blocked on Better Auth migration. See parent ticket Part 4.
- **Better Auth migration** itself.
- **Background scheduled sync** — no auto-pull when ORCID adds new works. User taps "Import from ORCID" again. (Webhooks would require Member API anyway.)
- **Async background-task model** for sync — synchronous is fine at current scale, see §1.3 reasoning.
- **Write to ORCID** — never, by policy. Public API can't anyway.
- **Pulling works without a DOI** — skipped this PR. Most papers have DOIs; the few without need a different dedup story (probably "by title + author + year").
- **PMID / arXiv / ISBN ingestion** — only DOI in this PR.
- **Email verification, account merge, unlink-provider guard** — Phase B.
- **Production ORCID OAuth credentials registration** — operational task, not UX. Already done in `.env`.

---

## Effort breakdown

| Chunk | Days |
|---|---|
| Backend: `orcid_client.py` + tests | 1.5 |
| Backend: `sync_from_orcid` service + route + tests | 1 |
| Backend: extend `add_paper_by_doi` for hidden-at preservation | 0.5 |
| Web UI: Import button + states + result banner | 0.5 |
| Mobile UI: Import row + states + alert | 0.5 |
| Polish (Part 2): all six sub-items together | 1 |
| End-to-end manual testing on prod ORCID against your real record | 0.5 |
| Buffer | 1 |
| **Total** | **~5–7 days** |

---

## Decision points (for review)

These are calls I'd like you to sanity-check before I start:

1. **Synchronous sync endpoint** vs background-task with polling. I'm proposing synchronous. Push back if you'd rather see the polling pattern.
2. **Skip works without a DOI** in the first ship. We can add title+author dedup later. Confirm.
3. **Hidden-at preservation rule** — re-syncing should *not* restore a paper the user explicitly hid. Matches parent ticket's W-S5. Confirm.
4. **Rate limit `5/minute`** on the sync endpoint. Reasonable?
5. **`OrcidSyncResult.errors[]`** caps at 10 messages — enough to debug, not enough to flood the response. OK?
6. **Bundle polish into this PR** vs ship them as a separate small PR after import. I'm proposing bundling because the trust statement is incoherent without the import. Push back if you'd rather two clean PRs.
7. **Migration partial-vs-plain unique** — am I right that updating the doc to match the shipped plain `UNIQUE` is the right call (vs migrating to a partial index, which gains nothing for NULL-distinct semantics on Postgres)?

---

## Acceptance checklist

### Works import

- [ ] Migration `0010_add_last_orcid_sync_at_to_users` applied; `users.last_orcid_sync_at` is nullable timestamptz.
- [ ] `User` model has the matching column; `UserResponse` exposes `last_orcid_sync_at` to clients.
- [ ] `services/orcid_client.py` exists with token cache + works fetch.
- [ ] `POST /me/works/sync-orcid` returns `{ added, updated, unchanged, skipped, errors }` and stamps `users.last_orcid_sync_at` on success.
- [ ] Re-syncing immediately is a no-op (`unchanged == total`).
- [ ] A pre-hidden entry stays hidden after sync, and counts as `unchanged`.
- [ ] User with `orcid_id == null` gets a 400 with a friendly detail.
- [ ] ORCID upstream 5xx surfaces as a 503 to the client, not a 500.
- [ ] Changing `orcid_id` to a *different* value via `PATCH /auth/me` resets `last_orcid_sync_at = NULL` so the next library visit re-fires.
- [ ] Web library auto-fires the import on first visit when `orcid_id` is set and `last_orcid_sync_at` is null; subsequent visits don't.
- [ ] Web library has a "Re-sync from ORCID" button that shares a mutation with the auto-fire (no double-import on rapid navigation).
- [ ] Mobile library tab matches web: auto-fire on first visit + button for re-sync.
- [ ] Both clients show the disabled state with a clear hint when `orcid_id` is null.
- [ ] Backend tests cover: happy path, re-sync idempotency, hidden-at preservation, no-orcid-id, ORCID upstream error, `last_orcid_sync_at` stamping, reset-on-orcid-id-change.

### UX polish

- [ ] Web profile description and mobile profile description are byte-identical and contain the read-only clause.
- [ ] Sign-in screens (web + mobile) show a muted single-line caption under the ORCID button warning about duplicate accounts.
- [ ] Mobile sign-in renders the ORCID glyph next to the *"Continue with ORCID"* label.
- [ ] Profile screen on each platform shows at most one primary button at a time (no *"Save (clear)"* string anywhere in the codebase).
- [ ] Removing a saved ORCID iD on web fires a confirmation dialog before the network call.
- [ ] Mobile Save button stays visible above the keyboard on iPhone SE-class screens.
- [ ] The dev-paste UI title reads *"Finish OAuth sign-in"* and the entire block is unreachable in a release build.
- [ ] Validation, conflict, and generic-save error strings match exactly between web and mobile.
- [ ] Web ORCID `<input>` has `aria-invalid` and `aria-describedby` wired to the error message when one is shown.
- [ ] Mobile profile Save/Remove `Pressable`s expose `accessibilityRole="button"`.
- [ ] Backend uniqueness helper's `exclude_user_id` is typed `uuid.UUID | None`.
- [ ] Migration and parent plan doc agree on partial-vs-plain unique index (recommendation: plan doc updated to match shipped plain `UNIQUE`).
