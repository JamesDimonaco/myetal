'use client';

import posthog from 'posthog-js';
import { useEffect } from 'react';

import { useConsent } from '@/components/consent-provider';

/**
 * Identifies the signed-in user to PostHog once, so session replay and
 * analytics are tied to a real account. Only fires when consent is accepted
 * and PostHog is initialised.
 *
 * Uses the posthog singleton directly rather than usePostHog() so it can
 * safely render outside the PostHogProvider subtree (consent may be declined).
 */
export function PostHogIdentify({
  userId,
  email,
  name,
}: {
  userId: string;
  email: string | null;
  name: string | null;
}) {
  const { consent } = useConsent();

  useEffect(() => {
    if (consent !== 'accepted' || !posthog.__loaded) return;

    const properties: Record<string, string> = {};
    if (email) properties.email = email;
    if (name) properties.name = name;

    posthog.identify(userId, properties);
  }, [consent, userId, email, name]);

  return null;
}
