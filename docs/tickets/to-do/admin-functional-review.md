# Admin dashboard — functional review (Stages 1+2)

Reviewed `staging` at `6480d16` + `3bb1017`. Code-read only.

## TL;DR

- **`Grant admin` is a security no-op.** `require_admin` (`apps/api/src/myetal_api/api/deps.py:170-178`) gates by `ADMIN_EMAILS` env, never `users.is_admin`. The toggle only flips a UI badge.
- **`UsersList` "Load more" has a stale-closure race** that appends old-filter rows to the new-filter list.
- **`send-password-reset` 502 commits the audit row before raising**, so the toast says "BA refused" while the ledger says it ran.

## Real bugs

### 1. `Grant admin` does nothing (high)
`deps.py:170-178` gates by email allowlist; `admin_users.py:135-170` mutates a column nothing reads. **Fix:** flip `require_admin` to `user.is_admin` (note at deps.py:161-167 already), or rename action "Mark admin (cosmetic)" + banner.

### 2. `loadMore` filter race (high)
`users-list.tsx:87-104` ignores the `cancelled` flag the search effect uses. Mid-load filter change: second fetch wins, appending stale-filter rows. **Fix:** request token, discard stale appends.

### 3. Password-reset 502 misleading audit (medium)
`admin_users.py:286-301` commits audit then raises 502. Toast says retry; ledger has `ba_ok: false`. Retries duplicate. **Fix:** raise before commit, or stamp `details.retry=true`.

### 4. Self `force-sign-out` allowed (low)
`admin_users.py:103-132` accepts self; `user-actions.tsx:91-98` doesn't guard with `isSelf`. **Fix:** reject route-side, disable UI.

### 5. Page-total ignores `has_shares` / `deleted` filters (low)
`admin_users.py:202-222` omits both by design (line 220-221). Header reads "3 of 57" while table shows 3. Confusing.

### 6. Overview cache stale after writes (low)
`admin.py:49-50` 60s in-process cache. Soft-delete + back to overview shows deleted user in counts. Call `_reset_overview_cache` from every admin write.

## State-machine gaps

- **No loading skeleton.** `/dashboard/admin` is RSC + `force-dynamic`; overview runs ~8 sequential queries. First paint blocks. Add a Suspense boundary with a skeleton.
- **`UsersList` swallows fetch errors** (`users-list.tsx:75-77`). Comment says "keep stale data", but no toast — the operator can't tell. Add `toast.error` on the catch.
- **`UserTabs` tab state is `useState`** (`user-tabs.tsx:36`). `router.refresh()` after an action returns the user to "Shares" — confirm an audit-tab action, you jump tab. Lift to URL or sessionStorage.
- **`AuditTab` `<pre>` renders raw JSON** of `details` (`user-tabs.tsx:232`). Fine for v1, but a per-`action` renderer would read better than `{"sessions_revoked": 3}`.

## Race / concurrency notes

- Two admins click `Soft-delete` concurrently: second SELECTs `deleted_at IS NULL` if it lands before the first commit, both writes succeed, two audit rows. The user ends up with the later `deleted_at`. Acceptable at v1 scale.
- `record_action` correctly flushes-not-commits (`services/admin_audit.py:60-63`), pinned by `test_audit_helper_does_not_commit`. Audit + business change land atomically.
- `_OVERVIEW_CACHE` is module-global; concurrent first-misses recompute twice; last writer wins. Cheap.

## Pleasantly surprised by

- **`record_action` flush-not-commit** so audit + change land atomically. Test pins it.
- **Migration 0017** ships composite `(target_user_id, created_at)` + `(target_share_id, created_at)` indexes — exactly the read pattern Stage 3 will need.
- **`force_sign_out` revokes only `Session` rows** (not `Account`/`verification`). Doc explains JWT-TTL is the bound.
- **Password-reset proxies BA** rather than minting tokens locally. Keeps BA's rate-limit + audit chain intact.
- **Admin nav link is server-rendered** off the `/me` payload the layout already fetches — no client flicker.
