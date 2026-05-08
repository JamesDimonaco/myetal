# ORCID Integration + Multi-Provider Account Linking — Comprehensive Plan

**Status:** Draft — waiting on ORCID sandbox approval (ticket #683798)
**Owner:** James
**Created:** 2026-04-30
**Depends on:** ORCID sandbox credentials, works-library ticket for Phase A step 3
**Related:** `better-auth-migration.md`, `works-library-and-orcid-sync.md`

---

## Context

We're waiting on ORCID sandbox approval (expected ~May 1st). This plan covers everything needed once access is granted: ORCID OAuth sign-in, pulling the user's publications, storing/syncing that data, and the critical **account linking** problem (user signs up with GitHub, later wants to connect ORCID).

The key question is whether to implement account linking on the current hand-rolled auth system or defer until the Better Auth migration. **Recommendation: implement ORCID sign-in now on the current system, but defer account linking to Better Auth** — linking is precisely the kind of security-critical feature that Better Auth handles well (verification, edge cases, abuse prevention).

---

## Part 1: What ORCID gives us

### API tiers

| API | Cost | What you get | Scopes |
|---|---|---|---|
| **Public API** | Free (register via Developer Tools on your ORCID profile) | Read public data, authenticate users (OIDC) | `openid`, `/read-public` |
| **Member API** | Paid ORCID membership | Read limited-visibility data, **write** to records | `/read-limited`, `/activities/update` |

**We use the Public API.** It's free, sufficient for our needs, and already configured in the codebase. We get:
- ORCID OAuth/OIDC sign-in (already coded, just needs credentials)
- Read public works via `GET /v3.0/{orcid}/works` with a `/read-public` token
- The user's ORCID iD, name, email (if public) from the OIDC userinfo endpoint

### What we can pull from a user's ORCID record

**From OIDC userinfo** (on login, scope `openid`):
- `sub` — the ORCID iD (e.g., `0000-0002-1825-0097`)
- `name`, `given_name`, `family_name`
- `email` (only if user made it public — many don't)

**From `/v3.0/{orcid}/works`** (with `/read-public` client-credentials token):
- Work summaries: title, type, publication date, journal, put-code
- External identifiers: DOI, PMID, ISBN, etc.
- **Only publicly visible works** — if a user sets a work to "trusted parties only" or "only me", we can't see it without the Member API

### Two tokens, two purposes

1. **User's OAuth token** (from 3-legged OAuth with `openid` scope) — used to authenticate the user and get their ORCID iD. Short-lived, we don't store it.

2. **Client-credentials token** (2-legged, scope `/read-public`) — used to read any user's public works. Long-lived (~20 years). We fetch this once on app startup and cache it. **No user interaction needed.**

This is important: we don't need the user's permission to read their *public* works. We only need their ORCID iD (which we get from sign-in). The works fetch uses our own client-credentials token.

---

## Part 2: ORCID sign-in (already 95% built)

### What exists

The entire OAuth flow is already implemented and just needs credentials:

| Component | File | Status |
|---|---|---|
| Provider config | `oauth_providers.py` | Done — ORCID endpoints (sandbox + prod), `_parse_orcid()`, scope `openid` |
| OAuth state JWT | `core/oauth.py` | Done — encodes/decodes provider, return_to, platform |
| OAuth service | `services/oauth.py` | Done — `start_oauth()`, `complete_oauth()`, `_find_or_create_user()` |
| OAuth routes | `routes/oauth.py` | Done — `/auth/orcid/start`, `/auth/orcid/callback` |
| Config (env vars) | `core/config.py` | Done — `orcid_client_id`, `orcid_client_secret`, `orcid_use_sandbox` |
| Auth identity model | `models/auth_identity.py` | Done — `AuthProvider.ORCID` enum value exists |
| Web sign-in button | Web sign-in page | Done — button exists but disabled with "Coming soon" |
| Mobile sign-in button | Mobile sign-in screen | Done — button exists but disabled with "Coming soon" |

### What's needed to activate ORCID sign-in

1. Get ORCID sandbox credentials (pending approval)
2. Set `ORCID_CLIENT_ID` and `ORCID_CLIENT_SECRET` in the API's `.env`
3. Set `ORCID_USE_SANDBOX=true` for dev, `false` for prod
4. Enable the ORCID button on web + mobile (remove "Coming soon" / disabled state)
5. Register production ORCID OAuth credentials once sandbox testing passes

**Effort: ~0.5 day** once credentials arrive.

### ORCID-specific considerations

- **Email may be null.** Many academics don't make their email public on ORCID. Our `User.email` is already nullable — this is fine.
- **Name may be null.** The `_parse_orcid` function already handles this with `_stitch_name()` fallback.
- **No avatar.** ORCID doesn't provide profile photos. `avatar_url` stays null.
- **ORCID iD as subject_id.** The `sub` claim from OIDC is the ORCID iD itself (e.g., `0000-0002-1825-0097`).

---

## Part 3: Pulling works from ORCID

### The flow

```
User signs in with ORCID (or enters ORCID iD manually)
  → User visits their profile / works library
  → User taps "Import from ORCID"
  → Backend fetches GET /v3.0/{orcid_id}/works using client-credentials token
  → Parse work summaries → extract DOIs → hydrate via Crossref/OpenAlex
  → Upsert into papers table → link via user_papers
  → Return { added, updated, unchanged } counts
```

### Scope decision: `/read-public` with client-credentials

We do NOT request `/read-limited` scope during user OAuth. That would require the Member API (paid). Instead, we use a **client-credentials token** (2-legged OAuth, no user involved) with `/read-public` scope. This is free and doesn't require user permission beyond signing in.

### User control

1. **Opt-in pull:** User explicitly taps "Import from ORCID" — we never auto-pull
2. **Re-sync:** User can tap "Refresh from ORCID" to pull new works
3. **Selective use:** Imported works land in their library. They choose which to add to shares.
4. **Hide/remove:** User can hide any imported paper (`user_papers.hidden_at`)
5. **We never write to ORCID** — read-only, always

### ORCID iD storage on the user profile

Derive from `auth_identities` where `provider='orcid'` — no schema change needed for ORCID sign-in users. For GitHub/Google users who want to enter their ORCID iD manually, add a `users.orcid_id` column (see Part 4).

---

## Part 4: Account linking (the hard problem)

### The scenario

1. User signs up with GitHub → creates User A
2. User later wants to connect ORCID → should link to User A, not create User B
3. User might also want to connect Google → should also link to User A

Currently, `_find_or_create_user()` **deliberately does NOT auto-link by email** (security: a malicious provider could claim someone else's account). Each provider creates a separate user.

### Why this is hard to do safely on the current system

Account linking requires:
1. Proof of ownership of both accounts (user must be signed in, then OAuth into the new provider)
2. Email verification (if linking by email)
3. Conflict resolution (ORCID identity already belongs to a different user?)
4. Data merging (two accounts' shares, library, etc.)
5. Unlinking (with "you need at least one provider" guard)

Our current system has none of this. Building it correctly is exactly what Better Auth does out of the box.

### Recommendation: two-phase approach

**Phase A (now, with current auth system):**
- ORCID sign-in works (just needs credentials)
- ORCID works import works
- **No account linking** — ORCID sign-in creates a separate account
- **Workaround for GitHub/Google users:** let them enter their ORCID iD manually on their profile page. Since we use the Public API with client-credentials, we don't need the user to sign in with ORCID to read their public works. A GitHub user who pastes their ORCID iD gets the same import experience.

**Phase B (with Better Auth):**
- Full account linking: sign in with GitHub, then connect Google + ORCID to the same account
- Email verification (required for linking)
- Account merge UI for users who accidentally created duplicate accounts
- Unlink provider (with "you need at least one" guard)

### The manual ORCID iD entry workaround (Phase A)

```
Profile page:
  "Your ORCID iD" — input field
  User pastes: 0000-0002-1825-0097
  → Validate format (regex: ^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$)
  → Store as user.orcid_id (new nullable column)
  → Now "Import from ORCID" works using client-credentials + this ORCID iD
```

**Key insight: you don't need ORCID OAuth to read someone's public works.** You just need their ORCID iD and a client-credentials token.

---

## Part 5: Better Auth and the timeline

**Don't wait for Better Auth to ship ORCID sign-in and works import.** These work fine on the current auth system and are valuable immediately.

**Do wait for Better Auth to implement account linking.** The complexity and security risk of hand-rolling it isn't worth it.

### Sequencing

1. **Now (when credentials arrive):** Activate ORCID sign-in — 0.5 day
2. **Next sprint:** Add `orcid_id` column + manual entry on profile — 0.5 day
3. **Next sprint:** ORCID works import (background sync, works library UI) — 1 week
4. **Later:** Better Auth migration — 3-4 weeks
5. **After Better Auth:** Account linking, email verification, merge flows

---

## Part 6: Implementation details

### New DB column for manual ORCID iD entry

```sql
ALTER TABLE users ADD COLUMN orcid_id VARCHAR(19) NULL;
CREATE UNIQUE INDEX uq_users_orcid_id ON users (orcid_id) WHERE orcid_id IS NOT NULL;
```

Auto-set on ORCID sign-in. Manually set via profile page for GitHub/Google users.

### New API endpoint: set ORCID iD manually

```
PATCH /auth/me
  body: { orcid_id: "0000-0002-1825-0097" }
  → validates format
  → checks uniqueness
  → updates user.orcid_id
```

### Client-credentials token cache

```python
# services/orcid_client.py
async def get_read_public_token() -> str:
    """Fetch or return cached /read-public client-credentials token."""
    # POST https://orcid.org/oauth/token
    #   client_id=...&client_secret=...&grant_type=client_credentials&scope=/read-public
    # These tokens last ~20 years, cache aggressively
```

### Works fetch

```
POST /me/works/sync-orcid
  → requires user.orcid_id to be set
  → 202 Accepted, kicks off background task
  → GET /me/works/sync-runs/{id} for polling status
```

Details in `docs/tickets/works-library-and-orcid-sync.md`.

---

## Summary of decisions

| Decision | Choice | Rationale |
|---|---|---|
| API tier | Public API (free) | Sufficient for read + auth. Member API costs money. |
| Works scope | `/read-public` via client-credentials | No user permission needed for public data. |
| Account linking | Defer to Better Auth | Too complex and security-sensitive to hand-roll. |
| ORCID iD for non-ORCID users | Manual entry on profile | Unblocks works import without account linking. |
| Auto-import on sign-in | No — opt-in only | Academics are wary of automatic actions. |
| Write to ORCID | Never | We're a consumer, not a contributor. |
| Better Auth timing | Don't block on it | ORCID sign-in + works import work on current auth. |

---

## Sources

- [ORCID OAuth Scopes](https://info.orcid.org/ufaqs/what-is-an-oauth-scope-and-which-scopes-does-orcid-support/)
- [Public vs Member API](https://info.orcid.org/ufaqs/what-are-the-differences-between-the-public-and-member-apis/)
- [Registering a Public API client](https://info.orcid.org/documentation/integration-guide/registering-a-public-api-client/)
- [ORCID API v3.0 Guide](https://github.com/ORCID/orcid-model/blob/master/src/main/resources/record_3.0/README.md)
- [Read Data on a Record](https://info.orcid.org/documentation/api-tutorials/api-tutorial-read-data-on-a-record/)
- [ORCID OpenID Connect](https://orcid.org/blog/2019/04/17/orcid-openid-connect-and-implicit-authentication)
- [How to get /read-public token](https://info.orcid.org/ufaqs/how-do-i-get-read-public-access-token/)
