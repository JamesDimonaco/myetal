/**
 * Web ↔ mobile PDF-copy parity test.
 *
 * Both pdf-copy modules carry a "when you change a string here, change it
 * there too" comment (PR-C feedback W3/M4). Comments don't fail CI; this
 * does. Every exported string — and the output of the size-message
 * function — must be byte-identical across the two apps.
 *
 * The mobile module is imported by relative path: it is pure string
 * constants (no react-native imports), so it compiles fine under the web
 * tsconfig and needs no Metro.
 */
import { describe, expect, it } from 'vitest';

import * as mobile from '../../../mobile/lib/pdf-copy';
import * as web from './pdf-copy';

describe('pdf-copy web/mobile parity', () => {
  it('exports the same set of keys', () => {
    expect(Object.keys(mobile).sort()).toEqual(Object.keys(web).sort());
  });

  it('string constants are byte-identical', () => {
    for (const key of Object.keys(web) as (keyof typeof web)[]) {
      const w = web[key];
      const m = mobile[key as keyof typeof mobile];
      if (typeof w === 'string') {
        expect(m, `pdf-copy drift on ${key}`).toBe(w);
      }
    }
  });

  it('PDF_TOO_LARGE_MSG renders identically for the same size', () => {
    const sizes = [26 * 1024 * 1024, 25.1 * 1024 * 1024, 104_857_600];
    for (const size of sizes) {
      expect(mobile.PDF_TOO_LARGE_MSG(size)).toBe(web.PDF_TOO_LARGE_MSG(size));
    }
  });
});
