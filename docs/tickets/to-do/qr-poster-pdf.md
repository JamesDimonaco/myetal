# QR Poster PDF — print-ready download

**Status:** Proposal — small + tangible, ship-on-a-Saturday-afternoon
**Created:** 2026-05-08
**Owner:** James
**Effort estimate:** ~1.5 days

---

## TL;DR

Researchers print posters for conferences. Today the QR appears in a modal as a PNG they screenshot. **A real print-ready A4 PDF — QR centred, share name, short URL, optional owner name — is the difference between *"use it"* and *"fiddle with it."***

The QR is the bridge from physical → digital. This ticket makes that bridge actually printable.

---

## Why this is on-wedge

The product north star is *paper → share → QR → done*. The QR's whole job is the physical handoff: poster, slide deck, business card. The current QR modal is the dead-end of the celebratory moment — *"you made a share!"* — but ends with a screenshot tax.

Shipping a one-click *"Download poster (PDF)"* removes that tax. Cheap, on-wedge, visibly differentiated vs anyone else who'd just give you a PNG.

---

## Current state

- `apps/api/src/myetal_api/api/routes/public.py` already serves `GET /public/c/{short_code}/qr.png` for the bare QR PNG.
- Web's `QrModal` component (`apps/web/src/components/qr-modal.tsx`) shows the PNG plus a copy-link affordance. No download.
- Mobile shows the QR via the `qrcode.react`/equivalent in the app.
- No PDF generation infrastructure on the API yet.

---

## Proposed state

### Backend

New route: `GET /public/c/{short_code}/poster.pdf` — anon-readable, same access semantics as `/c/{short_code}` (404 unpublished, 410 tombstoned).

Composition (one layout, A4 portrait):

- Centred QR (large — 12cm square, generated from the same logic as `qr.png`).
- Share name in serif headline below the QR.
- Short URL `myetal.app/c/{short_code}` underneath in monospace.
- Optional owner name footer ("by Alice Smith") — only when share has an owner display name set.
- Subtle wordmark `Built with myetal.app` in the footer (small, grey).

Library: **`reportlab`** (~30 MB Python lib, no system deps). Add to `apps/api/pyproject.toml`. Caches well — content is purely a function of `(short_code, share.name, share.owner_display)`, so set `Cache-Control: public, s-maxage=86400` on the response. The CDN edge handles the rest.

Add `qrcode` lib if not already present (it should be — used for the PNG). Reuse the QR-generation function so the PNG and PDF stay byte-equivalent.

### Web

Add a *"Download poster (PDF)"* button to the `QrModal`, styled like the existing copy-link affordance. Direct link to `/public/c/{short_code}/poster.pdf` — browser handles the download.

### Mobile

Equivalent button in the share's QR modal screen. Tap → `Linking.openURL(...)` opens in the default browser, which downloads. No native PDF handling needed.

---

## Why it's small

- Single endpoint.
- Single A4 layout — no design freedom for v1.
- No client-side rendering work; pure download link.
- No new auth pattern.
- No new storage (the PDF is generated on demand and edge-cached, not stored).
- Reuses the existing QR-generation logic.

The lowest-viable scope is *"the link works, the PDF is sane, the QR scans cleanly."* Everything else (custom branding, multi-paper layouts, alternative paper sizes) is a future ticket.

---

## Effort breakdown

| Chunk | Time |
|---|---|
| Backend: `reportlab` wiring, route, layout, cache headers, test | ~1 day |
| Web: download button in QrModal | ~0.25 day |
| Mobile: download button in QR screen | ~0.25 day |
| **Total** | **~1.5 days** |

---

## Decision points (small)

1. **A4 vs Letter.** Owner is in the UK; pick **A4**. US/Canada users get a slightly off-sized printout — acceptable for v1; revisit if it becomes a complaint.
2. **Wordmark in footer: yes/no.** Recommend **yes**, small + grey + at the bottom. It's free distribution.
3. **Owner name.** Show when the share has a non-anonymous owner. Default `share.owner.name`; null gracefully.
4. **Title font.** Bundle a single open-source serif (e.g., EB Garamond or the project's existing serif if there is one — check `apps/web/src/app/globals.css`). Don't ship a font subset; reportlab handles full TTFs fine.

---

## Out of scope

- Multi-page poster layouts (e.g., one page per item).
- Custom branding (colours, logos, alt-fonts).
- Multiple paper sizes (Letter, A3, etc.).
- Watermarks / draft state.
- QR-only mode (we already have `qr.png` for that).
- Editable poster preview before download.

---

## Acceptance checklist

- [ ] `GET /public/c/{short_code}/poster.pdf` returns a 200 with `Content-Type: application/pdf` for a published share.
- [ ] 404 for an unpublished or non-existent share.
- [ ] 410 for a tombstoned share.
- [ ] PDF is A4 portrait, QR scannable from a phone camera at 30cm distance.
- [ ] Share name renders in the serif font; truncates gracefully past one line.
- [ ] Short URL renders in monospace below the name.
- [ ] Owner display name renders when set; absent block when null.
- [ ] `Cache-Control: public, s-maxage=86400` on the response.
- [ ] Web QrModal has a "Download poster (PDF)" button alongside copy-link.
- [ ] Mobile QR view has the equivalent button (opens via `Linking.openURL`).
- [ ] Backend test: route returns valid PDF bytes (sniff `%PDF-` prefix).
- [ ] Backend test: 404 + 410 paths covered.

---

## Risks

- `reportlab` adds ~30 MB to the API image. Acceptable.
- Unicode share names in non-Latin scripts — confirm the bundled font has glyph coverage. If not, document the limitation and fall back to a sans for non-Latin titles.
- Long share names blowing the layout — truncate at ~80 chars in the PDF (different from the web display limit, fine).
- Per-PDF generation time on the Pi: ~200ms expected; the cache header carries the load.

---

## Triggers to expand later

- *"Can I customise the poster?"* — add brand colours, owner avatar, multi-page item list.
- *"Letter paper sucks for me"* — add `?size=letter` query param.
- *"I want to print 50 of these for my workshop"* — bulk endpoint with all members' shares laid out.

None of these expansions justify their cost today. Ship v1, watch usage, expand if anyone asks.
