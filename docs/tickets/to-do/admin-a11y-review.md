# Admin dashboard a11y review — Stages 1+2

**Scope:** commit `3bb1017` on `staging`. Read-only review. Bar = "doesn't kill keyboard/SR users."

---

## 1. TL;DR

- Keyboard reachability is solid — every interactive element is a real `<button>`, `<a>`, `<input>`, or `<select>`, no `div onclick=` patterns. Tab order matches the visual flow.
- Two concrete a11y holes: (a) the growth charts have **no textual fallback at all** — screen-reader users get zero data; (b) the users table updates on type-search with **no `aria-live` region**, so SR users don't hear "results changed."
- The Radix primitives (Dialog, DropdownMenu) are used correctly, so focus-trap + return-focus + Escape come for free. Self-toggle/self-delete safety rails also include a `title` tooltip — good defence-in-depth.

---

## 2. Critical a11y holes

None that fully lock out a keyboard user. The two below are SR-only, but on an admin surface they matter because they prevent an SR-using admin from doing their job.

**C1. Growth bar charts have no accessible name or text fallback.**
`apps/web/src/app/dashboard/admin/page.tsx:82, 86` (`<GrowthCharts data=… />`) and
`apps/web/src/app/dashboard/admin/overview-charts.tsx:38` (`<ResponsiveContainer>` → `<BarChart>`).
recharts renders SVG with no `role`, no `aria-label`, no `<title>`. An SR user lands on the chart card, hears the `<h3>` ("Daily signups (30d)"), then silence. **Fix:** wrap in `<figure aria-label="Daily signups over the last 30 days, peak N on YYYY-MM-DD">` with a `<figcaption className="sr-only">` containing a short textual summary derived from `data` (max/min/total), OR pass `aria-label`/`role="img"` directly on the `<BarChart>` root via `accessibilityLayer` (recharts ≥2.12 supports `accessibilityLayer` + `role`/`aria-label` props on chart components).

**C2. Live region missing on the users table on type-search.**
`apps/web/src/app/dashboard/admin/users/users-list.tsx:168-194` — `<table>` re-renders silently after each debounced refetch. **Fix:** add `aria-live="polite"` and `aria-busy={loading}` to the table wrapper (or to a parent `<div>` containing the row count + table). Even better, expose a visually hidden `<p className="sr-only" aria-live="polite">{items.length} of {total} users match</p>` that updates after each fetch.

---

## 3. Serious gaps

**S1. Search input is `type="text"` not `type="search"`.**
`users-list.tsx:146` — `<input type="text" placeholder="Search email…">`. Loses the SR "search field" announcement and the platform clear-button. **Fix:** `type="search"`. Also the `<label>` (line 144) wraps the input but contains no visible/SR text — the placeholder is the only label. Add `<span className="sr-only">Search users</span>` inside the `<label>`, or use `aria-label="Search users"` on the input.

**S2. Filter chips don't communicate selected state to SR.**
`users-list.tsx:212-234` — visual selection is via background colour only; no `aria-pressed`. **Fix:** add `aria-pressed={active}` to the `<button>` at line 222. Trivial one-line change, big SR win.

**S3. Tab buttons don't use the `tablist`/`tab`/`tabpanel` pattern.**
`user-tabs.tsx:38-72` renders four `<button>`s + a div, no `role="tablist"`, no `aria-selected`, no `role="tabpanel"`, no arrow-key handling. **Fix:** add `role="tablist"` to the container, `role="tab"` + `aria-selected={active}` + `aria-controls="tabpanel-xxx"` on each button, `role="tabpanel"` + `aria-labelledby` on the content. (Or migrate to Radix Tabs, which we already pull in transitively — same primitive style as Dialog/DropdownMenu.) Without this, the tabs read as "Shares (3) button, Library (12) button…" with no state.

**S4. Sort `<select>` has no label.**
`users-list.tsx:153-161` — bare `<select>` adjacent to the search input. SR reads only "combobox, Newest first." **Fix:** wrap in `<label className="sr-only">Sort users<select…/></label>` or add `aria-label="Sort users"`.

**S5. Postgres-tables `<table>` has no caption.**
`page.tsx:243` — `<table className="w-full text-sm">` listing table sizes. Spec calls this out: tables should have `<caption>` or `aria-label`. **Fix:** `<caption className="sr-only">Top Postgres tables by size</caption>` or `aria-label` on the table. Same applies to the users `<table>` at `users-list.tsx:169`.

---

## 4. Nice to have

- **N1.** No `<nav aria-label="Admin">` on the sub-nav strip (`layout.tsx:57`). Multiple `<nav>`s on the page (main dashboard header + admin sub-nav) — SR users can't tell them apart. One-line `aria-label` fixes it.
- **N2.** `← All users` back-link (`users/[id]/page.tsx:51`) uses a left-arrow glyph as part of the visible text. Acceptable for SR (reads as "left-pointing arrow All users") but `aria-label="Back to all users"` is cleaner.
- **N3.** Audit `<pre>` (`user-tabs.tsx:232`) is scrollable but not focusable — keyboard-only users with low FOV can't reach overflowed JSON. Add `tabIndex={0}` and `role="region"` with an `aria-label`.
- **N4.** "Load more" button (`users-list.tsx:199`) doesn't announce when new rows arrive. With the S2 fix to add `aria-live="polite"` on the table, this resolves automatically; otherwise add a SR-only "N more users loaded" message.
- **N5.** `focus-visible:ring-2` is on `Button` but **NOT** on the inline raw `<button>`s used for `TabButton`, `FilterChip`, the `Load more` button, or the `RecentList` anchors. Focus is reachable but barely visible (just the browser default outline against paper). Adding `focus-visible:ring-2 focus-visible:ring-accent` to these would unify the focus story.

---

## 5. Pleasantly surprised

- **P1.** Every action button on the user-detail right rail (`user-actions.tsx:91-135`) has a real text label — no icon-only buttons missing `aria-label`.
- **P2.** Self-toggle / self-soft-delete disable state is paired with a `title` (`user-actions.tsx:104, 129`) so the explanation is visible. Good defence-in-depth alongside the backend rejection.
- **P3.** Dialog (`user-actions.tsx:202-223`) uses Radix's `<DialogTitle>` and `<DialogDescription>` correctly — Radix auto-wires `aria-labelledby` + `aria-describedby` from these, so the focus-trap, return-focus, Escape, and announcement all work out of the box.
- **P4.** Sonner `<Toaster>` is mounted in `apps/web/src/app/providers.tsx:45`, so toast `role="status"` announcements fire on every admin action — the success/error path is SR-accessible.
- **P5.** All clickable cards/rows are real `<Link>`s or `<a>`s, not `onClick={() => router.push(…)}` divs. Tab order is intuitive and right-click "open in new tab" works.

---

**Word count:** ~480.
