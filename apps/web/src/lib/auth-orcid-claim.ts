/**
 * ORCID-iD ⇄ user-row linker for the Better Auth genericOAuth flow.
 *
 * Replaces the previous "hijack guard" behaviour. The earlier version
 * locked legitimate ORCID owners out of their own MyEtAl row when the
 * row already had ``users.orcid_id`` populated (typically via the
 * manual-entry path ``PATCH /me/orcid`` on the API side, or pre-Phase-3
 * legacy backfill). Two production users hit this; the failure mode was
 * a 302 to ``/sign-in?error=orcid_already_linked`` for the *real* ORCID
 * owner. The earlier docstring's "manual-entry shape" branch was the
 * common case, not the rare attack case.
 *
 * New policy: **OAuth proof of ORCID ownership wins.** Completing the
 * ORCID OIDC round-trip is the strongest possible signal that the user
 * controls that ORCID iD — stronger than any unauthenticated row
 * already claiming it. So whenever an ORCID OAuth profile arrives and a
 * user row already carries that iD, we attach the OAuth account to that
 * existing user row (idempotently) and let BA sign them in. No fork, no
 * duplicate row, no redirect.
 *
 * Concretely, on entry:
 *   • If no user row claims this orcidId → noop. BA creates a fresh
 *     user with the iD via its normal genericOAuth path.
 *   • If a user row claims it AND a matching ``account``
 *     (provider='orcid', accountId=<orcidId>) row already points at the
 *     same user → noop. Legitimate re-login.
 *   • If a user row claims it but no matching ``account`` row exists
 *     (manual-entry shape / legacy backfill) → insert the missing
 *     ``account`` row pointing at that user. BA's subsequent
 *     (providerId, accountId) lookup finds it and signs the user into
 *     their existing row.
 *
 * Security note: the previous threat-model concern was a malicious
 * ORCID profile whose email matches a MyEtAl user's email taking over
 * by email-match auto-link. That risk is independent of this function —
 * it's mitigated by ``account.accountLinking.disableImplicitLinking``
 * in ``./auth.ts``, which blocks email-based auto-linking. This
 * function only acts on the *ORCID iD*, which we treat as the trusted
 * identifier from ORCID (only the iD's true owner can complete the
 * OAuth round-trip).
 *
 * The ``OrcidIdAlreadyLinkedError`` class and the
 * ``?error=orcid_already_linked`` sign-in mapping are retained as
 * dead-code defence-in-depth: if the upsert ever fails for an unknown
 * reason we still want a controlled redirect rather than a BA 500.
 */

import { randomUUID } from 'node:crypto';

import { APIError } from 'better-auth/api';
import { and, eq } from 'drizzle-orm';

import { db } from './db';
import { account, users } from './db-schema';
import { isPlaceholderOrcidEmail } from './auth-orcid-public';

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
 * Build the redirect URL used by the dead-code fallback below.
 */
function hijackErrorRedirectUrl(): string {
  const base = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/sign-in?error=orcid_already_linked`;
}

/**
 * Ensure the OAuth-completing ORCID iD has an ``account`` row pointing
 * at whatever user row already claims it. Idempotent.
 *
 * Called from ``mapProfileToUser`` in ``./auth.ts``. After this returns,
 * Better Auth's normal ``handleOAuthUserInfo`` flow will find the
 * ``account`` row via its ``(providerId, accountId)`` lookup and sign
 * the user into the existing row — no new user is created, no error is
 * thrown.
 */
export async function ensureOrcidAccountForExistingUser(
  orcidId: string,
  publicOrcidEmail: string | null = null,
): Promise<void> {
  if (!orcidId) return;

  // 1. Does any user row already claim this iD? If not, nothing to do —
  // BA will create a fresh user with the iD via its normal path.
  const userRow = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.orcidId, orcidId))
    .limit(1);
  if (userRow.length === 0) return;

  const claimingUserId = userRow[0]!.id;
  const claimingUserEmail = userRow[0]!.email;

  // 1a. Email-placeholder backfill: ORCID's OIDC userinfo never
  // returns email, so any user who signed up via ORCID before we
  // wired the public-REST fallback has a ``${orcidId}@orcid.invalid``
  // placeholder on their row. If we now have a real public email for
  // them, overwrite the placeholder so password-reset / future
  // notification emails actually reach the user. Best-effort; failures
  // don't block sign-in.
  if (publicOrcidEmail && isPlaceholderOrcidEmail(claimingUserEmail)) {
    try {
      await db
        .update(users)
        .set({ email: publicOrcidEmail })
        .where(eq(users.id, claimingUserId));
    } catch (err) {
      console.warn(
        `[auth-orcid] failed to backfill placeholder email for user ${claimingUserId}`,
        err,
      );
    }
  }

  // 2. Is there already a matching ``account`` row?
  const accountRow = await db
    .select({ id: account.id, userId: account.userId })
    .from(account)
    .where(
      and(
        eq(account.providerId, ORCID_PROVIDER_ID),
        eq(account.accountId, orcidId),
      ),
    )
    .limit(1);

  if (accountRow.length > 0) {
    if (accountRow[0]!.userId === claimingUserId) {
      // Legitimate re-login — the account row already points at the
      // user row that claims this iD. Noop; BA will update tokens.
      return;
    }
    // Defence-in-depth: an ``account`` row exists for this iD but
    // points at a different user than the one ``users.orcid_id``
    // claims. The (providerId, accountId) unique index AND the
    // ``users.orcid_id`` unique index together should make this
    // unreachable. If we ever see it, bail loudly rather than silently
    // re-link — operator intervention is required.
    console.error(
      '[auth-orcid] inconsistent state: account row for ORCID iD ' +
        `${orcidId} points at user ${accountRow[0]!.userId} but ` +
        `users.orcid_id claims user ${claimingUserId}. Refusing to ` +
        'auto-resolve.',
    );
    throw new APIError(
      'FOUND',
      { message: 'orcid_already_linked', code: 'orcid_already_linked' },
      { Location: hijackErrorRedirectUrl() },
    );
  }

  // 3. Manual-entry / legacy-backfill shape: user row claims this iD
  // but no ``account`` row exists. Create it now — the OAuth-completing
  // user is the legitimate owner of the iD and therefore the legitimate
  // owner of the row that claims it. BA's subsequent (providerId,
  // accountId) lookup will find this row and sign them in.
  //
  // We populate only the fields BA needs to resolve the account ↔ user
  // mapping (id, userId, providerId, accountId, createdAt, updatedAt);
  // BA's ``handleOAuthUserInfo`` then UPDATEs the row with the OAuth
  // tokens (accessToken, refreshToken, idToken, scope, expiresAt) it
  // received from ORCID.
  try {
    await db.insert(account).values({
      id: randomUUID(),
      accountId: orcidId,
      providerId: ORCID_PROVIDER_ID,
      userId: claimingUserId,
    });
  } catch (err) {
    // Concurrent sign-in attempts could race to insert; the unique
    // ``(providerId, accountId)`` index makes the second one fail. That
    // is fine — by the time BA does its lookup, the row will be there.
    // Log + swallow.
    console.warn(
      '[auth-orcid] account-row link insert failed (likely concurrent ' +
        `sign-in race for orcidId=${orcidId}, userId=${claimingUserId})`,
      err,
    );
  }
}

/**
 * @deprecated Use {@link ensureOrcidAccountForExistingUser}. Kept as an
 * export so any external import path keeps compiling; behaviour is now
 * "link, don't throw."
 */
export const assertOrcidIdNotClaimedElsewhere =
  ensureOrcidAccountForExistingUser;
