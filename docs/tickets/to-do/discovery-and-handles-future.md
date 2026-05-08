# User Profiles + @handles (Future)

**Status:** Future — deferred from feedback-round-2 (Q15)
**Created:** 2026-05-07
**Depends on:** feedback-round-2 PR-B (owner_id browse filter ships first)

## Why this is deferred

V1 routes owner-name links to `/browse?owner_id={user_id}` — works today, no schema change. Real `/u/{handle}` routes need a `handle` field on `users`, uniqueness enforcement, profile-edit UX (web + mobile), reserved-name list, takedown story.

## What this ticket would deliver

- `users.handle VARCHAR(30) UNIQUE` with regex `^[a-z][a-z0-9_-]{2,29}$` (no consecutive separators, lowercase only).
- Reserved-handles seed list (admin, api, www, support, ...).
- Profile-edit UI for setting/changing the handle (web + mobile).
- `/u/{handle}` route on web (server-rendered profile page).
- Mobile profile screen for own-user already exists; add a per-other-user view.
- Migration for existing users: optional, can claim a handle later. NULL handles → fall back to `?owner_id=`.

## Backwards compatibility for existing `?owner_id=<uuid>` links

Already-shared links of the form `/browse?owner_id=<uuid>` keep working. They're a **permalink** that nobody bookmarks deliberately, but social embeds + email signatures may carry them.

Behavior once handles ship:
- `/browse?owner_id=<uuid>` continues to resolve (unchanged).
- If the resolved owner has a `handle`, the page sets a `<link rel="canonical" href="/u/{handle}">` and a `301` redirect from the dashboard's owner-card link rewrites *new* links to `/u/{handle}`.
- We do **not** auto-redirect `?owner_id=<uuid>` → `/u/{handle}` server-side (preserves direct-link reliability if a user changes their handle).

## Triggers to revisit

- > 100 users — directory and discovery starts mattering.
- Branding requests ("how do I share my profile URL?").
- Comment system landing (Q11 = A or B) — handles make @-mentions possible.

## Effort

~3 days (schema, validation, UI on both platforms, reserved-list).
