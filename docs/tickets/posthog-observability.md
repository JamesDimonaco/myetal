# Ticket: PostHog Integration — Product Analytics, Error Tracking, Session Replay

**Status:** Draft
**Owner:** James
**Created:** 2026-04-27
**Estimate:** 1–2 days
**PostHog project:** "weightless-md" (id: 264091) in org "Dama Health"

---

## Goal

Wire PostHog into all three surfaces (web, mobile, API server) for:
1. **Product analytics** — who's using what, funnel tracking, feature adoption
2. **Error tracking** — client + server errors with stack traces and context
3. **Session replay** — see what users see (web only for v1)

MyEtAl already has a PostHog project ("weightless-md") in the Dama Health org. This ticket connects the app to it.

---

## Web (Next.js)

### Setup

- Install `posthog-js` and `posthog-node` (for server-side)
- Add `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` env vars
- PostHog host: `https://eu.i.posthog.com` (EU cloud — matches GDPR stance)

### Client-side (`posthog-js`)

Create a PostHog provider in `apps/web/src/app/providers.tsx` (extend the existing Providers component):

```tsx
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

// Init outside component so it runs once
if (typeof window !== 'undefined') {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    capture_pageview: false,  // we handle manually for SPA nav
    capture_pageleave: true,
    person_profiles: 'identified_only',
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-ph-mask]',
    },
  });
}
```

### Events to track

**Automatic:**
- Page views (via `usePathname` + `useSearchParams` in a `PostHogPageview` component)
- Session replay (enabled by default, mask inputs)

**Custom events (instrument in the components):**

| Event | Where | Properties |
|---|---|---|
| `share_created` | share-editor.tsx (on save success, create mode) | `type`, `item_count`, `has_description` |
| `share_updated` | share-editor.tsx (on save success, edit mode) | `type`, `item_count` |
| `share_deleted` | share-editor.tsx (on delete) | `share_id` |
| `share_published` | share-editor.tsx (publish toggle) | `share_id` |
| `qr_viewed` | qr-modal.tsx (on open) | `short_code` |
| `paper_searched` | usePapers.ts (on successful search) | `query_length`, `result_count` |
| `paper_added_doi` | add-item-modal.tsx (DOI pane pick) | `doi` |
| `paper_added_search` | add-item-modal.tsx (search pane pick) | `has_doi` |
| `paper_added_manual` | add-item-modal.tsx (manual pane pick) | — |
| `library_paper_added` | library-list.tsx (on add success) | `doi` |
| `feedback_submitted` | feedback page (on submit) | `type`, `has_email` |
| `public_share_viewed` | c/[code]/page.tsx (server-side) | `short_code`, `item_count`, `has_owner` |
| `sign_in` | sign-in flow (after cookie set) | `method` (password/github/google/orcid) |
| `sign_up` | sign-up flow | `method` |

### Identify users

On sign-in, call `posthog.identify(user.id, { email, name })`. On sign-out, call `posthog.reset()`.

Best place: the auth finish page (`/auth/finish`) or a `useEffect` in the dashboard layout that reads the user from the server component prop.

### Error tracking

```tsx
// In the root error boundary or a global error handler
posthog.captureException(error, { extra: { route, component } });
```

Also add `apps/web/src/app/error.tsx` (Next.js error boundary) if it doesn't exist — capture to PostHog there.

### Session replay config

- **Mask all inputs** by default (passwords, emails)
- **Mask** any element with `data-ph-mask` attribute
- **Don't record** on `/sign-in`, `/sign-up` pages (sensitive)
- **Sample rate:** 100% for now (low traffic), reduce to 10-50% at scale

---

## Mobile (React Native / Expo)

### Setup

- Install `posthog-react-native`
- Add `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` env vars
- Wrap the app in `<PostHogProvider>` in `apps/mobile/app/_layout.tsx`

```tsx
import { PostHogProvider } from 'posthog-react-native';

<PostHogProvider
  apiKey={process.env.EXPO_PUBLIC_POSTHOG_KEY!}
  options={{
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
    enableSessionReplay: false,  // not supported on RN yet
  }}
>
  {children}
</PostHogProvider>
```

### Events to track

Same events as web where applicable (share_created, paper_searched, etc.). Mobile-specific:

| Event | Where | Properties |
|---|---|---|
| `qr_scanned` | scan.tsx (on successful scan) | `short_code` |
| `share_link_shared` | c/[code].tsx (native share sheet) | `short_code` |
| `app_opened` | _layout.tsx | `from` (cold/warm) |

### Identify users

In the auth hook (`useAuth.ts`), when `isAuthed` flips to true, call `posthog.identify(user.id, { email, name })`. On sign-out, call `posthog.reset()`.

### Error tracking

Wrap the root layout in an error boundary, capture with `posthog.captureException()`.

---

## API Server (Python / FastAPI)

### Setup

- Install `posthog` Python SDK
- Add `POSTHOG_API_KEY` and `POSTHOG_HOST` to `config.py` (optional strings, default empty)
- Init in `main.py` startup event:

```python
import posthog

posthog.api_key = settings.posthog_api_key
posthog.host = settings.posthog_host or 'https://eu.i.posthog.com'
posthog.disabled = not settings.posthog_api_key  # skip if not configured
```

### Server-side events

| Event | Where | Properties |
|---|---|---|
| `api_share_created` | routes/shares.py POST | `share_id`, `type`, `item_count` |
| `api_report_submitted` | routes/reports.py POST | `share_short_code`, `reason` |
| `api_report_actioned` | routes/admin.py POST | `report_id`, `decision`, `tombstoned` |
| `api_feedback_submitted` | routes/feedback.py POST | `type`, `has_email`, `is_authed` |
| `api_paper_lookup` | routes/papers.py POST lookup | `source` (crossref) |
| `api_paper_search` | routes/papers.py GET search | `query_length`, `result_count` |
| `api_auth_login` | routes/auth.py POST login | `method` |
| `api_auth_register` | routes/auth.py POST register | — |
| `api_oauth_complete` | routes/oauth.py callback | `provider` |

### Error tracking

Add a FastAPI exception handler that captures unhandled exceptions:

```python
@app.exception_handler(Exception)
async def posthog_exception_handler(request, exc):
    posthog.capture('server', 'api_error', {
        'error': str(exc),
        'path': request.url.path,
        'method': request.method,
    })
    raise exc  # re-raise for normal error handling
```

### Shutdown

Flush on shutdown:

```python
@app.on_event("shutdown")
async def shutdown():
    posthog.shutdown()
```

---

## Feature flags (future)

PostHog feature flags can gate:
- Trending UI (when we build it)
- Search (when we build it)
- ORCID sign-in (gate on `orcid_enabled` flag until sandbox is verified)
- Any experimental feature

Not in scope for this ticket but the SDK setup enables it for free.

---

## Privacy / GDPR considerations

- **EU cloud** (`eu.i.posthog.com`) — data stays in EU
- **`person_profiles: 'identified_only'`** — anonymous users don't create person records
- **Session replay masks inputs** — no passwords or sensitive data recorded
- **No tracking on public pages for anonymous users** beyond pageviews (we already have our own view tracking via share_views)
- **Update privacy policy** to mention PostHog as a data processor
- **PostHog's DPA** covers GDPR processor obligations

---

## Env vars summary

| Var | Where | Value |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | Web (.env) | from PostHog project settings |
| `NEXT_PUBLIC_POSTHOG_HOST` | Web (.env) | `https://eu.i.posthog.com` |
| `EXPO_PUBLIC_POSTHOG_KEY` | Mobile (.env) | same key |
| `EXPO_PUBLIC_POSTHOG_HOST` | Mobile (.env) | `https://eu.i.posthog.com` |
| `POSTHOG_API_KEY` | API (.env) | same key (or a separate server-side key) |
| `POSTHOG_HOST` | API (.env) | `https://eu.i.posthog.com` |

---

## Implementation order

1. Web client SDK + pageviews + identify (fastest value)
2. Web custom events (share_created, paper_searched, etc.)
3. Web session replay + error boundary
4. API server SDK + server events + error handler
5. Mobile SDK + events + identify
6. Update privacy policy to mention PostHog

---

## Out of scope

- Feature flags (setup enables them, but not configuring any)
- Dashboards / saved insights (set up in PostHog UI, not in code)
- A/B testing
- Reverse proxy for ad-blocker bypass (`/ingest` → PostHog) — follow-up if needed
- Custom PostHog dashboards (do in the PostHog UI)
