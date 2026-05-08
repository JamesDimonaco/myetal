/**
 * Module-level outbox for the editor → add-item modal handshake when the user
 * opens the PDF tab from a brand-new share (PR-C M1, "auto-save draft on
 * PDF intent").
 *
 * The PDF upload pipeline needs a server-side `share_id` to presign against.
 * Rather than dead-end the user with "save the share first", the modal
 * auto-creates the share with whatever draft state the editor currently has
 * (empty `items` is allowed by the backend — see PR-C contract).
 *
 * Flow:
 *   1. editor → setPendingShareDraft(draft) before opening the modal
 *   2. modal (PdfKindPane) → consumePendingShareDraft() → POST /shares
 *   3. modal → setShareCreatedFromDraft({ id, ... }) so the editor can
 *      router.replace from /share/new to /share/{newId} when the modal closes
 *   4. editor → consumeShareCreatedFromDraft() on focus, replaces route
 */
import type { ShareCreateInput, ShareResponse } from '@/types/share';

// ---- editor → modal ----

let _draft: ShareCreateInput | null = null;

/** Editor stashes its current form state here before opening the modal. */
export function setPendingShareDraft(draft: ShareCreateInput): void {
  _draft = draft;
}

/** Modal reads (without consuming) the draft to seed the auto-save POST. */
export function peekPendingShareDraft(): ShareCreateInput | null {
  return _draft;
}

/** Cleared when the editor unmounts a stale draft or after consumption. */
export function clearPendingShareDraft(): void {
  _draft = null;
}

// ---- modal → editor ----

let _created: ShareResponse | null = null;
const _createdListeners = new Set<(share: ShareResponse) => void>();

/** Modal calls this after a successful auto-save POST /shares. */
export function setShareCreatedFromDraft(share: ShareResponse): void {
  _created = share;
  _createdListeners.forEach((fn) => fn(share));
}

/** Editor reads + clears so the route swap only fires once. */
export function consumeShareCreatedFromDraft(): ShareResponse | null {
  const s = _created;
  _created = null;
  return s;
}

export function subscribeShareCreated(
  listener: (share: ShareResponse) => void,
): () => void {
  _createdListeners.add(listener);
  return () => _createdListeners.delete(listener);
}
