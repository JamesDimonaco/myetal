# Admin UI review — Stages 1+2

`staging` · commit `3bb1017` · triage, not crit.

## 1. TL;DR

- One real layout bug: `/dashboard/admin/reports` is double-wrapped by the new layout.
- Admin sub-nav has no active-tab indicator.
- User-list search/filter state doesn't sync to the URL — back-button + share links broken.

## 2. Bugs

- **Double-padded reports page.** `admin/layout.tsx:52` wraps in `max-w-6xl … py-10`; `admin/reports/page.tsx:26` still self-wraps with `max-w-5xl … py-10`. Drop the inner wrapper.
- **No active-nav state.** `admin/layout.tsx:57-67` — every link styled identically. Add `usePathname()` + active variant (`bg-paper-soft text-ink`).
- **Invisible loading on filter/search.** `users-list.tsx:84` flips `loading`; only "Load more" surfaces it (line 204). Typing in search → stale rows ~500ms with no signal.
- **Silent fetch errors.** `users-list.tsx:75-77` — `catch {}` keeps stale data, no toast. Add `toast.error()`.
- **No URL sync.** `users-list.tsx` never calls `router.replace`. Server reads `searchParams` (`users/page.tsx:33-35`); client never writes back. Refresh = lost state.
- **"Refreshes every minute" is misleading** (`admin/page.tsx:46`). Page only refetches on full reload. Drop the line or add a `setInterval` → `router.refresh()`.

## 3. Token inconsistencies

- `overview-charts.tsx:73` — second chart `fill="var(--color-ink)"` (`admin/page.tsx:85`) renders pure-black bars which fight the cream paper. Swap to `var(--color-ink-muted)` for the secondary chart.
- Everything else (`bg-danger/10 text-danger`, `bg-accent-soft text-accent`, `bg-ink text-paper`, `border border-rule bg-paper`) is on-token and consistent with existing surfaces.

## 4. Mobile at 375px

- **Admin sub-nav wraps to 2 rows** (eyebrow + 3 chips at 343px content width). Functional but cramped. `admin/layout.tsx:57`.
- **Filter chip row wraps to 3 rows** on `/admin/users` (6 chips). Acceptable for admin.
- **User detail header can overflow.** `users/[id]/page.tsx:60` — `flex items-center gap-2` puts H1 + Admin pill + Deleted pill on one line with no inner wrap. Long names + both pills overflow before the outer `flex-wrap` triggers. Add `flex-wrap` to the inner `gap-2` div.
- Audit `<pre>` JSON `user-tabs.tsx:232` scrolls horizontally inside card-inside-tab — awkward but admin-only, OK.

## 5. Post-action UX gaps

- All 5 user actions toast on success/error and `router.refresh()` — good.
- **Force sign-out toast doesn't restate the JWT caveat.** Dialog body warns "≤15 min until JWTs expire" (`user-actions.tsx:174`) but once toast fires the admin has no reminder. Cheap fix: `toast.success(msg, { description: 'Existing JWTs valid up to 15 min.' })`.
- **`/admin/users` doesn't refetch on back-nav** from `/admin/users/[id]` after soft-delete. Cached client state means a stale list row sits there until refresh. Minor.
- Soft-delete dialog honestly states "no UI to undo this" (`user-actions.tsx:196`) — fine.

## 6. Approved

- Server-side admin gating redirects to `/dashboard` not 403 (`admin/layout.tsx:47-49`).
- Self-toggle + self-delete disabled at UI (`user-actions.tsx:103,128`) — matches API rejections.
- `Admin` link in header only when `user.is_admin === true`, on both desktop nav and mobile dropdown (`dashboard-header.tsx:50-53`).
- Recharts isolated in `'use client'` island (`overview-charts.tsx`); overview shell stays RSC.
- Every list has an explicit empty state: TopList:345, RecentList:133/158/180, UsersList:180, all four tabs in `user-tabs.tsx`.
- Loading/auth-error/throw handled on every `serverFetch` (`admin/page.tsx:24-33`, `users/page.tsx:42-53`, `users/[id]/page.tsx:30-43`).
