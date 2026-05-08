# Comments on Shares (Future — extracted from feedback-round-2 §3)

**Status:** Deferred — owner picked Q11-B, scope locked, paused for more user testing
**Created:** 2026-05-08 (extracted from `done/feedback-round-2-tags-comments-pdf-discovery.md`)
**Owner:** James
**Effort estimate:** ~6 days, single PR (PR-D in the round-2 sequence)
**Why deferred:** Owner: *"I don't really want to deal with comments yet. I want to get some more user testing."*

---

## TL;DR

Users asked for comments on shares ("public and closed"). Owner picked the cleanest model: **per-share owner toggle** — `Share.allow_public_comments` boolean controls whether comments are public (anyone signed in can see them) or owner-only (private feedback inbox). Auth required to comment, in-app notifications only (email digest deferred to `email-notifications-future.md`).

The QR-on-poster wedge is mostly **signal** (researchers scan, look, leave). Comments invite moderation overhead. Owner accepted this is a "nice-to-have" feature, not a must-have. Ship it after we know whether users actually want to write comments rather than just react.

---

## Locked decisions

- **Q11-B**: per-share owner setting `Share.allow_public_comments BOOLEAN` (default true). Owner toggles per share.
- **Q12-A**: in-app badge notifications only. Daily email digests punted to `email-notifications-future.md`.
- **Q13**: yes — auth required to comment. No anonymous comments.

---

## Schema

New `share_comments` table:

```sql
id               UUID PK
share_id         UUID FK shares(id) ON DELETE CASCADE
author_user_id   UUID FK users(id) NOT NULL
body             TEXT NOT NULL
visibility       share_comment_visibility NOT NULL DEFAULT 'public'
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
deleted_at       TIMESTAMPTZ NULL  -- soft delete (preserves threading)
```

New enum: `share_comment_visibility AS ENUM ('public', 'owner_only')`.

New column on `shares`: `allow_public_comments BOOLEAN NOT NULL DEFAULT true`.

Note: `models/social.py` was deleted in the discovery ticket (D13 — see `done/public-discovery-and-collaboration.md`). Re-introducing comments means a new migration and a fresh model file, not resurrecting the deleted one.

---

## Endpoints

- `POST /shares/{id}/comments` — body `{ body: str, visibility: 'public' | 'owner_only' }`. Auth required. Rate-limited 10/user/hour. 403 if `visibility='public' AND share.allow_public_comments=false`.
- `GET /public/c/{short_code}/comments` — anon read. Returns only `visibility='public'` comments where `deleted_at IS NULL`.
- `GET /me/shares/{id}/comments` — owner read. Returns all comments (public + owner-only).
- `DELETE /shares/{id}/comments/{cid}` — owner can delete any; author can delete own. Soft delete (sets `deleted_at`), tombstone preserves threading.
- `POST /shares/{id}/comments/{cid}/report` — anyone signed in can report. Reuses the `share_reports` pattern from `done/public-discovery-and-collaboration.md` (D16).

---

## Abuse / moderation

- Rate limit: 10 comments/user/hour, 3 reports/IP/hour anon (reuses the existing `share_reports` rate limit).
- Owner-can-delete: any comment on their share, no review.
- Author-can-delete: their own comment, soft delete.
- Report flow: surfaces in the existing `/admin` queue alongside share reports.

---

## Web UX

Comment thread inline at the bottom of `apps/web/src/app/c/[code]/page.tsx`, below the items list. Composer above the thread. Visibility toggle radio next to compose: *"Visible to everyone"* / *"Only the curator sees this."*

When `share.allow_public_comments = false`, the public radio option is disabled with a tooltip *"This share's owner has disabled public comments."* — owner-only is still available so visitors can leave private feedback.

Empty state: *"Be the first to comment."* (when the share allows public comments) / *"Comments are off for this share."* (when disabled by the owner).

---

## Mobile UX

Comments live behind a *"Comments (N)"* button on the share view. Tapping opens a separate sheet — `@gorhom/bottom-sheet` if it's already a dep, otherwise a modal screen. Inline threads on phone screens are too cramped.

---

## Trade-off owner accepted

Reactions-only (Q11-C alternative) was on the table as ~2 days vs ~6 days for full comments. Owner picked B (full comments) anyway because:

- The QR-poster wedge might benefit from light text feedback ("nice work — would love to chat").
- Reactions feel underwhelming for academic content.
- Comments-with-owner-toggle preserves the option to disable per share if abuse becomes a problem.

If user testing in this round (post-PR-C) shows that scan-and-leave is overwhelmingly common, reconsider C.

---

## Out of scope

- **Email notifications** — deferred to `email-notifications-future.md`.
- **Threaded replies** — flat thread for v1. Replies are a future feature once we know if comments stick.
- **Reactions in addition to comments** — pick one, don't ship both. If we add reactions later, it's a separate enum and surface.
- **Anonymous comments** — locked no.
- **Moderation queue triage** — reuses existing share-reports infra; no new admin UI.

---

## Acceptance checklist

- [ ] Migration adds `share_comments` table + `share_comment_visibility` enum + `shares.allow_public_comments` column.
- [ ] `POST /shares/{id}/comments` rate-limited 10/user/hour; 403s if `visibility='public' AND allow_public_comments=false`.
- [ ] Anon reader at `/public/c/{short_code}/comments` only sees public, non-tombstoned comments.
- [ ] Owner reader at `/me/shares/{id}/comments` sees all (public + owner-only).
- [ ] DELETE soft-tombstones, preserving threading.
- [ ] Owner toggle for `allow_public_comments` exposed in the share editor on web AND mobile.
- [ ] Web comment thread inline on `/c/[code]`; mobile bottom-sheet from a "Comments (N)" button.
- [ ] In-app badge / unread-count surface for the share owner when a new comment lands.
- [ ] Empty states: *"Be the first to comment."* (public allowed) / *"Comments are off for this share."* (disabled).
- [ ] Tests: schema, rate limit, visibility filter, soft-delete tombstone, report flow, owner-toggle.

---

## Decision triggers (when to revisit)

- > 50 daily share views with zero comments → strong signal users are scan-and-leave; consider switching to reactions (Q11-C).
- First takedown / abuse incident → may need to tighten moderation before scaling.
- User feedback explicitly asking for "leave a comment" → green light to prioritise.
- Account linking ships (Better Auth) → comments can be richer (with reliable identity).
