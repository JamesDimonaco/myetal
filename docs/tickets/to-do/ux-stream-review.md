# UX-stream code review (3f023fb → e37ca87, 11 commits)

Read-only review of the UX-polish stream on `staging`. Files re-verified at HEAD.

## TL;DR

- One real React anti-pattern in `removeItem` (side-effect inside `setItems` updater) that will fire a duplicate toast under StrictMode dev and is a strict-mode footgun in general.
- One a11y regression: `aria-activedescendant` in `tag-input.tsx` doesn't account for the new synthetic "Create" row, so screen readers won't announce it while keyboard-navigating.
- Everything else is sound; the dnd-kit hook extraction, beforeunload guard, hidden-field Zod partitioning, and history.replaceState fix all look correct.

## Critical

None — nothing here will eat data, leak secrets, or take production down. Promote.

## Serious

1. **Side-effect inside `setItems` updater — `apps/web/src/components/share-editor.tsx:408-416`**
   `removeItem` calls `toast.success(...)` inside the state updater function. Updaters must be pure; React 18 StrictMode invokes them twice in dev, so the toast fires twice. In prod it's once today, but this is the precise pattern React warns about and any future re-render path that re-invokes the updater (concurrent features, future strict invariants) will resurface it. Fix: read the removed item via `items.find(...)` outside the setter, OR move the `toast.success` call after `setItems` (since `prev` here is just used to find the title for the message).

2. **`aria-activedescendant` ignores the Create row — `apps/web/src/components/tag-input.tsx:320-324`**
   The expression `showDropdown && visibleSuggestions[safeHighlight]` is `undefined` when `highlightOnCreate` is true, so `aria-activedescendant` is omitted exactly when the user is about to commit a new tag. Visually highlighted, accessibly invisible. Fix: when `highlightOnCreate`, point to `${listboxId}-opt-${visibleSuggestions.length}` (the id used on the Create `<li>` at line 377).

3. **Publish toggle has no debounce / in-flight guard — `apps/web/src/components/share-editor.tsx:770-802`**
   Pre-existing risk amplified by the new toast wiring: rapid double-click fires two independent mutations whose server-order is undefined, and each fires its own toast. `mutation.isPending` is already available — disable the switch (or early-return when `publishMutation.isPending || unpublishMutation.isPending`) to make the race impossible. Not introduced by this stream, but the new toast.success/toast.error calls (lines 787, 799) make a confused intermediate state user-visible for the first time.

## Minor / polish

1. **`saved-shares-section.tsx:48-51`** — `unsave` then `toast.success`. If `useSavedShares` is mounted in multiple components (it is — `save-button.tsx` also uses it), each instance keeps its own `saved` state and only the calling instance re-reads localStorage. Pre-existing, but worth knowing. No fix needed for this stream.

2. **`share-editor.tsx:373-379`** — `isDirty` effect's deps include `items` and `tags` (object/array refs). Initial render is skipped via `mountedRef`, but any future code path that reassigns `items` to a new-but-equal array (e.g. a future "normalise on hydrate") will silently flip dirty. The comment acknowledges the trade-off; leave as-is.

3. **`qr-modal.tsx:103-105`** — the `shareUrl` text node has `break-all` but no `max-w-*` constraint; a future SITE_URL change to a very long domain could push the modal width unexpectedly. Cosmetic.

4. **`share-editor.tsx:850`** — empty-state copy still reads "use the arrows to reorder" but desktop now offers drag handles too. Copy nit.

5. **`tag-input.tsx:267`** — `showDropdown = open && !atCap` will keep the dropdown rendered (with the empty-state hint) even if the `disabled` prop were ever set true after `open` was already true. The `disabled` prop is currently never passed by the editor, so theoretical only.

6. **`add-item-modal.tsx:1203-1207`** — `console.warn` includes the full presign URL, which carries a signed query string. Not a "secret" by the strict definition (single-use upload token already in flight), but a `new URL(presign.upload_url).host` would log just the host the comment claims to want.

7. **`share-editor.tsx:443-452`** — `handleDragEnd` reads `active.id` / `over.id`; dnd-kit types them as `UniqueIdentifier` (string | number). `findIndex((it) => it._key === active.id)` works because `_key` strings won't `===` a number, so no false positive — but a strict TS reader might want `String(active.id)` for clarity. No bug.

## Approved

The agent checked these specifically and is happy:

- **`_key` collisions**: `newKey()` (share-editor.tsx:160) is `item_${++_itemKeySeed}_${Date.now()}` — process-wide monotonic, no collisions across renders or session.
- **dnd-kit pointer activation distance (6px, line 436)** correctly prevents the IconBtn / form input clicks from being hijacked. Drag listeners are spread only on the GripIcon button (line 1137-1138), not on the row, so non-handle pointer-downs never start a drag.
- **`SortableItemRow` extraction** — `useSortable` is now called at component scope (line 1106), not inside `.map`. Correct fix for the hook-in-loop pitfall.
- **`history.replaceState` swap (line 645-647)** — App Router does not observe non-router history mutations, so the editor tree (and the Add Item modal) stay mounted. Refresh still resolves to `/dashboard/share/[id]` because the URL bar is authoritative. Genuinely the right fix.
- **beforeunload listener (line 383-393)** — cleanup unsubscribes on dep change / unmount, no leak. `e.returnValue = ''` is the correct legacy incantation.
- **`USER_EDITABLE_FIELDS` partition (line 119-133, 472-497)** — uses `path.replace(/\d+/g, '*')` to normalise array indices before set lookup. `items.0.title` -> `items.*.title`. Correct, and `console.warn` keeps the raw detail in DevTools for future debugging.
- **`qrMode` state (line 348-355, 575, 832)** — initial value `'post-save'` matches the default flow; quick-access path explicitly sets it before `setShowQr(true)`. `onKeepEditing` correctly elided in quick-access (line 1001-1003), so the modal renders the single-Done variant.
- **Tag input `commit(canonicalCandidate)`** — second canonicalise inside `commit()` is idempotent on already-canonical input. Empty-string and control-char inputs filter out cleanly at the canonicalise step.
- **`isDirty=false` set before post-save router push (line 579)** is necessary; the order matters — the discard guard would otherwise fire on the post-save navigation. Correct.
- **Sonner Toaster placement (providers.tsx:45)** is outside the Suspense boundary, so it can render before consent gating loads. Intended (toasts shouldn't block on consent).
- **QrModal `encodeURIComponent(shortCode)` (line 38)** for the QR PNG URL — correct (the short_code field is alphanumeric server-side, but defensive encoding is right).
- **No new `as any` casts. No raw HTML injection via React's escape hatch. No untrusted-input `href`s.** Toast strings interpolate `draft.title` etc. but sonner renders strings as text content, so no markup injection. No client-side localStorage of PII beyond pre-existing `myetal.saved_shares.v1` (already public collection metadata).
