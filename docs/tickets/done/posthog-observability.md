# Ticket: PostHog Integration — Error Tracking, Analytics, Session Replay

**Status:** Ready to build
**Owner:** James
**Created:** 2026-04-27
**Estimate:** 1 day
**PostHog project:** "weightless-md" (id: 264091) in org "Dama Health"

---

## Goal

Wire PostHog into web and mobile for error tracking (replaces need for Sentry), product analytics, and session replay. **Critical constraint: no tracking until the user accepts cookies.** Session replay must not slow down first load.

---

## Decisions (resolved)

- **Host:** `https://us.i.posthog.com` (US cloud)
- **Env var names:** `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (web); `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST` (mobile)
- **All tokens in `.env` files only** — repo is public, never hardcode
- **Cookie consent required** — PostHog must NOT init until user accepts
- **Session replay** — lazy-loaded, never blocks first paint
- **Server-side:** deferred to follow-up (web + mobile are the priority)

---

## Cookie Consent — the critical path

PostHog must not send ANY data until the user consents. This means:

### Web: consent banner + deferred init

1. **Cookie consent state** stored in `localStorage` key `myetal_consent`:
   - `null` / missing → not yet decided → show banner, PostHog NOT loaded
   - `"accepted"` → PostHog initialised
   - `"declined"` → PostHog never loads

2. **Consent banner** — a non-blocking bottom bar on every page:
   - "We use cookies for analytics and error tracking."
   - Two buttons: "Accept" / "Decline"
   - Dismissing = decline (conservative)
   - Once accepted, call `posthog.init()` and set `localStorage`
   - On subsequent page loads, check `localStorage` before init
   - Banner does NOT show if already decided

3. **PostHog init is DEFERRED** — do NOT init at module level. Instead:
   ```tsx
   // In the consent provider, ONLY after user accepts:
   function initPostHog() {
     if (typeof window === 'undefined') return;
     posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
       api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
       capture_pageview: false,
       capture_pageleave: true,
       person_profiles: 'identified_only',
       loaded: (ph) => {
         // Lazy-load session replay AFTER init, never block first paint
         ph.startSessionRecording();
       },
       disable_session_recording: true,  // don't auto-start, we start manually after load
       session_recording: {
         maskAllInputs: true,
         maskTextSelector: '[data-ph-mask]',
       },
     });
   }
   ```

4. **Consent provider component** (`apps/web/src/components/consent-provider.tsx`):
   - Wraps the app (inside Providers)
   - Reads `localStorage` on mount
   - If accepted: init PostHog immediately
   - If not decided: show banner
   - Exposes `hasConsent` via context so other components can gate on it

### Mobile: consent on first launch

1. Store consent in `AsyncStorage` key `myetal_consent`
2. On first launch (no key set): show a consent modal/bottom sheet before the main app
3. If accepted: init PostHog provider
4. If declined: render app without PostHog provider (wrap conditionally)
5. On subsequent launches: check storage, skip modal if already decided
6. Add a "Reset analytics consent" option in Profile settings

---

## Web (Next.js)

### Setup

- Install `posthog-js` (client only — no `posthog-node` for now)
- Env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- **Never hardcode the key** — read from env vars only

### Architecture

```
providers.tsx
  └── ConsentProvider
        ├── (no consent) → CookieBanner
        └── (has consent) → PostHogProvider
              ├── PostHogPageview (captures route changes)
              └── children
```

### Error tracking (the #1 priority)

- Create `apps/web/src/app/error.tsx` — Next.js error boundary
- On error: `posthog.captureException(error)` (only if consent given)
- Also add `window.addEventListener('unhandledrejection', ...)` in the consent provider

### Session replay

- `disable_session_recording: true` on init
- Call `posthog.startSessionRecording()` in the `loaded` callback
- This means replay loads lazily after the page is interactive — never blocks first paint
- Mask all inputs, mask `[data-ph-mask]` elements
- Don't record on `/sign-in`, `/sign-up` (add `data-ph-no-capture` to those pages)

### Pageviews

- Manual capture via a `PostHogPageview` client component using `usePathname` + `useSearchParams`
- Only fires if PostHog is initialised (consent given)

### Identify

- On sign-in success: `posthog.identify(user.id, { email, name })`
- On sign-out: `posthog.reset()`
- Best place: the auth finish page or a useEffect in the dashboard layout

### Custom events (phase 2 — after core setup works)

| Event | Where | Properties |
|---|---|---|
| `share_created` | share-editor.tsx | `type`, `item_count` |
| `share_deleted` | share-editor.tsx | `share_id` |
| `share_published` | share-editor.tsx | `share_id` |
| `qr_viewed` | qr-modal.tsx | `short_code` |
| `paper_searched` | usePapers.ts | `query_length`, `result_count` |
| `feedback_submitted` | feedback form | `type`, `has_email` |
| `sign_in` | auth finish | `method` |
| `sign_up` | register | `method` |

These are nice-to-have — the agent should focus on consent + error tracking + pageviews first.

---

## Mobile (React Native / Expo)

### Setup

- Install: `npx expo install posthog-react-native expo-file-system expo-application expo-device expo-localization`
- Env vars: `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`

### Consent flow

- On first launch: consent modal before anything else
- Store in `AsyncStorage`
- Conditionally wrap app in `<PostHogProvider>` only if accepted:

```tsx
import { PostHogProvider } from 'posthog-react-native';

// Only render PostHogProvider if user has consented
{hasConsent ? (
  <PostHogProvider
    apiKey={process.env.EXPO_PUBLIC_POSTHOG_KEY!}
    options={{
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
    }}
  >
    <RestOfApp />
  </PostHogProvider>
) : (
  <RestOfApp />
)}
```

### Error tracking

- Wrap root layout in error boundary, capture with `posthog?.captureException()`
- Guard all PostHog calls with null check (provider may not be mounted if declined)

### Identify

- In auth hook: `posthog?.identify(user.id, { email, name })` when authed
- On sign-out: `posthog?.reset()`

---

## Env vars (for .env files — never commit values)

| Var | Where | Description |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | `apps/web/.env.local` | PostHog project API key |
| `NEXT_PUBLIC_POSTHOG_HOST` | `apps/web/.env.local` | `https://us.i.posthog.com` |
| `EXPO_PUBLIC_POSTHOG_KEY` | `apps/mobile/.env` | Same key |
| `EXPO_PUBLIC_POSTHOG_HOST` | `apps/mobile/.env` | `https://us.i.posthog.com` |

---

## Privacy / consent

- **No tracking without consent** — PostHog does not init, no cookies set, no network requests
- **Consent is per-device** — stored in localStorage (web) / AsyncStorage (mobile)
- **Update privacy policy** to mention PostHog as a data processor (add to the "Third parties" section)
- **Session replay masks inputs** — passwords, emails never recorded
- PostHog's standard DPA covers processor obligations

---

## Implementation order

1. **Web consent banner + deferred PostHog init** (the gating mechanism)
2. **Web error boundary** (captures exceptions → PostHog)
3. **Web pageview tracking** (route change capture)
4. **Web session replay** (lazy-loaded after consent)
5. **Mobile consent modal + conditional provider**
6. **Mobile error boundary**
7. **Update privacy policy** (add PostHog to third parties)
8. Custom events (follow-up — not blocking)

---

## Out of scope

- Server-side PostHog (Python SDK) — follow-up ticket
- Feature flags
- A/B testing
- Custom PostHog dashboards (configure in PostHog UI)
- Reverse proxy for ad-blocker bypass
- Custom events beyond the basics (follow-up)
