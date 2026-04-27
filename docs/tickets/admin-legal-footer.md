# Ticket: Admin, Legal Pages & Site Footer

**Status:** Draft
**Owner:** James
**Created:** 2026-04-27
**Estimate:** 1–2 days

---

## Goal

Ship the legal/admin surface every production app needs before real users show up: GDPR compliance, proper privacy policy, terms of service, cookie notice, and a site-wide footer with links to all of it plus support contact.

---

## Deliverables

### 1. Privacy Policy (upgrade existing draft)

The current `/privacy` page is a placeholder. Upgrade to a proper policy covering:

- **Data controller:** James Dimonaco / Dama Health (decide entity)
- **What we collect:** account data (email, name, ORCID iD), share content, anonymous view events (bloom-filter dedup, no cookies on public paths), X-View-Token on mobile
- **Legal basis:** legitimate interest (view tracking), contract (accounts), consent (future marketing if any)
- **Third-party processors:** Neon (DB), Vercel (web hosting), Cloudflare (CDN/WAF), OpenAlex/Crossref (outbound metadata lookups — no user data sent)
- **Retention:** 90-day view pruning, 30-day tombstone GC, token cleanup every 24h
- **Data subject rights:** access (analytics surface + future `/me/export`), deletion (account delete cascade), rectification (profile edit)
- **Contact:** privacy@myetal.app (or support@myetal.app)
- **Last updated date** — auto-rendered or manual

### 2. Terms of Service

New page at `/terms`. Cover:

- Acceptable use (no illegal content, no copyright infringement, no spam)
- User-generated content — user retains ownership, grants MyEtAl a license to display
- Takedown process — reference the existing report flow
- Account termination — we can suspend/delete for violations
- Disclaimers — provided "as is", no warranty on uptime or data accuracy
- Liability limitation
- Governing law (UK? decide)
- Changes to terms — we'll notify via email or in-app banner

### 3. Cookie Notice

MyEtAl currently sets NO cookies on public read paths (per D-S-Iss10). Auth flows set `myetal_access` and `myetal_refresh` as strictly necessary httpOnly cookies.

- **No cookie banner needed** for the public site (PECR exemption for strictly necessary)
- Add a brief "Cookies" section to the privacy policy explaining this
- If we ever add analytics cookies (PostHog, etc.), we'll need a consent banner — note this as a future trigger

### 4. GDPR Compliance Checklist

- [ ] Privacy policy live and linked from sign-up form + footer
- [ ] Terms of service live and linked from sign-up form + footer
- [ ] Account deletion works (existing cascade — verify it deletes shares, views, reports, library entries, auth identities, refresh tokens)
- [ ] Data export endpoint (`GET /me/export`) — returns a ZIP of all user data. Can be a follow-up ticket but must be named in the privacy policy.
- [ ] Right to rectification — profile edit page exists (it does)
- [ ] Data processing agreement with Neon (check if their standard DPA covers us)
- [ ] `privacy@myetal.app` or `support@myetal.app` email forwarding set up

### 5. Site Footer (web)

Add a persistent footer to the root layout (or at least to public pages + dashboard). Include:

- **Left:** MyEtAl wordmark or text
- **Centre/right links:**
  - Privacy Policy → `/privacy`
  - Terms of Service → `/terms`
  - Support → `mailto:support@myetal.app`
  - GitHub → `https://github.com/JamesDimonaco/myetal` (if public)
- **Bottom line:** "© 2026 MyEtAl" or "© 2026 Dama Health"

Design: minimal, `text-ink-faint`, `border-t border-rule`, matches the academic aesthetic.

### 6. Support Email

- Set up `support@myetal.app` email forwarding (→ james@damahealth.com or personal)
- Optionally `privacy@myetal.app` as a separate alias
- Reference in privacy policy, terms, and footer

---

## Decisions needed before starting

1. **Legal entity** — "MyEtAl" or "Dama Health Ltd"? This goes on the privacy policy, terms, and copyright line.
2. **Governing law** — England & Wales? (simplest if entity is UK)
3. **GitHub repo public or private?** — affects whether we link it in the footer
4. **Data export scope** — what goes in the ZIP? Shares + items + library + profile? Views? Reports?

---

## Out of scope

- Cookie consent banner (not needed — no tracking cookies)
- DPIA (Data Protection Impact Assessment) — not required at this scale
- DPO appointment — not required for a solo dev
- Lawyer review of privacy policy / terms (separate ticket — ship the draft first)
