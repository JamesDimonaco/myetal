/**
 * Tiny module-level "outbox" for handing a Paper from the add-paper modal back
 * to the share editor when the modal dismisses.
 *
 * Why not router params? expo-router strips state when a modal closes, and
 * stuffing a JSON-stringified paper into a query string is ugly and lossy.
 * Why not a context? The editor and the modal are siblings, not parent/child.
 *
 * Lifecycle:
 *   1. user taps a result in the modal → setPendingPaper(paper); router.back()
 *   2. editor screen regains focus → consumePendingPaper() returns and clears
 *
 * Subscribers (the editor) register a listener so they pick up the paper the
 * frame after dismissal without polling.
 */

import type { Paper } from '@/types/paper';

let _pending: Paper | null = null;
const _listeners = new Set<(paper: Paper) => void>();

export function setPendingPaper(paper: Paper): void {
  _pending = paper;
  _listeners.forEach((fn) => fn(paper));
}

export function consumePendingPaper(): Paper | null {
  const p = _pending;
  _pending = null;
  return p;
}

export function subscribePendingPaper(listener: (paper: Paper) => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}
