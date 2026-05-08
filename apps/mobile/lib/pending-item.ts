/**
 * Tiny module-level "outbox" for handing items (paper, repo, or link) from the
 * add-item modal back to the share editor when the modal dismisses.
 *
 * Evolved from the paper-only `pending-paper.ts`. The discriminated union
 * `PendingItem` lets the share editor append the right kind without guessing.
 *
 * Why not router params? expo-router strips state when a modal closes, and
 * stuffing a JSON-stringified payload into a query string is ugly and lossy.
 * Why not a context? The editor and the modal are siblings, not parent/child.
 *
 * Lifecycle:
 *   1. user confirms an item in the modal → setPendingItem(item); router.back()
 *   2. editor screen regains focus → consumePendingItem() returns and clears
 *
 * Subscribers (the editor) register a listener so they pick up the item the
 * frame after dismissal without polling.
 */

import type { Paper } from '@/types/paper';
import type { ShareItem } from '@/types/share';

export type PendingItem =
  | { kind: 'paper'; paper: Paper }
  | { kind: 'repo'; title: string; url: string; subtitle: string | null; image_url: string | null }
  | { kind: 'link'; title: string; url: string; subtitle: string | null; image_url: string | null }
  /**
   * PR-C: PDFs are unique among item kinds — by the time the add-item modal
   * dismisses, the file is already uploaded to R2 and the `ShareItem` row
   * exists server-side (via `record-pdf-upload`). We hand the editor the
   * fully-formed `ShareItem` so it can render the new row immediately
   * without re-saving. Subsequent saves round-trip the file fields verbatim.
   */
  | { kind: 'pdf'; item: ShareItem };

let _pending: PendingItem | null = null;
const _listeners = new Set<(item: PendingItem) => void>();

export function setPendingItem(item: PendingItem): void {
  _pending = item;
  _listeners.forEach((fn) => fn(item));
}

export function consumePendingItem(): PendingItem | null {
  const p = _pending;
  _pending = null;
  return p;
}

export function subscribePendingItem(listener: (item: PendingItem) => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

