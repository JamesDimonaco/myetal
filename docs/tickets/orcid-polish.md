# ORCID Integration — UX Polish Plan

**Status:** Proposal
**Created:** 2026-05-07
**Owner:** James
**Depends on:** orcid-integration-and-account-linking.md (Phase A)
**Effort estimate:** ~1 day, single PR

## TL;DR

Phase A landed: ORCID OAuth on web and mobile sign-in, manual `orcid_id` entry on the profile page, `PATCH /auth/me` on the backend, plus the recent fix-ups (hijack hardening on `_find_or_create_user`, TOCTOU close on the uniqueness check, web SVG path / type regression, and the mobile edit-clobber from the `useEffect` reseed). The flow works, but the UX is rough in researcher-facing ways: nothing on either platform tells users we never write to their ORCID record (the #1 unspoken concern), the profile section has three buttons doing two jobs, the sign-in screens silently invite users to create a duplicate account, and web/mobile copy and affordances have drifted apart. This plan is a single ~1-day PR that tightens copy, collapses redundant buttons, adds a duplicate-account warning under the ORCID sign-in button, and brings web and mobile back into parity. Account linking is explicitly out of scope — that remains Phase B, blocked on the Better Auth migration.

## Current vs Proposed (at a glance)

| Aspect | Today | After polish |
|---|---|---|
| Trust statement (read-only) | Absent on both platforms | Single sentence on profile + sign-in: "We only read — we never write to your ORCID record." |
| Profile description copy | Web: "Connect your ORCID record so you can import your works." Mobile: "Link your ORCID iD so collaborators can find your work." | Identical sentence on both platforms with the read-only clause. |
| Save button states | Web shows "Save" / "Save (clear)" / "Saving…" plus a separate "Remove" button | One primary button: "Save" when adding/changing, "Remove" (destructive) when input matches saved value or is empty. |
| Sign-in linking warning | None | One quiet line under the ORCID button on both sign-in screens: "Already signed up with Google or GitHub? Add your ORCID iD on your profile instead — signing in with ORCID will create a separate account." |
| Mobile sign-in icon | Text only ("Continue with ORCID") | Adds the official ORCID iD glyph, matching web's `OrcidIcon`. |
| "What's an ORCID iD?" link | Mobile has a separate tappable link; web only has an inline "Find your ORCID iD" inside the input helper | Both platforms show a separate "What's an ORCID iD?" link under the input. |
| Web Remove confirmation | Removes silently on click | Native `confirm()` dialog mirroring mobile's `Alert.alert`. |
| Mobile keyboard | Profile screen has no `KeyboardAvoidingView`; Save button hides under the keyboard on small screens | Wrap the `ScrollView` in `KeyboardAvoidingView`, matching `sign-in.tsx`. |
| Mobile dev-paste title | `"Finish GitHub sign-in"` shown for Google and ORCID too | Renamed to `"Finish OAuth sign-in"`, gated behind `__DEV__`. |
| Error string parity | "does not look valid" vs "doesn't look like a valid"; "This" vs "That" | One canonical set of strings used on both platforms. |
| Web a11y | Input lacks `aria-invalid` / `aria-describedby` | Added; error `<p>` gets an `id`. |
| Backend type hint | `exclude_user_id: object` in the uniqueness helper | Tightened to `uuid.UUID | None`. |

## 1. Trust statement (highest impact)

**Why:** Researchers' first reaction to "Connect ORCID" is "is this thing going to write to my record?" — academic CVs are sensitive and ORCID's Member API is a known write surface. Neither platform currently answers that question, so the cautious user bounces.

**Current state**

Web — `apps/web/src/app/dashboard/profile/orcid-section.tsx:105-107`:
> "Connect your ORCID record so you can import your works."

Mobile — `apps/mobile/app/(authed)/profile.tsx:187-189`:
> "Link your ORCID iD so collaborators can find your work."

Sign-in screens (`apps/web/src/app/sign-in/page.tsx:54-60`, `apps/mobile/app/sign-in.tsx:230-245`) say nothing about read-only at all.

**Proposed state**

One canonical sentence used on both profile screens and (truncated) on both sign-in screens:

> "Add your ORCID iD to import your public works. We only read — we never write to your ORCID record."

**Files to touch:**
- `apps/web/src/app/dashboard/profile/orcid-section.tsx` — replace the description `<p>` at line 105.
- `apps/mobile/app/(authed)/profile.tsx` — replace the `orcidHelp` Text at line 187.

## 2. Collapse the dual-action button

**Why:** The current model has Save handle three concepts (add, change, clear-and-save) plus a separate Remove. Users get a "Save (clear)" label that nobody understands and a Remove button that does the same thing. One primary action is enough.

**Current state**

Web — `apps/web/src/app/dashboard/profile/orcid-section.tsx:174-194`:
- "Save" / "Save (clear)" / "Saving…" primary button.
- Separate "Remove" button shown when `savedValue` is truthy.

Mobile — `apps/mobile/app/(authed)/profile.tsx:225-258`:
- "Save" primary button gated by `orcidValidForSave`.
- "Remove" destructive button shown when `persistedOrcid` is truthy.

**Proposed state**

One primary button, label driven by state:
- Input empty, nothing saved → button hidden.
- Input differs from saved (and valid) → "Save".
- Input matches saved exactly → button label becomes "Remove" (destructive variant), confirms before clearing.
- Input empty, value saved → same as above: "Remove".

This removes the "Save (clear)" string entirely and makes the destructive action visually identical to mobile's existing red-tinted Remove.

**Files to touch:**
- `apps/web/src/app/dashboard/profile/orcid-section.tsx` — collapse `handleSave` + `handleRemove` flow into one button whose label is computed from `hasChange`/`isClearing`.
- `apps/mobile/app/(authed)/profile.tsx` — same simplification on the `orcidButtonRow`.

## 3. Account-linking footgun on sign-in

**Why:** The whole point of the Phase A workaround (manual ORCID iD entry on profile) is that GitHub/Google users can use ORCID features without creating a separate account. But the sign-in screen doesn't tell them that — they see three OAuth buttons, click ORCID out of curiosity, and now they have two accounts and no idea why their shares are missing.

**Current state**

`apps/web/src/app/sign-in/page.tsx:54-60` and `apps/mobile/app/sign-in.tsx:230-245`: ORCID button rendered inline with Google/GitHub, no qualifier.

**Proposed state**

Quiet single-line caption directly under the ORCID button on both sign-in screens:

> "Already signed up with Google or GitHub? Add your ORCID iD on your profile instead — signing in with ORCID will create a separate account."

Styled with the muted text token already in use (web `text-ink-muted`, mobile `c.textMuted`). Don't add an icon, don't add a CTA — it's a guardrail, not an action.

**Files to touch:**
- `apps/web/src/app/sign-in/page.tsx` — append `<p class="text-xs text-ink-muted">` after the ORCID anchor at line 60.
- `apps/mobile/app/sign-in.tsx` — append a `<Text>` with `providerSub` style after the ORCID `Pressable` at line 245.

## 4. Cross-platform parity (icon, copy, helper link)

**Why:** The two platforms read like they were written by different people. They were — but the user shouldn't be able to tell.

**Current state**
- Web sign-in uses `<OrcidIcon size={18} />` (`apps/web/src/app/sign-in/page.tsx:58`); mobile is text-only (`apps/mobile/app/sign-in.tsx:242`).
- Web profile shows a "Find your ORCID iD" link wedged inside the input helper (`orcid-section.tsx:149-160`); mobile shows a separate "What's an ORCID iD? ↗" link below the buttons (`profile.tsx:260-264`).
- Error strings disagree: web says "That doesn't look like a valid ORCID iD" (`orcid-section.tsx:47, 66`); mobile says "That ORCID iD does not look valid." (`profile.tsx:95`) and "Use the format 0000-0000-0000-0000 (last digit may be X)." (`profile.tsx:84`).
- Conflict copy: web "That ORCID iD is already linked to another account." (`orcid-section.tsx:63`); mobile "This ORCID iD is already linked to another account." (`profile.tsx:93`).

**Proposed state**

Pick mobile's pattern for the explainer link and web's wording for errors. Canonical strings:
- Description: see Section 1.
- Validation error: "That doesn't look like a valid ORCID iD. Use the format 0000-0000-0000-0000 (last digit may be X)."
- Conflict error: "That ORCID iD is already linked to another account."
- Generic save error: "Could not save your ORCID iD."
- Helper link: "What's an ORCID iD? ↗" — a separate link under the input on both platforms.

Mobile gets an `OrcidIcon` component (new file at `apps/mobile/components/orcid-icon.tsx`, `react-native-svg` is already a dep). Reuse the same path data as the web version.

**Files to touch:**
- `apps/mobile/components/orcid-icon.tsx` — new file, `react-native-svg` `<Svg>` mirroring `apps/web/src/components/orcid-icon.tsx`.
- `apps/mobile/app/sign-in.tsx` — render `<OrcidIcon />` inside the ORCID `Pressable`, adjust `providerButton` style to a row layout.
- `apps/web/src/app/dashboard/profile/orcid-section.tsx` — replace the inline "Find your ORCID iD" with a separate `<a>` styled like mobile's `orcidExplainer`.
- Both files — align error strings to the canonical set above.

## 5. Mobile UX safety (KeyboardAvoidingView, dev-paste rename, a11y)

**Why:** On a 4.7" screen the Save button currently sits beneath the keyboard the moment the input is focused. The dev-paste UI says "Finish GitHub sign-in" no matter which provider triggered it, which is misleading and ships in non-dev builds. Pressables lack `accessibilityRole="button"` (the OAuth ones have it; profile ones don't).

**Current state**
- `apps/mobile/app/(authed)/profile.tsx:165-170` — `SafeAreaView` directly wraps the `ScrollView`, no `KeyboardAvoidingView`.
- `apps/mobile/app/sign-in.tsx:248-254` — `pasteTitle` hardcoded to "Finish GitHub sign-in"; the box is reused for Google and ORCID via `setShowGithubPaste(true)`. No `__DEV__` gate.
- `apps/mobile/app/(authed)/profile.tsx:225, 247` — Save and Remove `Pressable`s have no `accessibilityRole`.

**Proposed state**
- Wrap profile's `ScrollView` in `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`, matching `sign-in.tsx:176-178`.
- Rename the paste UI title to "Finish OAuth sign-in" and copy to "The browser is showing a JSON response. Copy the entire body and paste it here." Wrap the entire `showGithubPaste` block (and the three `setShowGithubPaste(true)` callsites) behind `__DEV__` so production builds can never render it.
- Add `accessibilityRole="button"` to the Save and Remove `Pressable`s on the profile screen.

**Files to touch:**
- `apps/mobile/app/(authed)/profile.tsx`
- `apps/mobile/app/sign-in.tsx`

## 6. Code-quality follow-ups

Lower priority, fold in if cheap:
- Backend uniqueness helper: change `exclude_user_id: object` to `uuid.UUID | None` (whichever file holds the helper added in Phase A — likely `services/users.py` or `routes/auth.py`).
- Migration vs plan-doc mismatch: the parent ticket (line 195) specifies a partial unique index `WHERE orcid_id IS NOT NULL`, but the migration shipped a plain UNIQUE. Either update the migration to a partial index or update the plan doc to match what we built. Pick one.
- Migration style: replaces raw `op.execute("ALTER TABLE …")` with `op.add_column` + `op.create_index` for revertability and consistency with the rest of `alembic/versions/`.
- Mobile DRY: `handleGithub`, `handleGoogle`, `handleOrcid` in `apps/mobile/app/sign-in.tsx:112-163` are 90% the same code. Extract `runOAuth(provider: 'github' | 'google' | 'orcid')` returning a discriminated result.
- Web a11y: `<input>` in `orcid-section.tsx` should set `aria-invalid={!!error}` and `aria-describedby` pointing at the error `<p>` (give it an `id`).

## What's NOT in this PR

- Account linking — sign in with GitHub, then connect ORCID to the same account. Stays Phase B, blocked on Better Auth migration. See `docs/tickets/orcid-integration-and-account-linking.md` Part 4.
- Better Auth migration itself.
- Works import (`POST /me/works/sync-orcid`, the works library UI) — separate ticket `works-library-and-orcid-sync.md`.
- Email verification, account merge, unlink-provider guard.
- Production ORCID OAuth credentials registration — operational task, not UX.

## Acceptance checklist

- [ ] Web profile description and mobile profile description are byte-identical and contain the read-only clause.
- [ ] Sign-in screens (web + mobile) show a muted single-line caption under the ORCID button warning about duplicate accounts.
- [ ] Mobile sign-in renders the ORCID glyph next to the "Continue with ORCID" label.
- [ ] Profile screen on each platform shows at most one primary button at a time (no "Save (clear)" string anywhere in the codebase).
- [ ] Removing a saved ORCID iD on web fires a confirmation dialog before the network call.
- [ ] Mobile Save button stays visible above the keyboard on iPhone SE-class screens.
- [ ] The dev-paste UI title reads "Finish OAuth sign-in" and the entire block is unreachable in a release build.
- [ ] Validation, conflict, and generic-save error strings match exactly between web and mobile.
- [ ] Web ORCID `<input>` has `aria-invalid` and `aria-describedby` wired to the error message when one is shown.
- [ ] Mobile profile Save/Remove `Pressable`s expose `accessibilityRole="button"`.
- [ ] Backend uniqueness helper's `exclude_user_id` is typed `uuid.UUID | None`.
- [ ] Migration and parent plan doc agree on partial-vs-plain unique index.
