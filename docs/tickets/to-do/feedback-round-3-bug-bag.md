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

---

## Investigation notes (2026-05-08, polish/feedback-round-3 pass)

### Status summary

| # | Status | Where the work landed |
|---|---|---|
| 1 | INVESTIGATED — no fix shipped | Notes below |
| 2 | SKIPPED — Better Auth migration owns this | — |
| 3 | FIXED (rolled into web styling commit) | `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx` |
| 4 | INVESTIGATED — no obvious cause in code | Notes below |
| 5 | DESIGN NOTE — not built | Notes below |
| 6 | FIXED (rolled into web styling commit) | same as #3 |
| 7 | INVESTIGATED — working as designed | Notes below |

### #1 Publish-to-discovery double-press

Re-read `apps/web/src/components/share-editor.tsx:589-622` (the toggle) and
the prior `2f1cda3` "double-tap" / `2fde6a8` "snap-back" fixes. The current
shape is:

- Local `publishedAt` state seeded once from `initial?.published_at`.
- `onClick` synchronously sets the optimistic value and fires
  `publishMutation.mutateAsync()`.
- Success branch is a no-op (correct — optimistic value already wins).
- Error branch reverts. Mutation `onSuccess` populates `qc.setQueryData`
  but the editor doesn't subscribe to that read, so no re-seed.

That all looks right on paper. Nothing in the diff against `2f1cda3` would
re-introduce the regression; the file has only been touched for unrelated
PDF/auto-save work since then. Not confident enough to ship a fix blind.

**Working hypotheses to verify in repro:**
- a) The user is clicking the *form's* "Save changes" button expecting it
  to publish. The toggle is a separate gesture and saves immediately —
  copy/affordance ambiguity, not a state bug.
- b) Closure capture: `mutation.mutateAsync()` is called after
  `setPublishedAt(newValue)` but reads `publishMutation` /
  `unpublishMutation` from the outer scope — those are stable hook results,
  fine. The `previousValue`/`newValue` are captured per-click, also fine.
- c) PostHog session replay autocapture: replay is enabled with mask
  defaults (`apps/web/src/components/posthog-*`) — if `data-ph-no-capture`
  rebinds something or the click is double-fired by the toolbar, the
  optimistic state would still flip on first press.

**Repro to run before next attempt:**
1. Open dashboard share editor on a published share.
2. Open devtools → Network. Toggle once. Confirm exactly one `POST /publish`
   or `DELETE /publish` fires per click.
3. If two fire on a single physical click, suspect React dev-mode strict
   double-invoke or PostHog autocapture binding twice.
4. Add a regression test once cause is known. Round-2 ticket already flagged
   this should have one; it doesn't.

### #4 Sign-in icon assets

`apps/web/src/components/{google,github,orcid}-icon.tsx` are inline SVGs
with hard-coded brand colours (Google) or `currentColor` (GitHub). They
import correctly into `apps/web/src/app/sign-in/page.tsx`. Nothing in the
build pipeline strips inline SVG. Typecheck/build are clean. No CSP
configured that would block inline SVG.

If Nick is on a browser/extension that hides third-party brand assets
(`uBlock Origin`'s "annoyances" lists sometimes hide Google/GitHub login
buttons), the icons would render as 0-width — but the surrounding text
"Continue with Google" / "Continue with GitHub" would still show, which is
consistent with the report ("logos not displayed", not "buttons missing").

**Next step:** ask Nick to (a) screenshot dev-tools → Elements showing the
`<svg>` is in the DOM, and (b) try in incognito with no extensions. If the
SVG is in the DOM but invisible, it's an extension; if it's missing entirely
that's a bundler regression and we dig in.

### #5 Clear recent items — design note (not built)

The "recent items" surface is `apps/web/src/components/saved-shares-section.tsx`
("Saved collections"), backed by `useSavedShares` → localStorage. There's
already a per-item `unsave()` available — just no UI calling it. Two UX
options for the owner to pick:

- **Option A — inline X per row.** Add a small ✕ button on each row that
  calls `unsave(shortCode)`. Discoverable, no nav needed. Cost: ~10 lines.
- **Option B — "Clear all" button.** Single button under the list that
  empties the array. Coarser; matches the user's verbatim ask but loses
  per-item granularity.

Recommendation: A. It composes (you can clear all by tapping individual X's,
and unsaving is already supported elsewhere via the SaveButton on `/c/`),
matches the gesture users already know from email/Slack, and avoids the
"are you sure?" modal that B would need.

Out-of-scope ask: nothing here touches the *home* page's "Recently
published" section (those are public, server-driven, can't be cleared by
the viewer — this is a different surface).

### #7 Mobile "Import from ORCID" greyed out

Read `apps/mobile/app/(authed)/library.tsx:305-341`. The button is gated:

```ts
const orcidDisabled = !orcidId;
// ...
disabled={orcidDisabled || syncOrcid.isPending}
```

`orcidId` comes from `useAuth().user?.orcid_id`. If the user hasn't set an
ORCID iD on their profile, the button is **disabled by design** with the
hint "Add your ORCID iD on your profile first". This is correct behaviour
— matches the API contract (POST `/orcid/sync` returns 400 when
`orcid_id IS NULL`) and matches the equivalent web flow.

**If Nick has set an ORCID iD and still sees it greyed out**, that's a
different bug — `useAuth` is returning a stale user, or `/auth/me` is not
returning `orcid_id` after profile save. Verify by:
1. Profile tab → confirm ORCID iD field shows the saved value.
2. Pull-to-refresh on Library.
3. If button is still grey, log `user.orcid_id` and check the `/auth/me`
   response in flight.

No code change shipped — current behaviour is correct.

