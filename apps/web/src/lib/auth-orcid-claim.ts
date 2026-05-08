/**
 * ORCID hijack-hardening for the Better Auth genericOAuth flow.
 *
 * Replicates the security property of the legacy
 * ``services/oauth.py::_find_or_create_user`` check: if the ORCID iD
 * returned in the OAuth profile is already linked to an existing
 * MyEtAl user (and is NOT this same user re-authenticating), refuse
 * to attach it / create a duplicate. Without this check a malicious
 * ORCID account that returns somebody else's email could hijack their
 * MyEtAl account.
 *
 * Threat model:
 *   The attacker controls an ORCID account whose stored email field
 *   matches a MyEtAl user's email. ORCID does not require email
 *   verification on its side. We treat the ORCID iD as the only
 *   trusted identifier from ORCID; emails are advisory.
 *
 * Re-login carve-out:
 *   When a user signs in via ORCID, BA writes both ``users.orcid_id``
 *   AND an ``account`` row keyed on (provider_id='orcid',
 *   account_id=<orcid iD>). On the SECOND ORCID sign-in for the same
 *   user, ``users.orcid_id`` is non-null — a naive "any user has this
 *   iD?" check would falsely flag legitimate re-authentication. So the
 *   guard ALSO consults the ``account`` table: if a matching account
 *   row exists, the iD is already correctly linked to the same user
 *   BA is about to authenticate, and the OAuth flow is safe to
 *   proceed. Only the case where ``users.orcid_id`` is set but there
 *   is NO matching ``account`` row triggers the hijack guard — that
 *   shape only occurs via the manual-entry path
 *   (``PATCH /me/orcid``) and represents a user trying to OAuth-link
 *   over someone else's manual claim.
 *
 * Called from ``mapProfileToUser`` in ``./auth.ts`` (genericOAuth
 * provider config). On a hijack attempt we throw a controlled BA
 * redirect (``APIError("FOUND", ..., {Location})``) so the user
 * lands on ``/sign-in?error=orcid_already_linked`` instead of BA's
 * generic 500 page. The sign-in page maps that code to a friendly
 * sentence (see ``app/sign-in/page.tsx::describeError``).
 */

import { APIError } from 'better-auth/api';
import { and, eq, ne } from 'drizzle-orm';

import { db } from './db';
import { account, users } from './db-schema';

const ORCID_PROVIDER_ID = 'orcid';

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
 * Build the redirect URL we send the user back to on a hijack attempt.
 *
 * Web users land on the sign-in page with a friendly error message.
 * Mobile users (whose OAuth start sets ``callbackURL`` to the bounce
 * page) land on the same web sign-in page inside the in-app browser —
 * acceptable v1 UX since the hijack case is rare and visible.
 */
function hijackErrorRedirectUrl(): string {
  const base = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/sign-in?error=orcid_already_linked`;
}

/**
 * Throws ``OrcidIdAlreadyLinkedError`` (wrapped as a BA ``APIError``
 * with HTTP 302) when ``orcidId`` is claimed by a different user than
 * the one currently re-authenticating via ORCID.
 *
 * "Different user" is defined as: a row in ``users`` with this
 * ``orcid_id`` exists, AND there is NO ``account`` row keyed on
 * (provider_id='orcid', account_id=<orcid iD>) — i.e. the iD got onto
 * the user row via manual entry rather than a previous ORCID sign-in.
 *
 * Idempotent for the common re-login case: same user, same iD, BA
 * about to authenticate them via the existing ``account`` row.
 */
export async function assertOrcidIdNotClaimedElsewhere(
  orcidId: string,
): Promise<void> {
  if (!orcidId) return;

  // Cheap path: does any user row have this iD? If not, nothing to
  // guard — BA will create a new user with the iD (or attach via
  // accountLinking, which we have disabled — see ./auth.ts).
  const userRow = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.orcidId, orcidId))
    .limit(1);
  if (userRow.length === 0) return;

  const claimingUserId = userRow[0]!.id;

  // Is there an ``account`` row that ties this ORCID iD to the user
  // it's claimed against? If yes, this is the legitimate re-login
  // shape — the same user is OAuth'ing in again.
  const accountRow = await db
    .select({ userId: account.userId })
    .from(account)
    .where(
      and(
        eq(account.providerId, ORCID_PROVIDER_ID),
        eq(account.accountId, orcidId),
      ),
    )
    .limit(1);

  if (accountRow.length > 0 && accountRow[0]!.userId === claimingUserId) {
    // Same user, same iD, with a matching account row — re-login.
    return;
  }

  // Hijack shape: the iD is on a user row but either has no account
  // (manual-entry claim) or is somehow tied to a different user row
  // (should be impossible given the unique index, but defence-in-depth).
  // ALSO: check there is no OTHER user row claiming this iD; the
  // unique index on users.orcid_id makes that a single row, but be
  // explicit.
  const otherUserCount = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orcidId, orcidId), ne(users.id, claimingUserId)))
    .limit(1);
  // The above query is informational; the actual guard fires whenever
  // we've reached this point — we have a claiming user and no matching
  // account row. Throw the redirect.
  void otherUserCount;

  // Throwing an APIError with status FOUND tells BA's router to emit
  // a 302 with the Location header we provide. This is the same
  // mechanism BA itself uses for its ``ctx.redirect`` calls. The
  // ``/sign-in`` page parses ``?error`` and renders a friendly
  // sentence (see ``ORCID_HIJACK_ERROR_CODES`` there).
  throw new APIError(
    'FOUND',
    { message: 'orcid_already_linked', code: 'orcid_already_linked' },
    { Location: hijackErrorRedirectUrl() },
  );
}
