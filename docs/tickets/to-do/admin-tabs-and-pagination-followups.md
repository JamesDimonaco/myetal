# Admin dashboard follow-ups — tab semantics + pagination + async rebuild

**Status:** Backlog — surfaced by Stages 1+2 and 3+4 reviewers, deliberately deferred from the drive-by fix batches
**Created:** 2026-05-16
**Owner:** James
**Effort estimate:** ~1.5–2 days total (4 items, separable)

---

## Why deferred

Four items came up across the eight review reports (two for each stage) that share a property: the right fix is non-trivial and touches multiple surfaces. Drive-by fixes covered everything else. These four warrant their own session rather than half-baked attempts squeezed into a review-response commit.

---

## 1. Tab semantics — convert button strips to real `tablist`/`tab`/`tabpanel` (~3-4 hours)

**Surfaces:**
- `apps/web/src/app/dashboard/admin/users/[id]/user-tabs.tsx`
- `apps/web/src/app/dashboard/admin/shares/[id]/share-detail-tabs.tsx`

Both currently use `<button aria-pressed={active}>` instead of proper tab semantics. Screen readers announce "toggle button, pressed" instead of "tab, X of N, selected." Flagged in Stages 1+2 a11y review (S3) and again in Stages 3+4 review (carried-forward S1).

**Implementation sketch:**
- Container gets `role="tablist"` + `aria-label="<scope> sections"`.
- Each button gets `role="tab"` + `aria-selected={active}` + `aria-controls="<panel-id>"` + `tabIndex={active ? 0 : -1}`.
- Content `<div>` gets `role="tabpanel"` + `aria-labelledby="<tab-id>"` + `tabIndex={0}`.
- Arrow-key handler on the tablist: ←/→ move focus + activation between tabs; Home/End jump to first/last.
- Or: migrate to Radix Tabs (already a transitive dep). Same primitive style as Dialog/DropdownMenu — clearer + free arrow-key handling.

**Recommendation:** migrate to Radix Tabs. Less code, consistent with the existing primitive vocabulary.

---

## 2. URL state for active tab — `?tab=` searchParam (~1 hour, depends on #1)

**Surfaces:** same two files as #1.

After any admin action (`router.refresh()` in `share-actions.tsx` and the equivalent in user-actions), the tab state resets to its `useState` default. An admin watching the audit log for the share they just tombstoned bounces back to the "items" tab instead.

**Implementation:**
- Replace `const [tab, setTab] = useState<Tab>('items')` with derived state from `useSearchParams().get('tab')`.
- Tab clicks `router.replace(?tab=audit, { scroll: false })`.
- Server-side defaults: if no `tab` param, render whichever tab makes sense for that surface.

**Should ship after #1** — Radix Tabs has a controlled `value` prop that makes URL-syncing trivial.

---

## 3. Cursor pagination — encode sort identity in the cursor (~1.5 hours)

**Surface:** `apps/api/src/myetal_api/services/admin_shares.py:188-205`.

The shares list supports four sort orders (`created_desc`, `created_asc`, `name_asc`, `views_30d_desc`) but the cursor encodes `(created_at, id)` regardless. Paginating under `views_30d_desc` skips or repeats rows because the cursor advances by created_at, not view count.

The users-list cursor has the same shape and the same potential issue, though its sort options are narrower.

**Implementation:**
- Cursor format: `base64({sort_key: str, last_sort_value: Any, last_id: str})`.
- Compare on the encoded sort key, falling back to `id` for stable ordering when sort values tie.
- Reject (400) when the URL's `?sort=` differs from the cursor's stored `sort_key` — forces the client to reset pagination when changing sort.

---

## 4. Rebuild-similar background task (~3-4 hours)

**Surface:** `apps/api/src/myetal_api/api/routes/admin_shares.py` `rebuild_similar` route + `services/admin_shares.py:_rebuild_similar_for_share`.

Today the rebuild runs inline under the admin's HTTP request. For a share with 50 papers each appearing in 100 other shares, that's a 5,000-row INSERT under the request. UI shows "Working..." but doesn't reflect "this is genuinely slow" or offer cancel. Acceptable at v1 scale (~10 shares); will bite at 1,000+.

**Options:**
- **(a) `BackgroundTasks`** — FastAPI's stdlib. Fire-and-forget after returning 202. Simplest.
- **(b) Real job queue** — Celery / RQ / arq. More machinery; worth it once we have a second long-running operation.

**Recommendation:** (a) for now. Track a `share_id → last_rebuild_at` so concurrent rebuilds for the same share collapse.

---

## When to start

- **High-frequency surface trigger** — tab-reset issue is the first thing any admin will notice → #1 + #2.
- **Scale trigger** — when shares list > ~1k and view-sort pagination starts skipping → #3.
- **Frequency trigger** — when rebuild-similar is clicked more than once a day, OR a share crosses ~500 papers → #4.

None block launch. Stage 3+4 admin surface is shippable today.
