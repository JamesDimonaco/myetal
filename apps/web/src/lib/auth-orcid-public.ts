/**
 * Thin client for ORCID's *public* REST API.
 *
 * Why this exists: ORCID's OIDC userinfo endpoint
 * (``https://orcid.org/oauth/userinfo``) advertises
 * ``claims_supported`` of ``[family_name, given_name, name, auth_time,
 * iss, sub]`` — note the absence of ``email``. ORCID does not return
 * an email claim via OIDC under any circumstances, regardless of the
 * user's privacy settings. Email is only reachable through their
 * public REST record at ``/v3.0/{id}/record`` for users who have
 * marked their email visibility as ``public``.
 *
 * The fetch is best-effort: any failure (404, network, malformed JSON,
 * no public email) returns ``null`` and the caller falls back to the
 * synthesised ``${orcidId}@orcid.invalid`` placeholder. Sign-in must
 * never be blocked by ORCID API trouble.
 *
 * Sandbox toggle mirrors ``ORCID_USE_SANDBOX`` in ``./auth.ts``;
 * sandbox iDs only exist on ``sandbox.orcid.org``.
 */

const PROD_PUBLIC_BASE = 'https://pub.orcid.org/v3.0';
const SANDBOX_PUBLIC_BASE = 'https://pub.sandbox.orcid.org/v3.0';

const FETCH_TIMEOUT_MS = 4_000;

interface OrcidEmailEntry {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
  visibility?: unknown;
}

interface OrcidRecord {
  person?: {
    emails?: {
      email?: OrcidEmailEntry[];
    };
  };
}

function publicApiBase(): string {
  return process.env.ORCID_USE_SANDBOX === 'true'
    ? SANDBOX_PUBLIC_BASE
    : PROD_PUBLIC_BASE;
}

function pickBestPublicEmail(record: OrcidRecord): string | null {
  const entries = record.person?.emails?.email;
  if (!Array.isArray(entries)) return null;

  const isPublic = (e: OrcidEmailEntry): boolean =>
    typeof e.email === 'string' &&
    e.email.length > 0 &&
    e.visibility === 'public';

  // Preference order: public + primary + verified → public + verified
  // → any public.
  const primaryVerified = entries.find(
    (e) => isPublic(e) && e.primary === true && e.verified === true,
  );
  if (primaryVerified) return primaryVerified.email as string;

  const verified = entries.find((e) => isPublic(e) && e.verified === true);
  if (verified) return verified.email as string;

  const anyPublic = entries.find(isPublic);
  return anyPublic ? (anyPublic.email as string) : null;
}

/**
 * Fetch a user's primary public email from the ORCID REST API. Returns
 * ``null`` for any failure mode (no public email, network error,
 * malformed payload). Never throws — sign-in must never depend on
 * ORCID's public API being reachable.
 */
export async function fetchPublicOrcidEmail(
  orcidId: string,
): Promise<string | null> {
  if (!orcidId) return null;

  const url = `${publicApiBase()}/${encodeURIComponent(orcidId)}/record`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(
        `[auth-orcid] public-record fetch failed for ${orcidId}: HTTP ${res.status}`,
      );
      return null;
    }
    const record = (await res.json()) as OrcidRecord;
    return pickBestPublicEmail(record);
  } catch (err) {
    console.warn(
      `[auth-orcid] public-record fetch threw for ${orcidId}`,
      err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns true if ``email`` looks like the synthesised placeholder
 * we mint when ORCID gives us nothing — i.e. it's safe to overwrite
 * with a real address picked up from the public REST API. */
export function isPlaceholderOrcidEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && /@orcid\.invalid$/i.test(email);
}
