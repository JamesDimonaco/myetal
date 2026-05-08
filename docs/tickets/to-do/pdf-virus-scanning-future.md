# PDF Upload — Virus Scanning (Future)

**Status:** Future — deferred from feedback-round-2 (PR-C, PDF upload v1)
**Created:** 2026-05-07
**Depends on:** `feedback-round-2-tags-comments-pdf-discovery.md` (PDF upload v1 ships first)
**Owner:** James

---

## Why this is deferred

V1 PDF upload validates MIME via the `%PDF-` magic-byte sniff (Q3) and bounds file size at 25 MB (Q2). It does **not** scan for malware.

Owner's reasoning at the time of deferral:

- Audience is researchers uploading their own posters / preprints, not anonymous web traffic.
- Files live on UploadThing's CDN, not on the Pi — they're not executed server-side.
- ClamAV adds operational complexity (extra container in the compose stack, daily definitions update, restart cadence) for a risk surface that's currently small.

Owner quote: *"document the deferral... but let's really consider this as a problem maybe create a subagent and make a future ticket."* This ticket is the placeholder.

---

## Why we'd revisit this

Threat model that matters:

1. A malicious actor signs up, uploads a PDF with embedded JavaScript (or a malformed object stream that exploits a parser CVE in older Adobe Reader).
2. Another user (the poster's audience — likely on a phone in front of the QR, possibly without an up-to-date PDF reader) downloads it.
3. Their reader opens the file. If it's vulnerable, the embedded payload runs.

The risk is real but small for our current audience. It scales with three things:

- Total upload volume (more files = more opportunities for one bad one).
- How "open" the upload surface is (today: must sign up + create a share + add an item — high friction; future: account linking + open registration drops the friction).
- Whether downloaders are on locked-down readers (Chrome built-in PDF viewer, modern macOS Preview — relatively safe) or on legacy installs (older Adobe Reader on Windows — historically the soft target).

We don't need to solve this now. We need to be ready to solve it before the friction drops or the volume picks up.

---

## Options when we revisit

- **A. ClamAV daemon on the Pi.** Open source, free, ~150 MB of definitions updated daily, integrates via `clamd` socket from FastAPI. Adds an extra service to the compose stack. Detection is based on signature DB — catches known malware, weak against zero-day or targeted attacks. Scan happens after the client tells us the upload is done; a positive signature halts the `ShareItem` creation and deletes the file from UploadThing.
- **B. Hosted virus-scanning API (VirusTotal, Cloudmersive, etc.).** Cheap per scan, no infra. Costs scale with volume, adds an external dependency in the upload critical path, has rate limits on free tiers. Privacy implication: the file is sent to a third party.
- **C. Lean on UploadThing's policies.** They have abuse handling but not active virus scanning. Fine if we trust files are CDN-hosted and never executed server-side — but does nothing for the downloader.

Recommendation when we get there: **A** (ClamAV) for control + zero per-file cost + audit trail. **B** as a stopgap if we need scanning live in <1 day.

---

## Triggers to revisit

Any one of these flips this ticket to active:

- First reported abuse incident (a user flags a PDF as malicious, or we receive an external report).
- More than 100 PDF uploads / month sustained.
- Account linking + open registration phases ship — the upload surface becomes available to anyone with an email address.
- A specific high-traffic share (>1000 scans/month) that uses PDF items — the blast radius of a single bad file goes up.

---

## Decision points (for when we revisit)

- Scan synchronously (block the upload-record response on a clean result) or asynchronously (record the item, scan in the background, take it down + email the owner if infected)?
- On a positive: hard-block (delete from UploadThing, return 422 to the client) or soft-flag (item exists but is hidden from public viewers until reviewed)?
- Notify the share owner when one of their items is flagged? Required, or opt-in?
- Notify viewers who already downloaded a now-flagged file? Probably required if we have the analytics to know who they were.
- Does the admin queue (existing `/admin/reports` surface) get a new "infected uploads" tab, or is this its own surface?
- Retention of the scan log: how long do we keep the result of every scan for audit?

---

## Effort estimate (rough)

- ClamAV path: **~1.5 days**. Add `clamav` service to the compose file, wire the socket into FastAPI, hook the scan into the post-upload record endpoint, infection-handling UX (web + mobile), tests (clean + EICAR test signature). Plus runbook entry for definitions-update failure.
- Hosted-API path: **~0.5 day**. Wrapper client, drop into the same hook point, billing alarm, dependency-down handling.
- Either path adds ~0.5 day for the admin-queue surfacing and the owner-notification email if we want those.
