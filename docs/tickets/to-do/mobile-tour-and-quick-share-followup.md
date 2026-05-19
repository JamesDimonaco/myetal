# Mobile parity — tour + quick-share (follow-up)

**Status:** Backlog — pull after web bundle (`onboarding-tour-and-quick-share.md`) lands and bakes for a week
**Owner:** James
**Scope:** Mobile app (`apps/mobile`) only
**Effort estimate:** ~1-1.5 days
**Created:** 2026-05-19

---

## Why this exists

The 2026-05-19 web bundle (`onboarding-tour-and-quick-share.md`) shipped two surfaces that have natural mobile counterparts:

1. **First-run dashboard tour** explaining shares, items, QR codes, publishing.
2. **Quick-share affordances** on the QR modal — native share, PNG download, social intents.

Mobile didn't ship in the same PR because:
- Owner directive (2026-05-19): "only work on the webapp for now."
- Mobile's gestures and primitives are different enough that copy-pasting the web component shape would be wrong.
- The web shape needs a week of real use before we lock the mobile copy + flow.

This ticket holds the mobile work so it's not lost.

---

## Parity items

### 1. First-run tour on the mobile dashboard

**Surface:** `apps/mobile/app/(authed)/index.tsx` or wherever the post-sign-in landing screen lives.

**Steps:** same four as web — *What's a share?* / *Add anything* / *Each share has its own QR* / *Make it findable*. The copy stays in sync; consider extracting a shared `lib/tour-content.ts` constant if both platforms end up wanting it.

**Implementation:**
- React Native modal stack — likely `react-native-reanimated` or a plain `Modal` with fade.
- Persist dismissal in `expo-secure-store` or `AsyncStorage` (whichever the app already uses for non-secret prefs). Key: `myetal.tour_dismissed.v1`.
- Re-launch entry point: profile screen "Show tour" row.

**Out of scope for v1:** anchored steps (mobile UI shifts a lot — centred cards with screenshot-style illustrations are likely a better mobile pattern than DOM-anchored arrows).

### 2. Quick-share on the mobile QR view

**Surface:** wherever the share's QR is shown in mobile (likely a share-detail screen).

**Existing primitives:**
- `import { Share } from 'react-native'` — `Share.share({ url, title, message })` opens the native iOS / Android share sheet, which already includes mail / messages / X / saved to camera-roll / etc. No need to manually wire intent URLs like we do on web.
- File save: use `expo-file-system` to download `/public/c/{code}/qr.png` and offer "Save to Photos" via `expo-media-library` permission flow.

**What to add:**
- Primary "Share" button → `Share.share()` with the canonical URL and share name.
- Secondary "Save QR to Photos" button.
- "Copy link" + "Copy code" already exist; double-check they're there.

**What NOT to add:** dedicated X / email buttons. The native share sheet covers them and adds many more destinations the user already has configured.

---

## Decision points (deferred)

- Whether to ship one PR (tour + quick-share) or two — likely one; both are small.
- Whether the tour should auto-trigger on every fresh install or only on first-time-after-this-ticket-lands. Tied to dismissal-key versioning.
- Whether to keep the web's "Copy as markdown citation" on mobile. Probably yes — researchers paste citations into mobile notes / slack on the go.

---

## Acceptance checklist (rough)

- [ ] Mobile dashboard shows 4-step tour on first launch after this ticket lands
- [ ] Tour persists dismissal across app restarts
- [ ] Profile screen has a "Show tour" entry point
- [ ] Share-detail screen has a primary "Share" button that opens the native share sheet
- [ ] Share-detail screen has a "Save QR to Photos" button that persists the PNG to the device gallery
- [ ] No regressions to existing share-detail copy-link / copy-code behaviour

---

## Triggers to expand later

- Demand for screenshot or video tutorials within the tour (rather than text cards) — add if onboarding completion rate is low.
- Demand for sharing a *whole* MyEtAl profile rather than just a single share — separate ticket; out of scope here.
