# Onboarding tour + quick-share options (web)

**Status:** In progress on `staging`
**Owner:** James
**Scope:** Web app only — mobile parity captured in `mobile-tour-and-quick-share-followup.md`.
**Effort estimate:** ~4-6 hours across 3 commits (stream straight to `staging`, owner handles main-promotion).
**Created:** 2026-05-19

---

## TL;DR

Three things, prioritised in this order:

1. **Close out the one remaining open issue** on `ux-stream-review.md` — publish-toggle in-flight guard.
2. **First-run product tour** on the dashboard — explain *what a share is*, *why you'd use one*, *how to add items*, *how the QR works*, *publish to discovery*. Hand-rolled overlay, no new dep.
3. **Quick-share quick wins** on the QR modal — download QR PNG, Web Share API, copy as markdown citation, X/Twitter intent, mailto. Frontend-only — the print-poster PDF stays in its own (`qr-poster-pdf.md`) ticket since it needs the API.

---

## Why now

Product is live (cutover 2026-05-15). First-week feedback from outside-testers consistently shows people grasping *that* MyEtAl makes a QR but not *what the QR is for* on first sign-in. The `/demo` page exists but it's marketing-facing — not visible after auth. The dashboard's welcome banner only fires for fully-brand-new accounts (no ORCID, no shares, no library) and only offers "Add ORCID" / "Open library" — neither explains the wedge.

Quick-share buttons follow naturally from the same surface: once the user has a QR, the next gesture is "send this to someone." Today the only built-in path is Copy Link. Adding a small toolbar of obvious destinations (PNG, native share, X, email, markdown citation) removes friction from the moment that matters most (right after first-save).

---

## Bucket 1 — finish ux-stream-review (~20 min)

### State of the three "Serious" issues from `ux-stream-review.md`

Re-verified at HEAD of `staging` (2026-05-19):

| Issue | File | Status |
|---|---|---|
| 1. `removeItem` side-effect inside `setItems` updater | `share-editor.tsx:415-427` | **Resolved** — toast is outside the setter, `items.find()` reads from closure |
| 2. `aria-activedescendant` ignores Create row | `tag-input.tsx:320-333` | **Resolved** — `${listboxId}-opt-${visibleSuggestions.length}` is pointed at when `highlightOnCreate` |
| 3. Publish toggle has no in-flight guard | `share-editor.tsx:786-835` | **Open** — fix in this PR |

### Fix

`share-editor.tsx:786` — the `<button role="switch">` already has access to `publishMutation` and `unpublishMutation`. Two changes:

1. `disabled={publishMutation.isPending || unpublishMutation.isPending}` — visual + semantic gate.
2. Inside `onClick`, early-return if either mutation is pending. The disabled attr handles the mouse case; the early-return covers programmatic / keyboard-Enter-during-pending edge cases.

### Update ticket

Mark issues 1 and 2 as **Resolved** on `ux-stream-review.md` with the verification date and commit hash. Mark issue 3 as **Resolved** in the same commit that ships the fix.

---

## Bucket 2 — first-run dashboard tour (~2-3 hours)

### Goal

First time a signed-in user lands on `/dashboard`, show a 4-step explainer overlay. Dismissible. Persisted in localStorage. Re-launchable from a small "Show tour" link in the dashboard header so the user can pull it up again on demand.

### Steps (locked copy proposal)

| # | Anchor | Headline | Body |
|---|---|---|---|
| 1 | Page (no anchor) | What's a share? | A share is one curated link — a paper, a repo, a list of papers, a PDF, anything — packaged behind a single QR code. Put the QR on your poster, slides, or CV; people scan it and land on your collection. |
| 2 | `+ New share` button | Add anything you want people to find | Start a share, give it a name, then drag in papers from your library, paste DOIs, add GitHub repos, or upload a PDF. Each share is one QR — keep it focused on the moment you'll use it (conference poster, talk, application). |
| 3 | One share card (or `+ New share` if zero shares) | Each share has its own QR | Open a share to view its QR. Print it on a poster, embed it on a slide, or copy the link to send. Whoever scans it lands on a clean public viewer — no sign-up required. |
| 4 | Optional — `Publish` toggle (only visible when a share is open; skip if zero shares) | Make it findable | Turn on **Publish to discovery** to list your share in MyEtAl's search and let Google index it. Off by default — leave it off if the share is for a private audience (lab, conference attendees). |

### Implementation sketch

- New component: `apps/web/src/components/tour-overlay.tsx`.
  - Renders a backdrop (low-opacity, click-through-to-dismiss disabled) + a card positioned absolutely.
  - Step 1: centre of viewport (no anchor).
  - Steps 2-4: use a passed-in `anchorRef` (RefObject<HTMLElement>) and `getBoundingClientRect()` to position the card near the anchor with a small arrow.
  - Re-position on resize / scroll via `useLayoutEffect` + ResizeObserver.
  - Step controls: "Skip tour", "Back", "Next", "Done."
- New hook: `apps/web/src/hooks/useTour.ts` — wraps localStorage key `myetal.tour_dismissed.v1`. Exposes `{ shouldShow, dismiss, replay }`.
- Mount: in `apps/web/src/app/dashboard/page.tsx` (server component) we can't run client hooks directly — wrap in a `<DashboardTourSlot />` client component that subscribes to `useTour` and decides whether to render `<TourOverlay />`.
- Re-launch entry point: small "Show tour" text-button in the dashboard header next to "+ New share" (or in the avatar dropdown — TBD on first sweep).

### What we are NOT doing

- No third-party tour library (driver.js, intro.js, shepherd) — fewer kB and full design control.
- No keyboard-driven highlight rectangle — the anchored card + arrow is enough for v1.
- No tour on `/c/[code]` viewer for scanners — they're transient visitors; no need.
- No analytics events for tour step views — add later if we want a funnel.

### Decision points

- **Trigger:** first dashboard visit, OR only when `shares.length === 0`? Recommend **first visit regardless of share count** — repeat visitors might miss it but they can find "Show tour." New owners who haven't made a share yet need it most; owners who already have shares can dismiss in 2s.
- **localStorage key version:** `myetal.tour_dismissed.v1` — bumping to `.v2` re-triggers for everyone after a copy refresh.
- **Style:** match `bg-paper` / `border-rule` / `font-serif` tokens already in use.

---

## Bucket 3 — quick-share options on QR modal (~1.5-2 hours)

### Goal

Where `QrModal` already shows the QR + code + URL with copy affordances, add a small grid of one-tap share destinations.

### What to add

| Action | Implementation | Notes |
|---|---|---|
| Download QR PNG | `<a href="/public/c/{code}/qr.png" download="...">` | Endpoint already exists |
| Native share | `navigator.share({ url, title })` button | Feature-detect via `if ('share' in navigator)`; hide on browsers without it |
| Copy as markdown citation | `[{name}]({url})` to clipboard | Useful for slack / notion / blog posts |
| Share on X | `https://twitter.com/intent/tweet?text=&url=` | No tracker; just the intent URL |
| Email | `mailto:?subject=&body=` | Works everywhere, no dep |

### Layout

A 2x3 grid below the existing code + URL copy buttons, above the Done/Keep editing CTA row. Each is an icon + label button (small). On mobile-web the native-share button gets primary visual weight.

### Out of scope (linked)

- **Print poster PDF** — needs `reportlab` + a new `/public/c/{code}/poster.pdf` endpoint. Already its own ticket: `qr-poster-pdf.md`. Leave a visual slot in the grid so it slots in cleanly later.
- **Mobile parity** — `mobile-tour-and-quick-share-followup.md`. Mobile already has access to the native iOS/Android share sheet, so the work shape is different.

---

## Suggested commit shape

Stream straight to `staging`, owner handles main promotion:

1. `fix(web): publish-toggle in-flight guard + close ux-stream-review` (~20 min)
2. `feat(web): first-run dashboard tour overlay` (~2-3 hr)
3. `feat(web): quick-share options on QR modal` (~1.5-2 hr)

Each is self-contained, each can be reverted independently if any feel wrong on staging.

---

## Acceptance checklist

### Bucket 1
- [ ] Publish toggle button has `disabled` while either mutation is pending
- [ ] Rapid double-click no longer fires two mutations (verify in Network panel)
- [ ] `ux-stream-review.md` status table updated to show all three issues Resolved

### Bucket 2
- [ ] First sign-in on a fresh browser opens the tour overlay automatically
- [ ] "Skip" / "Done" persist `myetal.tour_dismissed.v1` so it doesn't re-trigger
- [ ] "Show tour" link in dashboard header re-launches the overlay regardless of localStorage
- [ ] Tour overlay does not break dashboard interactions when dismissed
- [ ] No console errors on tour open / step / close cycle

### Bucket 3
- [ ] QR modal shows all 5 quick-share affordances (PNG, native share if supported, markdown, X, mail)
- [ ] Native share button hidden on browsers without `navigator.share`
- [ ] PNG download triggers a file save (not a tab open)
- [ ] Copy markdown copies `[name](url)` and fires `toast.success('Citation copied')`
- [ ] X intent and mailto open in the right surfaces (new tab / mail client)
- [ ] No visual regression on the existing code + URL copy buttons or Done/Keep editing CTA

---

## Mobile parity (NOT in this ticket)

Captured in `mobile-tour-and-quick-share-followup.md`. Short version:
- Mobile dashboard tour — same 4 steps, native modal stack.
- Mobile QR view — wire to native share sheet (`Share.share` from `react-native`).
- Down-prioritised until web shape is settled.
