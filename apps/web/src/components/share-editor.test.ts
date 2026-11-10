import { describe, expect, it } from 'vitest';

import { emptyItem, itemIssues } from './share-editor';

const base = { ...emptyItem(), title: 'A title' };

// A link field is only checked when its item kind shows that field.
// Otherwise a bad stored value blocks saving with no field to fix it in.
describe('itemIssues link checks', () => {
  it('flags a schemeless link on a field the kind shows', () => {
    expect(itemIssues({ ...base, kind: 'repo', url: 'github.com/x/y' }).url).toMatch(/https:\/\//);
    expect(itemIssues({ ...base, kind: 'paper', scholar_url: 'scholar.google.com' }).scholar_url).toMatch(/https:\/\//);
  });

  it('ignores link fields the kind does not show', () => {
    expect(itemIssues({ ...base, kind: 'paper', url: 'doi.org/10.1/x', image_url: 'x.png' })).toEqual({});
    expect(itemIssues({ ...base, kind: 'link', url: 'https://example.org', scholar_url: 'nope' })).toEqual({});
  });
});
