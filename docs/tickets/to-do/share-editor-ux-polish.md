# Share editor UX polish — post-launch tightening

**Status:** Ready to start. Owner-reported on first day in prod (2026-05-15).
**Owner:** James
**Total effort estimate:** ~10-13 hours across 12 items. Recommend 3 PRs.
**Companion to:** `feedback-round-3-bug-bag.md`, `form-error-surfacing.md`, `qr-poster-pdf.md` — overlap items rolled into this plan with cross-refs.

---

## Context

User testing on prod surfaced a cluster of share-editor UX issues. Two are real bugs (PDF upload "Network error", QR-close-loses-context). Several are small polish items. One is a deeper restructure (PDF autosave) that the small-fix path doesn't actually address.

Decisions locked (owner, 2026-05-15):
- Toast position: **bottom-right**.
- PDF tab: **keep the current R2 flow** (autosave-draft → presign-against-share → upload → record). CORS rule on the R2 bucket is now in place. Bugs in the existing flow get fixed in place rather than restructured.
- Drag-and-drop reorder on desktop: **yes** (keep up/down arrow buttons as mobile fallback).
- Undo action on remove-item toast: **no**.

---

## P0 — broken now, fix before any user announcement

### 1. R2 upload "Network error during upload" with Retry disabled (~45 min)

**What's broken:**
- Presign succeeds (`apps/web/src/components/add-item-modal.tsx:1153` — returns the full `upload_url` + `fields` payload).
- The multipart POST to `r2.cloudflarestorage.com/myetal-uploads` fails at the transport layer → `xhr.onerror` fires (`add-item-modal.tsx:1189`) → user sees "Network error during upload. Try again."
- The "Try again" button is **disabled** because `canUpload` at `add-item-modal.tsx:1137` requires `phase === 'idle'`, but after the error `phase === 'error'`.

**Root cause (likely):** R2 bucket missing CORS allowing POST from `https://myetal.app`. Browser blocks preflight, `xhr.onerror` fires, no useful info reaches the user.

**Fix (two parts):**

1. **Cloudflare R2 dashboard → Buckets → `myetal-uploads` → Settings → CORS Policy → add:**
   ```json
   [
     {
       "AllowedOrigins": ["https://myetal.app", "https://www.myetal.app"],
       "AllowedMethods": ["POST", "GET"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
2. **Code:** broaden `canUpload` to `phase === 'idle' || phase === 'error'`. Improve the xhr.onerror message — distinguish CORS-block from offline by checking `navigator.onLine`. The CORS case should also surface a hint in the dev console (`console.warn` with the upload URL host) so future regressions are easier to spot.

**Test:** drag a PDF into the picker on prod after the CORS rule lands; confirm 204/200 from R2 and the editor advances to the recording phase.

**Estimate:** 15 min code + 5 min CORS config + 10 min test + 15 min buffer = 45 min.

### 2. QR-close mid-edit dumps user to dashboard (~30 min)

**What's broken:**
- User auto-saves a draft (today: switches to PDF tab → `autoSaveDraft` fires; once item 3 ships, this path goes away — but item 2 stands independently because edit-mode also opens QR mid-flow).
- Clicks "Show QR" → QR modal opens with broken image (draft → QR endpoint 404).
- Clicks backdrop → `closeQrAndGoToDashboard` runs (`share-editor.tsx:516`) → `router.push('/dashboard')` → user loses editing context.

**Fix:**
- Track whether the QR was opened FROM an explicit Save (post-save modal) vs FROM the "Show QR" quick-access button (line 671).
- For post-save: dashboard nav on close is correct.
- For quick-access: close just dismisses the modal; user stays in the editor.
- Practically: pass a `mode: 'post-save' | 'quick-access'` prop into `QrModal` (or simpler — make `onClose` the caller's responsibility, then `share-editor.tsx` passes the right callback for each mount).

**Estimate:** 30 min.

### 3. PDF tab modal self-closes on autosave (~45 min)

**What's broken (owner-reported):** open the editor → click Add Item → pick PDF tab → "Saving draft…" appears briefly → the Add Item modal closes itself, dumping the user back to the editor with no file picker.

**Root cause hypothesis:** the `autoSaveDraft` success path in `share-editor.tsx` mutates `effectiveId`, which percolates into `useUpdateShare(effectiveId)` and `usePublishShare(effectiveId)` mutation hooks (`share-editor.tsx:277-280`). The re-bound mutations + the changing key on whatever React.memo or dialog state machine is upstream of the modal cause the Dialog's `open` prop to be re-evaluated on a parent that re-rendered with stale state, closing it.

**Fix plan (keep the autosave; fix the side-effect):**
1. Repro locally first: open the editor on a new share, switch to PDF tab, watch React DevTools for the Add Item dialog's `open` flipping false.
2. Most likely: the autosave mutation path triggers `router.refresh()` or a TanStack invalidation that the editor surface listens to with `useShare(id)` and that swap re-mounts the editor → modal lives on the editor's tree → modal unmounts.
3. Likely simple fix: don't invalidate `shareKey` or `SHARES_KEY` from inside the autosave path — `setEffectiveId` + local state is enough. Let the natural cache flow take it from there.
4. Verify the modal stays mounted across the autosave → picker becomes active.

**Estimate:** 30 min repro + 15 min fix + commit = 45 min.

---

## P1 — UX polish

### 4. Tag input: always-open dropdown + "Create new: 'xyz'" affordance (~1 hour)

**What's broken** (`apps/web/src/components/tag-input.tsx:241`):
- `showDropdown = open && visibleSuggestions.length > 0` — too strict. Typed text doesn't match → dropdown disappears mid-type.
- After commit, dropdown only re-opens if `popular` returns tags AND those aren't all in `value`. Small DB → popular is empty → dropdown stays hidden until refocus.
- Users don't realise they can create freeform tags.

**Fix:**
- `showDropdown = open` (just gated on focus, not on suggestion count).
- When `trimmed && !suggestions.some(t => t.slug === canonicalise(trimmed))`: render a synthetic "Create '{canonical}'" row at the bottom of the list. Hitting Enter / clicking it commits as freeform tag.
- Empty-typed empty-popular state: render a single hint row "Type to add a tag — we'll suggest matches as you go."
- Add a footer hint: "Press Enter to add. Letters, numbers, hyphens."

**Estimate:** 1 hour.

### 5. Unsaved-changes guard on share editor navigation (~1.5 hours)

**Owner ask:** shadcn `AlertDialog` when user tries to leave with unsaved edits. Covers: header nav, back button, the "Go to dashboard" link inside the editor, browser tab close. Not save/submit.

**Implementation:**
1. Derive `isDirty` from current form state vs `initial` (or a captured baseline). For new shares, dirty = any field non-default; for existing, dirty = any field differs from initial.
2. Browser-level: `useBeforeUnload(isDirty)` — covers tab close, refresh, external nav.
3. App-level: wrap in-editor nav triggers in a `NavGuardLink` component that, if `isDirty`, intercepts the click and shows the AlertDialog with "Discard changes?" / Cancel / Discard.
4. Specific surfaces to guard:
   - Header avatar dropdown → Dashboard / Profile / Sign out
   - The "Back to dashboard" or breadcrumb link in the editor header
   - Any "Cancel" button if added

**Caveat:** Next.js App Router has no first-class router-event API. The `NavGuardLink` wrapper covers in-editor clicks but won't catch back-button navigation initiated outside the editor's DOM. `beforeunload` covers the worst case; everything else is best-effort.

**Estimate:** 1.5 hours (incl. shadcn AlertDialog wiring — already in `components/ui/` from the earlier shadcn pass).

### 6. Drag-and-drop reorder on desktop (~1.5 hours)

**Owner ask:** "drag and drop to be there on desktop would be fun."

**Implementation:**
- Add `@dnd-kit/core` + `@dnd-kit/sortable` (~30KB gzipped, well-maintained, zero React-version coupling).
- Wrap the items list with `<DndContext>` + `<SortableContext>`.
- Each item gets a drag handle (small grip icon visible on desktop hover, hidden via `sm:` Tailwind classes on touch devices).
- `onDragEnd` reorders the local items array via `arrayMove`.
- **Keep** the up/down arrow buttons — they remain the mobile and a11y path. Drag-and-drop is an enhancement, not a replacement.
- Touch-drag deliberately not enabled — touch users have arrow buttons; native drag-on-touch is fiddly.

**Estimate:** 1.5 hours (incl. styling the drag handle + drop-target affordance).

---

## P1 — toast + cleanup

### 7. Sonner toast wiring (bottom-right) (~45 min)

**Owner-confirmed position:** bottom-right.

**Steps:**
1. `pnpm add sonner` in apps/web.
2. Mount `<Toaster position="bottom-right" theme="light" toastOptions={{ classNames: { ... } }} />` in `apps/web/src/app/providers.tsx` (inside the consent provider so it benefits from the layout, but outside the page tree so it persists across navigation).
3. Style the toast to match the paper/ink/rule design tokens.
4. Wrap key actions:
   - Add item to share: `toast.success('Added "{title}"')`.
   - Remove item: `toast.success('Removed "{title}"')` — no Undo per owner.
   - Save share success: keep existing inline banner OR also fire a toast. Decide: inline is fine for the success state because it leads into the QR modal; toast for transient confirmation of secondary actions (add/remove/copy).
   - Copy link / copy code: `toast.success('Link copied')`.
   - Publish toggle: `toast.success('Now in discovery')` / `toast.success('Hidden from discovery')`.
   - Errors: replace ad-hoc `setError(...)` calls that aren't field-level with `toast.error(...)`.

**Estimate:** 45 min.

### 8. Consolidate post-save QR modal CTAs (~30 min)

**Owner ask:** "too many buttons. go to dashboard just takes the user there without saving it."

**Current modal:** Copy code, Copy link, Open, Keep editing, Go to dashboard. Five.

**Proposal:**
- Primary CTA: **Done** (closes modal, navigates to dashboard with a `router.refresh()`).
- Secondary CTA: **Keep editing** (closes modal, stays).
- Inline copy buttons next to the short_code + URL (already there for code, add for URL).
- Drop the standalone **Open** button — the QR + link in the modal already function as the share's representation; the user can scan the QR or click the URL itself.

The "Go to dashboard without saving" concern from the owner is mostly about the LEFT-RAIL "Go to dashboard" link inside the editor (separate from the QR modal). That one is addressed by item 5 (unsaved-changes guard).

**Estimate:** 30 min.

---

## From other tickets — rolled in here for batch shipping

### 9. From `feedback-round-3-bug-bag.md` #1 — re-test publish double-press (~30 min)

The double-press bug for the publish toggle has been re-reported twice and never resolved. Investigation notes (in that ticket) suggest the toggle code is correct on paper; suspected causes are React strict-mode double-invoke (dev only) OR PostHog autocapture binding twice.

Now that auto-publish-on-first-save (`6f354b5`) has shipped, a chunk of the original surface is gone. The toggle is now only exercised on edit-mode unpublish/republish. **Re-test in prod**: toggle a published share off, watch Network for a single `DELETE /publish`. If a double-fire is observed, capture the PostHog session replay and bisect autocapture. If no repro, mark the bug as resolved.

**Estimate:** 30 min repro + decide.

### 10. From `feedback-round-3-bug-bag.md` #5 — clear recents inline X per row (~15 min)

`apps/web/src/components/saved-shares-section.tsx` already has access to `unsave()` from `useSavedShares` — just no UI for it. Add a small ✕ button per row that calls `unsave(shortCode)`. Match the styling of the existing remove-tag button.

**Estimate:** 15 min.

### 11. From `form-error-surfacing.md` — route hidden-field Zod errors to a banner (~45 min)

Today the share editor surfaces raw Zod errors verbatim (`share-editor.tsx:354`). If validation fails on a field the user can't see (e.g. the `file_size_bytes` issue from earlier in launch week), the user gets a confusing message and no clear remediation.

Add a `partitionErrors` helper: split Zod issues into `inline` (paths the user can navigate to) vs `generic` (everything else). Render `inline` under their respective fields; `generic` errors collapse into a single top-of-form banner ("Something didn't validate. Try again or contact support.") and log full detail to PostHog.

The whole editor benefits, not just the share form. Worth doing once we're already in here for items 4-8.

**Estimate:** 45 min.

---

## NOT in scope — linked for context

### 12. `qr-poster-pdf.md` — A4 print PDF download from QR modal

Separate ticket, ~1.5 days of work. **Linked here** because the QR-modal cleanup in item 8 should leave a slot for a "Download poster" CTA so we don't have to re-layout the modal when that ships. Specifically: when item 8 lands, position the CTAs as a 2-column flexbox grid with `Done` and `Keep editing` so a third row can slot in cleanly later.

---

## Suggested PR shape

Owner directive (2026-05-15): ship as a stream of small commits straight to `staging`, NOT bundled PRs. Order below is the execution order; each item is a self-contained commit.

1. R2 Retry button enabled after error
2. QR-close-mode distinction (post-save vs quick-access)
3. PDF tab autosave modal-closes bug
4. Tag input always-open + create-new
5. Unsaved-changes AlertDialog
6. Drag-and-drop reorder
7. Sonner toast wiring
8. QR modal CTA consolidation
9. Publish-toggle repro (verification step, no code unless bug repros)
10. Clear-recents X
11. Hidden-field Zod error routing

**Total:** ~7-8 hours of focused work.

---

## Open questions remaining

1. **Sonner style** — match the existing `bg-paper` / `border-rule` aesthetic. Defaulting to match unless told otherwise.
2. **Drag handle icon** — six-dot grip (Notion style). Defaulting to that.

---

## Why we're NOT proposing

- Tag input full rewrite — current single-file component is fine after the targeted fix.
- Migrating share-editor to shadcn Form / react-hook-form — biggest refactor in the app, not worth gating on.
- Touch-drag-and-drop for mobile — fiddly, arrow buttons are good enough.
- Auto-claim of orphaned pending uploads — R2 lifecycle rule handles it.
- Cleanup of existing phantom draft shares — only the owner has any; not worth a one-off script.
