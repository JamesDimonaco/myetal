# Quick-share a single item — one-tap QR for one paper

**Status:** Proposal
**Created:** 2026-08-25
**Owner:** James
**Effort estimate:** ~0.5 day

---

## TL;DR

Real user feedback (Katie Lawther, 2026-08-22): she built a `project`-type share with a paper + two GitHub links, put the share's QR on her poster, then separately wanted a QR for *just the paper*. myetal has no way to do that, so she generated the paper's QR from Chrome's address bar instead — outside the app, no myetal branding, no analytics.

The fix isn't a new QR system. It's a one-tap way to spin off a paper, repo, or link item as its own single-item share, reusing every piece of QR/short-code/public-viewer/publish machinery that already exists.

---

## Why this is on-wedge

QR generation is per-`Share` (one `short_code` on the `shares` table, `GET /public/c/{short_code}/qr.png`), not per-item. A share with several items only ever gets one QR — the whole bundle.

That's fine for a poster that *is* the project. It breaks down the moment someone wants to hand out one piece of it separately — exactly Katie's case. The workaround today is manual: create a whole new share, re-add the one item, rename it, publish it. Most people won't bother; they'll do what Katie did and route around the app.

---

## Current state

- `Share.short_code` + `GET /public/c/{short_code}/qr.png` exist and work (`apps/api/src/myetal_api/api/routes/public.py`), but both the public viewer and the QR route require `published_at IS NOT NULL` (K3 fix-up — `get_public_share` / `get_public_share_with_tombstone`, `apps/api/src/myetal_api/services/share.py:119-140`). `is_public=True` alone is not enough; a draft never resolves.
- `create_share()` (`services/share.py:42`) always creates a draft — it never sets `published_at`. `publish_share()` (`services/share.py:282`) is a separate call that sets it. The share editor already does create-then-publish as two round-trips on first save (`apps/web/src/components/share-editor.tsx:573-599`), with a non-fatal fallback that leaves the share as a draft and surfaces a warning if the publish call fails.
- `publish_share`'s docstring is explicit that publishing is *also* the discovery opt-in — same flag gates the public QR, the sitemap (`list_sitemap_shares`, `services/share.py:260-278`), and similar/browse surfaces. There's no way to make the QR resolve without also making the share discoverable.
- `ShareItemCreate` rejects `kind=pdf` outright (`schemas/share.py:58-67`) — PDF items can only be created via the dedicated upload route. A quick-share action can't clone a PDF item as-is.
- Editor: `SortableItemRow` (`share-editor.tsx:1186`) is the per-item row — already has move-up/move-down/remove icon buttons (~line 1246) directly above the kind-branch that renders PDF fields differently (~line 1271). Natural slot for a new button, with an existing branch point to exclude it for `kind === 'pdf'`.
- `QrModal` (`apps/web/src/components/qr-modal.tsx`) takes `shortCode` + `collectionName` (not `name`) and is reusable as-is — but its current only caller closes back to `/dashboard`; quick-share needs its own close handler that stays in the editor.

---

## Proposed state

Add a **"Share this item"** icon button to `SortableItemRow`, next to remove/move — hidden for `kind === 'pdf'` items. On click:

1. `POST /shares` with a `ShareCreate` payload: `type: "paper"`, `name: <item.title, truncated to 200 chars>`, `items: [<copy of this one item>]`. Creates a draft, same as any new share.
2. `POST /shares/{id}/publish` immediately after — mirrors the editor's existing first-save sequence (`share-editor.tsx:573-599`). This is required, not optional: without it the QR modal opens on an image that 404s. Same non-fatal fallback as the editor: if publish fails, keep the draft and tell the user, don't lose the created share.
3. Open the existing `QrModal` (`shortCode` + `collectionName={item.title}`) with a close handler that returns to the editor, not the dashboard-redirect the editor's own save flow uses.
4. The new share is a normal share from here on — shows up in the owner's dashboard, editable, deletable, and (since it's published) gets the poster PDF button (`GET /public/c/{short_code}/poster.pdf`, already shipped per `conference-core-simplification.md`) and appears in sitemap/browse/similar like any published share.

No new backend route. Two existing endpoint calls plus a pre-filled payload and a modal that already exists.

---

## Why it's small

- Reuses `create_share` and `publish_share` unchanged, in the same sequence the editor already uses.
- Reuses `QrModal` unchanged.
- One new button + one new handler in the editor. No schema migration.
- Smaller than the already-scoped `duplicate-share` idea (INDEX.md, ~1.5 days) — that clones a whole share including tags and every item; this clones one item, no tags, no editor step before the QR shows.

---

## Decision points

1. **SharePaper preservation: punt it, and say so explicitly.** Papers added by hand land only in `share_items` (denormalised — title/doi/authors copied in). Papers added via the ORCID auto-draft path (`services/works.py:410`) additionally get a linked `share_papers` row (canonical `Paper` FK, used for "who else shares this paper" / similar-shares). But `ShareResponse` only ever serialises `items` (`schemas/share.py:121-140`) — it never exposes `paper_id`, so the client genuinely cannot tell which case it's in, or supply the link even if it wanted to. Recommendation: v1 always clones as a plain `ShareItem`, full stop — no server-side lookup, no `paper_id` param. This matches how hand-built shares already work (they get no `SharePaper` row either), so it's not a regression, just a named gap: a quick-shared item that *did* have discovery linkage on the parent share won't carry it to the mini-share. Revisit only if that's actually reported as a problem.
2. **Repo/link items work the same way.** Katie's ask was paper-specific, but the button should behave identically for `repo` and `link` kinds — `type: "paper"` on the new share (the schema default, `schemas/share.py:73`) is really "single item," the label just inherits from the default type. Open question worth a quick check, not a blocker: does `ShareType.PAPER` on a repo-only share read oddly anywhere in the UI (badges, icons)? If so, fall back to `bundle`.
3. **PDF items are excluded, not just deferred.** `ShareItemCreate` rejects `kind=pdf` server-side — the button must not render for PDF rows in `SortableItemRow`. This isn't a v2 nice-to-have, it's a required guard for v1 correctness.
4. **Auto-publish is mandatory, and it's a real trade-off worth naming.** The share must publish to make the QR work — but publishing is the same flag that opts it into sitemap/browse/similar-shares. A one-tap "just get me a QR" action will silently make the mini-share publicly discoverable, not just link-shareable. That's consistent with how every other new share on myetal already behaves (the editor's Publish toggle defaults to on), so it's not a new problem — but it's easy to not notice on a one-tap action. Worth a line in the button's tooltip/copy ("Creates a public share") rather than silence.
5. **Analytics.** The whole complaint in Katie's feedback is that Chrome's QR gave her no analytics. Fire a `posthog.capture('quick_share_created', { source_share_id, item_kind })` event, matching the existing pattern (`share-signup-bar.tsx:28`, `library-list.tsx:117`).
6. **No provenance link back to the source share.** The new share doesn't record where it came from. Fine to skip for v1 (per the effort target), but name it as a dropped trade-off: the dashboard will accumulate mini-shares with no visible link to their parent project. Revisit if that gets confusing at real usage volumes.

---

## Out of scope

- Any new short_code/QR/public-page infra at the item level.
- Bulk "share every item as its own QR" action.
- Custom naming/editing before the QR modal opens.
- Tags — quick-shared items don't inherit tags from the parent share.
- `SharePaper` link preservation (decision point 1) — always a plain `ShareItem` clone in v1.
- Server-side rate limiting on `create_share` — unlike the PDF routes (`routes/shares.py:240,305`, `20/minute`), `create_share` has none today. A one-tap button needs client-side disable-while-pending as the v1 guard; a server-side limiter is a cheap backstop worth adding later, not blocking this ticket (authed-only action, low abuse severity).
- Provenance linking back to the parent share (decision point 6).
- Mobile — web only, matching the platform decision in `conference-core-simplification.md` (mobile app on hold as of 2026-06-11).

---

## Acceptance checklist

- [ ] "Share this item" button on each row in the share editor, for `paper`, `repo`, and `link` kinds only — not shown for `pdf` items.
- [ ] Click → `POST /shares` then `POST /shares/{id}/publish`, in that order, mirroring the editor's own first-save sequence.
- [ ] If publish fails, the created share is kept as a draft and the user sees a non-fatal message — not lost work, not a silently broken QR.
- [ ] On success, `QrModal` opens immediately against the new share's `short_code`, closing back to the editor (not `/dashboard`).
- [ ] New share appears in the dashboard as a normal, independent, editable, published share — and is therefore also visible via sitemap/browse/similar, same as any published share.
- [ ] Quick-shared item is always cloned as a plain `ShareItem` row — no `SharePaper` link is created or expected (decision point 1).
- [ ] `quick_share_created` PostHog event fires on click, with `source_share_id` and `item_kind`.
- [ ] No new backend route — only the two existing `POST /shares` and `POST /shares/{id}/publish` endpoints.

---

## Risks

- Auto-publish-on-quick-share makes every mini-share publicly discoverable by default (decision point 4) — same behaviour as normal share creation today, but worth confirming that's acceptable given how casual the one-tap action is.
- No server-side rate limit on `create_share` (decision point 5's neighbour, listed under out-of-scope) — low severity since it's authed-only, but a scripted click-spam could mint many shares. Client-side debounce covers the realistic case for v1.

---

## Triggers to expand later

- *"My dashboard's full of mini-shares I can't tell apart"* — add the provenance link back to the source share (decision point 6), or group quick-shares under their parent in the dashboard UI.
- *"I quick-shared an ORCID-imported paper and it dropped off 'who else shares this'"* — revisit decision point 1: add server-side `SharePaper` lookup + clone.
- *"Someone's scripting quick-share spam"* — add a rate limiter to `create_share`, matching the existing `20/minute` pattern on the PDF routes.

---

## Source

User feedback, Katie Lawther, 2026-08-22 (Telegram): built a `project` share (paper + 2 GitHub links) for her asparagopsis poster, wanted a QR for just the paper, ended up using Chrome's built-in QR generator on the paper's own URL instead of myetal.
