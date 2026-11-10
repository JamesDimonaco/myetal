import { describe, expect, it } from 'vitest';

import { avatarLabel } from './user-avatar';

// The avatar button's accessible name must start with the initials it can
// show (WCAG 2.5.3), even if a photo is set, because a failed photo load
// falls back to initials. No name means no initials: never read out "?".
describe('avatarLabel', () => {
  it('starts with the initials shown in the avatar', () => {
    expect(avatarLabel('James Dimonaco', 'account menu')).toBe('JD account menu');
  });

  it('uses a plain label when there is no name', () => {
    expect(avatarLabel(null, 'account menu')).toBe('Account menu');
    expect(avatarLabel('  ', 'profile')).toBe('Profile');
  });
});
