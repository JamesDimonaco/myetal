# Email Notifications (Future)

**Status:** Future — deferred from feedback-round-2 (Q12 picks in-app only for v1)
**Created:** 2026-05-07
**Depends on:** Comments shipping (`comments-on-shares.md`) — only sender of notifications today. Reactions-only path (Q11-C alternative) reshapes this ticket: digest of "X people reacted to your share" instead of per-comment events; cron remains, payload changes.

## Why this is deferred

V1 notifications are in-app badges only. Email digests need:
- A transactional email provider (Resend, Postmark, AWS SES — pick one).
- Daily digest cron on the Pi.
- Unsubscribe URLs that don't require auth.
- An unsubscribed-users blocklist.
- Bounce / complaint handling so we don't get blacklisted.
- Owner choice of digest cadence (immediate / daily / weekly).

The MVP for in-app already gives owners signal that someone commented. Email is an upgrade, not a v1 requirement.

## What this ticket would deliver

- Provider integration (recommendation: Resend for simplicity, ~$0/mo at our scale).
- `notification_preferences` table or JSON column on `users` (immediate / daily / weekly / off, per category).
- Daily digest cron at 09:00 UTC, batching unread comments per user. **Substrate depends on prod target at the time:** Pi → host crontab `apt install cron` calling `docker exec myetal-api ...`; Railway → native Railway cron service. Either way the script lives in `apps/api/scripts/`. If Better Auth migration ships first (it should — see INDEX), the auth provider's email-sender plugin can also be reused for the digest send path.
- Unsubscribe HMAC-signed URL pattern.
- One-click unsubscribe header support (RFC 8058).

## Triggers to revisit

- Comment system has > 10 active threads/week.
- User-feedback specifically asking for email.
- Push notifications come up (often paired — same plumbing).

## Effort

~3-4 days (provider setup, prefs schema, digest cron, unsubscribe flow, testing).
