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

export type PendingItem =
  | { kind: 'paper'; paper: Paper }
  | { kind: 'repo'; title: string; url: string; subtitle: string | null; image_url: string | null }
  | { kind: 'link'; title: string; url: string; subtitle: string | null; image_url: string | null };

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

// ---------- Backwards-compatible aliases ----------
// These are kept so existing callsites that haven't been migrated yet don't
// break. They wrap a Paper into the new union automatically.

/** @deprecated Use `setPendingItem` instead. */
export function setPendingPaper(paper: Paper): void {
  setPendingItem({ kind: 'paper', paper });
}

/** @deprecated Use `consumePendingItem` instead. */
export function consumePendingPaper(): Paper | null {
  const item = consumePendingItem();
  if (!item) return null;
  if (item.kind === 'paper') return item.paper;
  // Non-paper items are dropped by the legacy consumer — shouldn't happen
  // since all callers should be migrated, but fail safe.
  return null;
}

/** @deprecated Use `subscribePendingItem` instead. */
export function subscribePendingPaper(listener: (paper: Paper) => void): () => void {
  const wrapped = (item: PendingItem) => {
    if (item.kind === 'paper') listener(item.paper);
  };
  _listeners.add(wrapped);
  return () => _listeners.delete(wrapped);
}
