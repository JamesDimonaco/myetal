import { describe, expect, it } from 'vitest';

import { isEmail, isWebUrl } from './validate';

// The share and feedback forms use noValidate (errors render inline), so
// these replace the browser's type="url" / type="email" checks. A schemeless
// URL saved to a share renders as a relative link that 404s.
describe('isWebUrl', () => {
  it.each(['https://github.com/foo/bar', 'http://example.org', 'https://doi.org/10.1/x?y=1'])(
    'accepts %s',
    (url) => expect(isWebUrl(url)).toBe(true),
  );

  it.each(['github.com/foo/bar', 'www.example.org', 'javascript:alert(1)', 'ftp://example.org', 'https://', ''])(
    'rejects %s',
    (url) => expect(isWebUrl(url)).toBe(false),
  );
});

describe('isEmail', () => {
  it.each(['james@example.com', 'a.b+c@sub.example.co.uk'])('accepts %s', (email) =>
    expect(isEmail(email)).toBe(true),
  );

  it.each(['james@', 'james.gmail.com', 'james@gmail', 'ja mes@example.com', ''])(
    'rejects %s',
    (email) => expect(isEmail(email)).toBe(false),
  );
});
