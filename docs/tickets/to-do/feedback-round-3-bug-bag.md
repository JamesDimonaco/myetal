# Feedback round 3 — bug bag from Nick

**Status:** Triage — not yet investigated
**Created:** 2026-05-09
**Source:** Nick (Telegram, 06:55) + owner observations same day
**Owner:** James
**Effort estimate:** unknown until triage; expect ~2-3 days total once unpacked

---

## TL;DR

Seven user-visible issues across web + mobile + auth. None are critical security flaws — all are UX or polish bugs that have crept in. Capture now so they don't get lost; investigate properly post-Railway-cutover when prod is stable.

---

## The list

| # | Where | Bug | Suspected cause | Priority guess |
|---|---|---|---|---|
| 1 | Web (share editor) | "Publish to discovery" still needs to be pressed twice | Form double-submit / state sync issue. Owner thought this was fixed in PR-B; appears regressed or never landed properly. | P1 — main wedge motion |
| 2 | Mobile | Sign-in required every app launch (no session persistence) | Mobile is reading stale/missing token from `expo-secure-store`, or the JWT TTL (15 min for BA) is being treated as the session lifetime. **Note this is a pre-BA observation — may be unrelated to the Better Auth migration in flight.** | P1 — actively annoying every user, every launch |
| 3 | Web (profile page) | Scrollbar styling looks weird | CSS — likely a rogue overflow or the chalkboard-theme CSS hitting an unstyled element. | P3 — cosmetic |
| 4 | Web (sign-in) | Google + GitHub provider logos not displayed | Icon import broken, or asset path wrong, or icon library version mismatch after a recent dep bump. Should be a 5-min fix once located. | P2 — sign-in surface, first impression |
| 5 | Web (home) | Need a way to clear recent items | Feature request — UX. Either an inline X-per-item, or a "Clear recents" button. Decide UX before building. | P3 — nice-to-have |
| 6 | Web (collection page) | White flash at top in dark mode + "no collection found" page styling broken | Two issues bundled: (a) layout/header not respecting dark-mode tokens at the top of `/c/[code]` shell, (b) the empty/404 state page hasn't been themed. | P3 — cosmetic, dark-mode users |
| 7 | Mobile | "Import from ORCID" button greyed out / not working | Likely the button is disabled when `user.orcid_id` is null OR the network call isn't firing. Check `apps/mobile/app/(authed)/profile.tsx` (or wherever the ORCID import lives) — is it gated on a flag that's wrong? | P1 — core wedge feature, advertised in dashboards |

---

## How to triage when picking this up

1. **Reproduce each one** on the current `main` branch (or post-Railway) before touching code. Some may already be fixed in `feat/better-auth-migration` if BA is the indirect cause (especially #2).
2. Group by surface so a single PR can cover multiple. Likely groupings:
   - Web styling bundle: #3, #5, #6 — all CSS / dark mode hygiene.
   - Auth / session: #2 (mobile session persistence), possibly #4 (sign-in icons) — touch sign-in flow files.
   - Wedge functionality: #1 (publish double-press), #7 (ORCID button) — high priority, separate investigation each.
3. Add a regression test for #1 in particular — it's now been reported twice across feedback rounds.

---

## Out of scope / deferred to other tickets

- Anything in `better-auth-followups.md` — keep account-linking work separate.
- Pre-existing eslint warnings in `useSavedShares.ts` — mentioned in the BA known-limitations doc.

---

## Decision triggers

- **Reproduce rate:** if any of these turn out to be hard to repro reliably, deprioritise vs the easy wins.
- **#2 specifically:** if the mobile session-persistence bug also exists post-Better-Auth migration, it becomes a Better Auth follow-up rather than a standalone bug.
