import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Every text colour token must stay readable (WCAG AA, 4.5:1) on every
// surface we put text on. Tweaking a token in globals.css re-runs this.
const css = readFileSync(path.join(__dirname, 'globals.css'), 'utf8');

function token(name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --color-${name} not found`);
  return match[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ['ink', 'ink-muted', 'ink-faint', 'accent', 'danger'];
const SURFACES: Record<string, string> = {
  paper: token('paper'),
  'paper-soft': token('paper-soft'),
  'accent-soft': token('accent-soft'),
  white: '#FFFFFF',
};

describe('theme text contrast', () => {
  for (const text of TEXT) {
    for (const [surface, bg] of Object.entries(SURFACES)) {
      it(`${text} on ${surface} is at least 4.5:1`, () => {
        expect(contrast(token(text), bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
