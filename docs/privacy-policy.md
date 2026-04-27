# MyEtal — Privacy Policy

**Status:** draft for pre-launch. Lawyer review pending — do not treat as legal advice.
**Last updated:** 2026-04-27
**Controller:** James Dimonaco (sole operator), trading as MyEtal.
**Contact for data subject requests:** privacy@myetal.app

This policy explains what data MyEtal collects, why, how long we keep it,
and what rights you have over it. It applies to the API at
**api.myetal.app**, the web app at **myetal.app**, and the mobile app
**MyEtal** (iOS + Android).

If anything here is unclear or you want to exercise one of the rights below,
email **privacy@myetal.app**.

---

## 1. Who we are

MyEtal is operated by James Dimonaco as a sole-trader project (UK). The
service is targeted at academics who want to share their published work
via QR-code-driven collections. There is no employer, parent company, or
processor relationship that needs disclosing beyond the third parties
listed in section 5.

---

## 2. What data we collect

### 2.1 Account data (when you sign up)

- **Email address** — required for password-based accounts; derived from
  the OAuth provider (Google / GitHub / ORCID) for OAuth accounts.
- **Display name** — optional / derived from the OAuth provider.
- **Authentication provider** — which of password / Google / GitHub /
  ORCID you used to sign in.
- **Password hash** — Argon2id, salted. We never see your plaintext
  password and cannot recover it.

We do **not** ask for, store, or process: real name (beyond what's in
your display name), date of birth, address, payment details (we don't
charge), nationality, gender, ethnicity, political opinions, religious
beliefs, health data, sexual orientation, biometric data, or any other
"special category" data under GDPR Article 9.

### 2.2 Content you create

- **Shares** you create (collection name, description, cover, items).
- **Papers** you add to your library (DOI, title, authors, year — fetched
  from public metadata sources, see section 5).
- **Reports** you submit (the share you reported, the reason, your
  optional comments).

### 2.3 View events (read traffic on public shares)

When anyone — signed-in or anonymous — opens a published share, we may
record a **view event** containing:

- The share that was viewed.
- The timestamp.
- One of:
  - your `viewer_user_id` if signed in, OR
  - an opaque per-install token from the mobile app, OR
  - **nothing identifying you at all** in the anonymous-web case.

For anonymous web traffic, we do **not** set cookies, do **not** persist
your IP address, and do **not** persist any hash derived from your IP.
A short-lived in-memory de-duplication record (lasting at most 24 hours,
gone on server restart) lets us count "one view per browser per share
per day" without storing anything that could identify you.

We exclude:
- Owner self-views (you don't pad your own counts).
- Known bot / link-preview UAs (Twitterbot, Slackbot, Bluesky, etc.).

We use this aggregated data to compute "trending shares" and "similar
shares" surfaces, and to give share owners view counts on their own
content.

### 2.4 What we do NOT collect

- **No analytics SDK.** No Google Analytics, no Plausible, no PostHog,
  no Sentry replay (Sentry error reporting only — see section 5).
- **No cookies on public read pages.** The web app sets a session cookie
  only when you sign in, and only for keeping you logged in.
- **No tracking cookies.** No marketing pixels, no third-party scripts,
  no fingerprinting.
- **No behavioural profiling.** We don't build a profile of "what kind of
  papers you like." We don't sell, share, or rent any data to anyone.

---

## 3. Why we collect it (legal basis under UK & EU GDPR)

| Data | Legal basis | Purpose |
|---|---|---|
| Account data | Contract (Art. 6(1)(b)) | Operating the service you signed up for |
| Content you create | Contract | Storing and serving your shares + library |
| View events | Legitimate interest (Art. 6(1)(f)) | Aggregate analytics for share owners + discovery |
| Reports | Legitimate interest | Moderating abuse / copyright complaints |
| Sentry error data | Legitimate interest | Diagnosing crashes that affect you |

Where we rely on **legitimate interest**, we have weighed our interest
against your privacy and concluded the processing is minimal,
non-intrusive, and reasonable to expect from a service you're using.
You can object at any time (section 6).

---

## 4. How long we keep it

| Data | Retention |
|---|---|
| Account | Indefinitely while your account exists; deleted on user delete (see section 6) |
| Shares + papers + library | Indefinitely while your account exists; deleted on user delete |
| Tombstoned shares (you deleted) | 30 days after deletion, then permanently dropped |
| View events | **90 days**, then permanently dropped by an automated job |
| Reports | Indefinitely (audit trail for moderation decisions) |
| Sentry crash data | 30 days (Sentry default) |

---

## 5. Third parties we share data with

We use the following processors. Each is a separate data-handling
relationship; we don't share data beyond what each processor needs.

| Processor | What they receive | Why | Location |
|---|---|---|---|
| **Neon** | Database storage | Postgres hosting | EU (eu-west-2) |
| **Vercel** | Web app hosting | Serving myetal.app | Worldwide CDN; EU-region functions |
| **Cloudflare** | DNS + (optionally later) edge caching | DNS resolution; no proxy or data inspection currently | Worldwide |
| **Sentry** | Crash + error data | Error tracking | EU |
| **Crossref** | DOIs you look up | Paper metadata lookup | EU |
| **OpenAlex** | DOIs you look up | Fallback paper metadata | EU |
| **ORCID** | Your ORCID id (when you sign in via ORCID) | OAuth login + future works sync | EU |
| **GitHub / Google** | Email + display name (when you sign in via them) | OAuth login | US (Standard Contractual Clauses) |

We have data-processing agreements with each of these where their terms
provide one. None of these parties are used for advertising or profiling.

---

## 6. Your rights

You have the following rights under UK & EU GDPR. To exercise any of
them, email **privacy@myetal.app** with the email address tied to your
account. We will respond within 30 days.

- **Access** — get a copy of the data we hold about you.
- **Rectification** — correct inaccurate data (you can edit most things
  yourself in the app; for anything else, email us).
- **Erasure** ("right to be forgotten") — delete your account and all
  associated data. Reports and view events are anonymised rather than
  deleted to preserve moderation audit trails and aggregate counts.
- **Restriction** — ask us to pause processing while a dispute is
  resolved.
- **Portability** — get your data in a machine-readable format (JSON).
  This is currently a manual process; an in-app export endpoint is
  planned (separate ticket: "Data portability — GDPR Article 20").
- **Object** — object to legitimate-interest processing (view tracking,
  moderation). We will stop unless we have an overriding legal reason
  to continue.
- **Withdraw consent** — where we rely on consent (currently nowhere —
  but if we add consent-based features in future, this right applies).
- **Complain to a supervisory authority** — if you're unhappy with how
  we handle your data, you can complain to the UK Information
  Commissioner's Office (https://ico.org.uk) or your local EU
  supervisory authority.

---

## 7. Children

MyEtal is not directed at children under 13 (US: COPPA / EU: GDPR Art.
8(1) — 13 in UK; 16 default in EU but member states vary). We don't
knowingly collect data from children. If you believe a child has signed
up, please contact us and we will delete the account.

---

## 8. Cookies

The web app at myetal.app sets the following cookies:

| Cookie | Purpose | Lifetime | Strictly necessary? |
|---|---|---|---|
| `myetal_session` | Keeps you signed in | Session / 30 days if "remember me" | Yes (auth) |

We do **not** set any analytics, advertising, or tracking cookies. We
do not require a cookie consent banner because we use no non-strictly-
necessary cookies.

The mobile app uses a per-install device token stored in
`expo-secure-store` for view-count de-duplication. This is functionally
equivalent to a per-app API key, not a tracking identifier across
services or devices.

---

## 9. Changes

We will update this page when we make material changes to data
processing. Previous versions are kept in the public git history at
https://github.com/JamesDimonaco/myetal/commits/main/docs/privacy-policy.md.

If a change materially expands what we collect or how we use it, we
will notify signed-in users by email at least 30 days before the change
takes effect.

---

## 10. Security

- Passwords are hashed with Argon2id (memory-hard, salted, no plaintext
  on disk or in logs).
- All API traffic is TLS-encrypted.
- The production database (Neon) and all processors listed above use
  encryption in transit and at rest.
- We do not collect payment data — we don't charge — so PCI scope is
  zero.
- Security disclosures: please report to **security@myetal.app** rather
  than opening a public issue. We aim to respond within 72 hours.
