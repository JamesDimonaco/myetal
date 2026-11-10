import { describe, expect, it } from 'vitest';

import { serializeJsonLd } from './json-ld';

// JSON-LD goes into a <script> tag on public share pages, and share names
// are user input. A raw "</script>" would end the tag and run injected HTML.
describe('serializeJsonLd', () => {
  it('cannot close the script tag', () => {
    const out = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toMatch(/<\/script/i);
    expect(out).not.toContain('<');
  });

  it('still parses back to the same data', () => {
    const data = { name: 'a < b </script>', n: 1 };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});
