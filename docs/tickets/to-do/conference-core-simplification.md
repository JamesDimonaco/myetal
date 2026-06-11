# Conference-core simplification — focus the product on the QR loop

**Status:** Implemented (2026-06-11) on `claude/practical-hertz-4b3f13` — awaiting owner testing.
Streams 1–3 all built (commits `c75817d`, `63160ca`, `54ec18e`, `7ef804b`). Item 11
(mobile-web QA) done for every touched surface (QR-modal scroll + responsive QR,
share-card break-words, `bg-surface-sunken` token fix); a full-app 375px sweep is
still worth a manual pass. Deploy notes: API needs `RESEND_API_KEY` set in prod
for email-me (skips with a warning otherwise); reportlab ships via uv.lock.
**Owner:** James
**Effort estimate:** ~4-6 days across 3 streams (hide / polish / add)
**Companion to:** `qr-poster-pdf.md` (absorbed, web-only), `discovery-and-handles-future.md` (lightweight v1 absorbed), `share-editor-ux-polish.md` (complementary), `mobile-tour-and-quick-share-followup.md` (ON HOLD — see below)

---

## TL;DR

The product's magic moment is **scan this** — a researcher at a poster, a QR code,
a clean collection on the visitor's phone. Everything in the app that is not on
the path *sign up → papers in → make a share → print/show the QR → someone scans
it* is surface area we pay for in new-user confusion.

This ticket (1) hides the off-path surfaces, (2) slims the core path, and
(3) adds four small conference-shaped features that make the QR loop stronger.

**Audience reminder:** academics — young researchers and senior ones — sharing
work at conferences. They will not explore the app; they will do the one thing
they came for. Make that one thing unmissable.

---

## Platform decision: mobile app ON HOLD

**Decided 2026-06-11 (owner):** the Expo mobile app is paused. Web only for now.

Rationale: scanning a QR uses the phone's *camera* and opens the *web* viewer —
the native app is not on the visitor's path. For creators, the web app works on
mobile. Maintaining a second client at feature parity (see
`mobile-tour-and-quick-share-followup.md`) costs more attention than it returns
at current user counts.

Consequences:
- `mobile-tour-and-quick-share-followup.md` → **on hold** (do not pull).
- New features in this ticket are **web only** — no mobile-parity follow-up
  tickets get created for them.
- **Mobile *web* is now a first-class target.** Every surface this ticket
  touches must work well at 375px width: the public share viewer, the dashboard,
  the share editor, the new researcher page, presenter mode. A responsive QA
  pass is an explicit work item (Stream 3, item 9), not an afterthought.
- The `apps/mobile/` code stays in the repo, untouched. Revisit when web is
  sticky and demand justifies it.

---

## Stream 1 — Hide (get the authed nav down to one verb)

Current authed nav: **Shares | Library | Browse | Search | Feedback | (Admin)**.
Six destinations before the user has done anything. Target: **Shares (+ Admin)**
with everything else reachable but not shouting.

### 1. Drop Browse + Search from the authed nav

With few users, trending/discovery surfaces are empty rooms — they signal
"nobody's here" to exactly the people we want to impress. The routes stay
(public SEO, related-shares links on `/c/{code}` still feed them); they just
leave the header.

- Remove **Browse** and **Search** links from the authed `DashboardHeader` nav.
- Keep `/browse` and `/dashboard/search` routes functional and indexed.
- Public share pages keep their related/similar-collections links (quiet
  discovery that doesn't depend on a populated trending page).

### 2. Move Feedback into the avatar menu

Feedback matters to us, not to them. It doesn't earn a top-level slot.

- Remove the **Feedback** nav link; add a "Send feedback" item to the avatar
  dropdown (and keep a small footer link).
- `/dashboard/feedback` route unchanged.

### 3. Demote Library from the nav; surface it inside the editor

The Shares-vs-Library split is the heaviest concept in the app — two content
models before the user has done anything. The feature stays; the nav slot goes.

- Remove **Library** from the main nav; add "My papers" to the avatar dropdown.
- Inside the share editor's add-item flow, make "from your library /
  import from ORCID" a visible path (see Stream 2).
- The dashboard welcome banner keeps its ORCID/library CTA for new users.

### 4. Tuck PDF upload behind the editor

Off the core path (the DOI already links to the paper) and a moderation/storage
liability we don't need to advertise.

- In the add-item modal, order the tabs paper-first (DOI/search), then link,
  then repo, with **PDF last**.
- No removal — the flow keeps working for those who want it.

---

## Stream 2 — Polish the core path

### 5. Share editor "simple mode"

The editor (`share-editor.tsx`, ~1,600 lines) front-loads every option. Default
view becomes: **title → add items → save/publish → QR**. Everything else folds
behind a "More options" disclosure.

- Visible by default: title, items list + add-item button, save/publish, QR.
- Behind "More options" (collapsed disclosure): description, tags.
- Disclosure auto-expands when an existing share already has a description or
  tags (never hide the user's own data).
- No functional removals — pure layout. The `share-editor-ux-polish.md` items
  remain separate and complementary.

### 6. Dashboard as a funnel

- One prominent **New share** action; shares list below.
- Welcome banner (already shipped) stays for brand-new users.
- Library/ORCID entry points live in the banner + avatar menu, not the nav.

---

## Stream 3 — Add (all conference-shaped)

### 7. QR poster PDF (absorbs `qr-poster-pdf.md`, web-only)

Print-ready A4 portrait PDF from the QR modal: big QR, share name, short URL,
owner name, small wordmark. Full spec in `qr-poster-pdf.md` — followed as
written except **the mobile button is dropped** (app on hold).

- API: `GET /public/c/{short_code}/poster.pdf` (reportlab, edge-cacheable).
- Web: "Download poster (PDF)" button in the QR modal.

### 8. Researcher page — `/u/{user_id}` (lightweight v1)

One permanent URL + QR **per researcher**, not per share. For the business
card, the email signature, the title slide. This is the lightweight version of
`discovery-and-handles-future.md` — **no handle migration**: the route takes
the user UUID; pretty `@handles` stay deferred per that ticket (URL aesthetics
don't matter inside a QR code).

- API: `GET /public/users/{user_id}` → display name, ORCID iD, published
  shares (reuses the owner-filter query that powers `/browse?owner_id=`).
  404 for unknown users; users with zero published shares render an empty
  state, not a 404 (the QR on the business card must never dead-end).
- Web: `/u/[id]` server-rendered page — name, ORCID link, list of published
  shares (share-card grid), personal QR + copy-link affordance.
- Dashboard: "Your public page" link so owners can find/print their own QR.
- When real handles ship later, `/u/{handle}` joins and `/u/{uuid}` keeps
  resolving (QRs already printed on business cards must not break).

### 9. "Email me this collection" on the public viewer

People scan posters and forget. Let a visitor send themselves the link in one
tap — captures the moment without an account.

- API: `POST /public/c/{short_code}/email` `{ email }` → sends a short Resend
  email ("Your saved collection: {name} — myetal.app/c/{code}"). No auth.
  **Strict rate limit** (per-IP, low ceiling) — this is an anonymous
  email-sending endpoint and must not become a spam cannon. Always return
  204 (no email-existence oracle). 404/410 semantics match the share page.
- Web: small "Email me this" affordance on `/c/{code}` — input + send, inline
  success state. No cookies, no account.

### 10. Presenter mode — `/c/{code}/present`

The last slide of every talk: a fullscreen QR + title. Promoted from the
"scoped, not yet written up" list.

- Route: `/c/{code}/present` (web, anon, no chrome/header).
- Slide 1: share title + giant QR + short URL — readable from the back row.
- Subsequent slides: one item per slide, big text (title, authors, year).
- Navigation: arrow keys / click / swipe. Esc or link back to `/c/{code}`.
- Entry point: a "Present" button on the public share page (and nothing else
  for v1).

### 11. Mobile-web QA pass

With the app on hold, mobile web *is* mobile. Explicit pass at 375px across:
landing, sign-in/up, dashboard, share editor (create + edit + add-item modal),
`/c/{code}`, `/u/{id}`, presenter mode, QR modal. Fix what's broken; file what's
big.

---

## Out of scope

- Anything in `apps/mobile/` (on hold).
- `@handle` migration, reserved names, profile-edit UX (stays in
  `discovery-and-handles-future.md`).
- Comments, email digests (existing tickets, unchanged).
- Removing Browse/Search/Library/Feedback/PDF-upload *functionality* — this
  ticket only changes prominence, never capability.
- Editor rewrite — simple mode is layout folding, not a refactor.

---

## Acceptance checklist

### Hide
- [ ] Authed nav shows Shares (+ Admin for admins) only.
- [ ] Feedback + Library ("My papers") live in the avatar dropdown.
- [ ] `/browse`, `/dashboard/search`, `/dashboard/library`, `/dashboard/feedback` all still work by URL.
- [ ] Add-item modal tab order: paper, link, repo, PDF.

### Polish
- [ ] New-share editor shows title/items/publish only; description + tags behind "More options".
- [ ] Disclosure auto-opens when editing a share that has description/tags.

### Add
- [ ] `GET /public/c/{code}/poster.pdf` → valid A4 PDF (`%PDF-` sniff test), 404/410 semantics, cache headers; QR scans from 30cm.
- [ ] QR modal has "Download poster (PDF)".
- [ ] `GET /public/users/{id}` → name + published shares; 404 unknown user; empty state for zero shares.
- [ ] `/u/{id}` renders name, ORCID link, share grid, personal QR; works at 375px.
- [ ] `POST /public/c/{code}/email` sends via Resend, rate-limited per-IP, always 204 on accepted input.
- [ ] "Email me this" works on `/c/{code}` without an account.
- [ ] `/c/{code}/present` fullscreen QR slide + per-item slides, arrow/click/swipe nav.
- [ ] All API additions covered by tests (happy + 404/410 + rate-limit paths).

### Mobile web
- [ ] 375px pass on landing, dashboard, editor, `/c/{code}`, `/u/{id}`, present mode — no horizontal scroll, tap targets ≥ 44px on primary actions.

---

## Risks

- **Anonymous email endpoint** — the spam-cannon risk is real; rate limit
  hard and keep the email content fixed (no user-controlled body text beyond
  the share name, which is already public).
- **share-editor.tsx surgery** — biggest file in the app; simple mode must be
  layout-only. Anything that smells like a refactor stops and gets its own
  ticket.
- **Hidden ≠ gone** — users who had Library/Browse muscle memory lose nav
  slots. Acceptable at current user counts; revisit on feedback.
- **reportlab fonts** — built-in fonts are Latin-1; non-Latin share titles fall
  back with replacement chars. Documented v1 limitation (per `qr-poster-pdf.md`).
