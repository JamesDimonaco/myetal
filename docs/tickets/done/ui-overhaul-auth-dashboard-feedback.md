# Ticket: UI Overhaul — Auth Flow, Dashboard Cards, Avatar, Feedback Button

**Status:** Draft
**Owner:** James
**Created:** 2026-04-27
**Estimate:** 1–1.5 days

---

## Problems

1. **Sign-in vs sign-up is confusing.** Two separate pages with different forms. Users land on sign-in, see an email/password form, and don't realise Google/GitHub/ORCID exist. The OAuth buttons are buried below the form. Meanwhile sign-up is a whole other page with just email/password — no OAuth at all.

2. **OAuth should be the primary flow.** For an academic app, ORCID/Google/GitHub are the right defaults. Email/password is a fallback for edge cases, not the main event.

3. **Dashboard nav shows username as text.** "James Dimonaco" as a nav link to profile feels like a label, not a button. No visual affordance that it's clickable.

4. **Dashboard share cards are button-heavy.** QR, Edit, Delete — each with text labels. Takes up space and looks cluttered with 4+ shares.

5. **"Give feedback" isn't prominent enough.** The feedback system exists (`/feedback`) but users have to find it. It should be one click from the dashboard.

---

## Deliverables

### 1. Unified auth page — OAuth-first, email/password secondary

**Replace** both `/sign-in` and `/sign-up` with a single unified auth page. Keep the routes (redirect `/sign-up` → `/sign-in` or vice versa) but they land on the same page.

**Layout (top to bottom):**

```
← MyEtAl

Welcome to MyEtAl
Share your research with a QR code.

[  Continue with Google  ]     ← primary, full-width
[  Continue with GitHub  ]     ← primary, full-width
[  Continue with ORCID   ]     ← disabled "coming soon" until credentials land

─── or use email ───           ← divider, de-emphasised

[collapsed/toggle section]     ← "Sign in with email" link
  When expanded:
  - Tab: "Sign in" | "Create account"
  - Sign in tab: email + password + submit
  - Create account tab: name + email + password + submit

Already have an account? / New here?  ← contextual link to toggle tabs
```

**Key design decisions:**
- OAuth buttons are ABOVE the fold, big, full-width, immediately visible
- Email/password section starts collapsed — just a small "Sign in with email" text link
- When clicked, it expands to show a tabbed form (sign in / create account)
- The form is clearly secondary — smaller, muted styling compared to the OAuth buttons
- Google icon uses the existing `GoogleIcon` component, GitHub uses `GitHubIcon`
- ORCID button stays disabled with "coming soon" badge

**Mobile app:** Same flow — OAuth buttons prominent at the top, email/password collapsed below.

### 2. Profile avatar in dashboard nav

Replace the text username link with a proper avatar circle.

**Use shadcn's Avatar pattern** (or build a simple one — we don't have shadcn installed, so build it):

```tsx
<Avatar>
  <AvatarImage src={user.avatar_url} alt={user.name} />
  <AvatarFallback>{initials}</AvatarFallback>
</Avatar>
```

**Implementation:**
- The API's `/auth/me` response needs to include `avatar_url` (from GitHub/Google OAuth profile). Check if we already store this — if not, add it to the User model + OAuth flow.
- **Fallback:** If no image, show a circle with first-letter-of-first-name + first-letter-of-last-name (e.g. "JD" for James Dimonaco). If only one name, use first letter.
- **Styling:** 32px circle, `border border-rule`, positioned in the nav where the text username was. On hover, subtle ring or opacity change.
- Clicking it still navigates to `/dashboard/profile`.

**Nav layout after:**
```
MyEtAl     Shares  Library  [avatar]
```

The avatar replaces the text entirely. Users understand a circle with their face = profile.

### 3. Dashboard share cards — cleaner actions

Current card has: short code, name, item count, "QR" button, "Edit" button.

**Redesign the card actions:**

- **QR button** → keep, but icon-only (QR code icon, no text). Tooltip on hover: "Show QR"
- **Edit button** → pencil icon only, no text. Tooltip: "Edit share". Alternatively, make the entire card clickable to edit (more natural).
- **Delete** → small red trash icon in the top-right corner of the card (or on hover only). NOT a prominent button — it's destructive and rarely used.
- **Make the card itself clickable** → clicking anywhere on the card opens the editor. The QR button is an explicit override (doesn't navigate, opens the modal).

**Card layout:**
```
┌─────────────────────────────────────┐
│ rgfYRP                    🗑️ (hover) │
│ My ASMS 2026 poster                  │
│ 3 items · paper                      │
│                                      │
│ [QR icon]  [✏️ pencil]              │
└─────────────────────────────────────┘
```

**Final card layout** — whole card clickable (navigates to editor), icon buttons overlaid:

```
┌─────────────────────────────────────┐
│ rgfYRP                              │
│ My ASMS 2026 poster                  │
│ 3 items · paper · Published          │
│                                      │
│ [QR]  [📋 copy]  [↗ view]    [🗑️]  │
└─────────────────────────────────────┘
```

- **QR** — icon only, opens QR modal (`stopPropagation`)
- **Copy link** — clipboard icon, copies `myetal.app/c/{code}` (`stopPropagation`)
- **View** — external link icon, opens `/c/{code}` in new tab (`stopPropagation`)
- **Delete** — red trash icon, far right, muted until hover
- **Clicking anywhere else** on the card → navigates to the editor
- All action buttons are icon-only with tooltips on hover, no text labels

### 4. "Give feedback" in the dashboard

Add a persistent "Give feedback" link/button accessible from the dashboard. Options:

**Option A — footer link:** Add "Give feedback" to the site footer (already has Privacy, Terms, Support, GitHub). Simple, always there.

**Option B — nav/header link:** Small "Feedback" link in the dashboard header nav, next to Shares/Library.

**Option C — floating button:** A small "?" or "Feedback" pill fixed to the bottom-right corner. More visible but potentially annoying.

**Recommendation: Option A + B.** Footer link for discoverability, plus a small link in the dashboard nav. The feedback page already exists at `/feedback` with the feature-request/bug-report picker — just needs to be linked more visibly.

The existing report-a-share button on public share pages stays as-is — that's for content moderation, which is different from product feedback.

### 5. Feedback form — ensure the email UX is right

The feedback form at `/feedback` already has:
- Type picker (feature request / bug report)
- Title, description, email

**Verify the email UX matches what James described:**
- If signed in: pre-fill email, show "We'll reply to {email}" with a toggle to opt out
- If not signed in: email input with "Want a reply? Enter your email (optional)"
- Toggle should be dead simple — not a full form field, just a switch or checkbox
- Make it obvious whether they'll get a reply or not

---

## What NOT to change

- The report-a-share button on public share pages — that's content moderation, keep it
- The library page — revisit later
- The feedback backend (API + Telegram) — already built, just needs UI links
- Mobile auth flow — follow-up (do web first, mobile mirrors)

---

## Technical notes

### Avatar URL
Check if `User` model has an `avatar_url` field. If not:
- Add `avatar_url: str | None` to the User model
- Populate from OAuth: GitHub gives `avatar_url` in the profile response, Google gives `picture`
- Add to `/auth/me` response (UserResponse schema)
- Migration to add the column

### Auth page
- `/sign-in/page.tsx` becomes the unified page
- `/sign-up/page.tsx` redirects to `/sign-in` (or renders the same component)
- The `SignInForm` and `SignUpForm` client components get merged into one `AuthForm` component with tabs
- The email/password section should be collapsible (starts closed)

### Card redesign
- `apps/web/src/app/dashboard/share-list.tsx` is the client component that renders cards
- Make cards clickable with `router.push(`/dashboard/share/${id}`)`
- QR button gets `onClick.stopPropagation()` so it opens the modal instead of navigating

---

## Review findings (resolved)

1. **Avatar URL does NOT exist yet.** The full pipeline needs building: add to `ProviderUserInfo` dataclass, parse from GitHub (`payload["avatar_url"]`) and Google (`payload["picture"]`), add column to `User` model + migration, persist in `_find_or_create_user`, add to `UserResponse` schema. Touches 5 files + migration. Small complexity.

2. **Dashboard cards have 5 buttons, not 3.** Current buttons: QR, Copy link, Edit, View (external), Delete. The card redesign must account for Copy link and View too — make them icon-only or fold into an overflow "..." menu. Updated in section 3 above.

3. **Mobile auth is already OAuth-first.** `apps/mobile/app/sign-in.tsx` already has GitHub at top, email/password below a divider, sign-in/sign-up toggle built in. No mobile auth work needed.

4. **Feedback form email UX already works.** Pre-fills for signed-in, optional for anon, dynamic feedback text. No changes needed — just add links to footer + dashboard nav.

5. **Estimate holds at 1–1.5 days** with mobile scoped out.

## Future consideration: auth infrastructure

The current auth system (hand-rolled JWT + OAuth) works but is a candidate for migration to a managed auth provider (e.g. Better Auth, Clerk, Auth.js, Supabase Auth) in a future ticket. This would give us: password reset, email verification, MFA, magic links, session management UI, and reduce the custom auth surface area. Not blocking this ticket — the current system is functional and secure — but worth planning as a separate initiative.
