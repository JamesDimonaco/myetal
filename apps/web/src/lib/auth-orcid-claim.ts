/**
 * ORCID hijack-hardening for the Better Auth genericOAuth flow.
 *
 * Replicates the security property of the legacy
 * ``services/oauth.py::_find_or_create_user`` check: if the ORCID iD
 * returned in the OAuth profile is already linked to an existing
 * MyEtAl user, refuse to attach it / create a duplicate. Without this
 * check a malicious ORCID account that returns somebody else's email
 * could hijack their MyEtAl account.
 *
 * Threat model:
 *   The attacker controls an ORCID account whose stored email field
 *   matches a MyEtAl user's email. ORCID does not require email
 *   verification on its side. We treat the ORCID iD as the only
 *   trusted identifier from ORCID; emails are advisory.
 *
 * Called from ``mapProfileToUser`` in ``./auth.ts`` (genericOAuth
 * provider config). Throwing here aborts the OAuth flow before BA
 * creates a row. Better Auth surfaces the error in the redirect
 * chain — the sign-in page handles ``?error=orcid_already_linked``.
 */

import { eq } from 'drizzle-orm';

import { db } from './db';
import { users } from './db-schema';

export class OrcidIdAlreadyLinkedError extends Error {
  readonly code = 'orcid_already_linked' as const;
  constructor(orcidId: string) {
    super(
      `ORCID iD ${orcidId} is already linked to another MyEtAl account`,
    );
    this.name = 'OrcidIdAlreadyLinkedError';
  }
}

/**
 * Throws ``OrcidIdAlreadyLinkedError`` when ``orcidId`` matches the
 * ``orcid_id`` column on any existing user row. Only the lookup ever
 * leaves this function — the caller decides whether to attach.
 */
export async function assertOrcidIdNotClaimedElsewhere(
  orcidId: string,
): Promise<void> {
  if (!orcidId) return;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.orcidId, orcidId))
    .limit(1);
  if (rows.length > 0) {
    throw new OrcidIdAlreadyLinkedError(orcidId);
  }
}
