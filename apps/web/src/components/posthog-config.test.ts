import { describe, expect, it } from 'vitest';

import { posthogConfig } from '@/components/consent-provider';

// Harm prevented: setting cookies or recording sessions before the visitor
// accepts the banner (PECR/GDPR).
describe('posthogConfig', () => {
  it('keeps everything in memory and never records before consent', () => {
    const config = posthogConfig(false);
    expect(config.persistence).toBe('memory');
    expect(config.disable_session_recording).toBe(true);
  });

  it('persists to cookies and records once accepted', () => {
    const config = posthogConfig(true);
    expect(config.persistence).toBe('localStorage+cookie');
    expect(config.disable_session_recording).toBe(false);
  });
});
