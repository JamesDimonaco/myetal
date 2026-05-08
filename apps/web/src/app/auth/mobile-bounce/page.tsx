/**
 * Mobile-bounce — Phase 4 Better Auth ↔︎ native handoff.
 *
 * The native app cannot accept an OAuth redirect directly (Google,
 * GitHub, ORCID provider consoles only allow https `redirect_uri`s, and
 * BA's own `callbackURL` for social sign-ins must therefore be https).
 * So we point BA's `callbackURL` here, on the same web origin BA owns,
 * and this page does the final hop into the `myetal://` deep-link the
 * mobile app is listening for.
 *
 * Flow:
 *   1. The OAuth provider redirects back to BA's
 *      ``/api/auth/callback/{provider}`` which writes the
 *      ``myetal_session`` cookie and then 302s to ``callbackURL`` —
 *      i.e. this page, with our `return` query string preserved.
 *   2. We read the session cookie server-side via
 *      ``auth.api.getSession``. If it's valid, we lift a JWT from
 *      ``auth.api.getToken`` (BA's JWT plugin endpoint).
 *   3. We render a tiny page that immediately
 *      ``window.location = ${return}?token=...`` — the native
 *      ``WebBrowser.openAuthSessionAsync`` listener intercepts that
 *      scheme and closes the browser.
 *
 * Security: the ``return`` URL must use a scheme we own. Anything else
 * (including https URLs) is rejected — preventing open-redirect via the
 * mobile-bounce page being reachable from a phishing link.
 */

import { headers } from 'next/headers';

import { auth } from '@/lib/auth';

import { RedirectScript } from './redirect-script';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Returning to MyEtAl…' };

const ALLOWED_NATIVE_SCHEMES = ['myetal://', 'exp+myetal://', 'exp://'] as const;

function isAllowedNativeReturn(value: string | undefined): value is string {
  if (!value) return false;
  return ALLOWED_NATIVE_SCHEMES.some((scheme) => value.startsWith(scheme));
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function appendParams(target: string, params: Record<string, string>): string {
  // Mobile deep links can be either ``myetal://auth/callback`` or include
  // an Expo-style ``?path=...`` already. Use URL when possible, otherwise
  // hand-merge a query string.
  try {
    const url = new URL(target);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    return url.toString();
  } catch {
    const qs = new URLSearchParams(params).toString();
    return target + (target.includes('?') ? '&' : '?') + qs;
  }
}

export default async function MobileBouncePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawReturn = pickFirst(params.return) ?? pickFirst(params.callbackURL);
  const returnUrl = isAllowedNativeReturn(rawReturn) ? rawReturn : null;

  const requestHeaders = await headers();

  // Pull the signed-in user via BA's session helper. This honours the
  // myetal_session cookie that the social-OAuth callback just wrote.
  const session = await auth.api.getSession({ headers: requestHeaders });

  // Failure modes that surface as ``error=...`` deep links so the mobile
  // app can render an inline message rather than hanging on a blank page.
  if (!returnUrl) {
    return (
      <FailurePage
        title="Couldn't return to the MyEtAl app"
        body="The deep-link target is missing or unsafe. You can close this tab and try signing in again from the app."
      />
    );
  }

  if (!session) {
    const errorUrl = appendParams(returnUrl, { error: 'no_session' });
    return <RedirectPage url={errorUrl} />;
  }

  // Lift a JWT from BA's JWT plugin. ``auth.api.getToken`` is the
  // server-side equivalent of the public ``/api/auth/token`` endpoint
  // and avoids a round-trip back through the cookie jar.
  let token: string;
  try {
    const result = (await auth.api.getToken({ headers: requestHeaders })) as
      | { token?: string }
      | string
      | null;
    const lifted = typeof result === 'string' ? result : (result?.token ?? null);
    if (!lifted) throw new Error('jwt_not_minted');
    token = lifted;
  } catch (err) {
    console.error('[mobile-bounce] failed to mint JWT', err);
    const errorUrl = appendParams(returnUrl, { error: 'jwt_unavailable' });
    return <RedirectPage url={errorUrl} />;
  }

  const finalUrl = appendParams(returnUrl, { token });
  return <RedirectPage url={finalUrl} />;
}

/**
 * Inline redirect page with three layers of redundancy because mobile
 * web-views are a hostile environment:
 *   1. ``<meta http-equiv="refresh">`` — always works, even if JS is off.
 *   2. ``window.location.replace`` from a tiny client island — instant,
 *      no history entry. See ``redirect-script.tsx``.
 *   3. A visible link as a final fallback (``user-tap`` always navigates).
 */
function RedirectPage({ url }: { url: string }) {
  return (
    <main
      style={{
        margin: '0 auto',
        maxWidth: 360,
        padding: '48px 24px',
        textAlign: 'center',
        font: '14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {/* meta refresh fallback — covers the no-JS case (rare on mobile but
          cheap to provide). Next.js renders <meta> in <head> when placed
          at the top of the component tree in app/ pages. */}
      <meta httpEquiv="refresh" content={`0;url=${url}`} />
      <p>Signing you into the MyEtAl app…</p>
      <p>
        <a href={url} style={{ color: '#111' }}>
          Tap here if it doesn&apos;t open automatically.
        </a>
      </p>
      <RedirectScript url={url} />
    </main>
  );
}

function FailurePage({ title, body }: { title: string; body: string }) {
  return (
    <main
      style={{
        margin: '0 auto',
        maxWidth: 420,
        padding: '48px 24px',
        textAlign: 'center',
        font: '14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>{title}</h1>
      <p style={{ color: '#666' }}>{body}</p>
    </main>
  );
}
