import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo } from 'react';

import { ApiError, WEB_BASE_URL, api, setForcedSignOutHandler } from '@/lib/api';
import { clearSession, getSession, setSession } from '@/lib/auth-storage';
import type { AuthUser } from '@/types/auth';

const ME_KEY = ['auth', 'me'] as const;

/**
 * Mobile auth hook — Better Auth REST endpoints + Bearer JWT (Phase 4).
 *
 * The shape exposed to callers is unchanged from the legacy hook (signIn,
 * signUp, signOut, signInWith{Google,GitHub,Orcid}, refreshUser,
 * updateOrcidId) — under the hood we now call Better Auth's REST handlers
 * mounted on the Next.js app at ``${WEB_BASE_URL}/api/auth/*`` instead of
 * the deleted FastAPI ``/auth/{login,register,refresh,logout}`` routes.
 *
 * Token shape: a single short-lived (15 min) Ed25519-signed JWT minted by
 * BA's JWT plugin. There is no refresh token on mobile — the cookie BA
 * also sets is used only to mint the next JWT (when this one expires).
 * On 401 the api client clears the stored token and the (authed) layout
 * bounces to /sign-in.
 *
 * **Email sign-in/sign-up gotcha:** BA's ``/sign-in/email`` and
 * ``/sign-up/email`` responses include a top-level ``token`` field —
 * this is the **session id**, NOT a JWT. ``liftJwtFromBaResponse``
 * deliberately ignores it and follows up with ``/api/auth/get-session``
 * (header path) or ``/api/auth/token`` (body path) to get a real JWT.
 *
 * OAuth flow: WebBrowser.openAuthSessionAsync to BA's social-OAuth start
 * URLs with ``callbackURL`` pointing at the web app's
 * ``/auth/mobile-bounce`` page. That page reads the BA session set by the
 * provider redirect chain, fetches a JWT via ``/api/auth/token``, then
 * redirects the in-app browser to ``myetal://auth/callback?token=...``
 * which we parse out here.
 */
export function useAuth() {
  const queryClient = useQueryClient();

  // Lightweight presence check — drives whether the `me` query should fire.
  const sessionQuery = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: async () => {
      const stored = await getSession();
      return Boolean(stored);
    },
    staleTime: Infinity,
  });

  const meQuery = useQuery({
    queryKey: ME_KEY,
    queryFn: () => api<AuthUser>('/me'),
    enabled: sessionQuery.data === true,
    staleTime: 5 * 60_000,
    retry: (failureCount, error) => {
      // The api client clears the stored token on 401 and signals forced
      // sign-out — no point retrying.
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 2;
    },
  });

  // Wire the api client's "forced sign out" callback to invalidate our cache
  // when the JWT comes back rejected (expired, revoked, key rotated past).
  useEffect(() => {
    setForcedSignOutHandler(() => {
      queryClient.setQueryData(['auth', 'session'], false);
      queryClient.setQueryData(ME_KEY, null);
    });
    return () => setForcedSignOutHandler(null);
  }, [queryClient]);

  /**
   * Hit Better Auth's JWT-plugin endpoint to mint a fresh JWT for the
   * current session.
   *
   * Forwards an explicit ``Cookie`` header when ``sessionCookie`` is
   * provided (the value parsed off the prior sign-in's
   * ``set-cookie``), and ALSO sets ``credentials: 'include'`` so RN's
   * native cookie jar contributes whatever it has. Belt-and-braces
   * because RN cookie continuity varies by platform — some Android
   * builds drop them between fetches, iOS keeps them. Forcing the
   * header explicitly removes that variance.
   */
  const fetchJwt = useCallback(async (sessionCookie: string | null): Promise<string> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (sessionCookie) headers.Cookie = sessionCookie;
    const response = await fetch(`${WEB_BASE_URL}/api/auth/token`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`token_fetch_failed_${response.status}`);
    }
    const body = (await response.json()) as { token?: string };
    if (!body.token) throw new Error('token_missing_in_response');
    return body.token;
  }, []);

  /**
   * Persist the BA-minted JWT, then fetch /me to populate the user cache.
   * Mirrors the old `persistTokensAndRefreshUser` so call-sites stay tidy.
   */
  const persistJwtAndRefreshUser = useCallback(
    async (token: string, fallback?: { id?: string; email?: string }) => {
      await setSession({
        token,
        userId: fallback?.id,
        email: fallback?.email,
      });
      queryClient.setQueryData(['auth', 'session'], true);
      // Eagerly hydrate /me so the (authed) layout doesn't bounce to /sign-in
      // while react-query waits for the gated query to fire.
      const user = await api<AuthUser>('/me');
      queryClient.setQueryData(ME_KEY, user);
      return user;
    },
    [queryClient],
  );

  /**
   * Lift the BA-minted JWT for an email sign-in / sign-up response.
   *
   * IMPORTANT: ``data.token`` from ``/sign-in/email`` and
   * ``/sign-up/email`` is **NOT a JWT** — BA returns
   * ``token: session.token``, the random session id used to look up
   * the session row server-side. Feeding it to FastAPI as a Bearer
   * 401s every time. (This was the round-2 mobile blocker bug.)
   *
   * The JWT lives in two real places:
   *
   *   1. ``set-auth-jwt`` response header — emitted by the JWT plugin
   *      ONLY on ``/get-session``. So we follow up the sign-in with a
   *      ``GET /api/auth/get-session`` (forwarding the session cookie
   *      from the sign-in response) and read the header off that.
   *   2. ``GET /api/auth/token`` — the explicit JWT-mint endpoint,
   *      returns ``{ token: <jwt> }``. Used as a fallback for the
   *      (rare) case where step 1 doesn't surface the header (e.g.
   *      RN platform that strips response headers we don't expose).
   *
   * Both are session-cookie-bound: we pass the ``Cookie`` header
   * explicitly to remove dependence on RN's native cookie jar
   * (which is unreliable across platforms).
   *
   * Throws ``no_jwt`` if BOTH paths fail — sign-in fails cleanly
   * rather than persisting a broken token.
   */
  const liftJwtFromBaResponse = useCallback(
    async (response: Response): Promise<string> => {
      // The session cookie BA just set on the sign-in response. We
      // forward it explicitly on the follow-up calls so we don't
      // depend on RN's CookieJar carrying it.
      const sessionCookie = response.headers.get('set-cookie');

      // Step 1: GET /api/auth/get-session — JWT plugin emits the JWT
      // in the ``set-auth-jwt`` response header on this exact route.
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (sessionCookie) headers.Cookie = sessionCookie;
        const sessionResp = await fetch(`${WEB_BASE_URL}/api/auth/get-session`, {
          method: 'GET',
          headers,
          credentials: 'include',
        });
        if (sessionResp.ok) {
          const fromHeader = sessionResp.headers.get('set-auth-jwt');
          if (fromHeader) return fromHeader;
        }
      } catch {
        // Fall through to step 2.
      }

      // Step 2: GET /api/auth/token — explicit JWT-mint endpoint.
      // Returns ``{ token: <jwt> }``.
      return fetchJwt(sessionCookie);
    },
    [fetchJwt],
  );

  const signInMutation = useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const response = await fetch(`${WEB_BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email: input.email, password: input.password }),
      });
      if (!response.ok) {
        const detail = await readBetterAuthError(response);
        throw new ApiError(response.status, detail);
      }
      const data = (await response.json()) as {
        // ``token`` here is BA's session id, NOT a JWT — intentionally
        // not destructured/used. See ``liftJwtFromBaResponse`` docstring.
        user?: { id: string; email: string };
      };
      const jwt = await liftJwtFromBaResponse(response);
      return persistJwtAndRefreshUser(jwt, data.user);
    },
  });

  const signUpMutation = useMutation({
    mutationFn: async (input: { email: string; password: string; name?: string }) => {
      const response = await fetch(`${WEB_BASE_URL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          // BA accepts ``name`` as a top-level field when it's listed in
          // the user schema — our config keeps the default ``name`` core
          // field, so passing it directly is fine.
          name: input.name ?? '',
        }),
      });
      if (!response.ok) {
        const detail = await readBetterAuthError(response);
        throw new ApiError(response.status, detail);
      }
      const data = (await response.json()) as {
        // ``token`` here is BA's session id, NOT a JWT — see
        // ``liftJwtFromBaResponse``.
        user?: { id: string; email: string };
      };
      const jwt = await liftJwtFromBaResponse(response);
      // Soft email-verification: BA fires the verification mail (configured
      // in apps/web/src/lib/auth.ts) but we do NOT block — the user lands
      // signed-in immediately, banner reminds them on the home screen.
      return persistJwtAndRefreshUser(jwt, data.user);
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const stored = await getSession();
      if (stored) {
        // Best-effort revocation. Even if the network call fails we still
        // clear local state so the UI exits the (authed) group.
        try {
          await fetch(`${WEB_BASE_URL}/api/auth/sign-out`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${stored.token}`,
            },
            credentials: 'include',
          });
        } catch {
          // ignore
        }
      }
      await clearSession();
      queryClient.setQueryData(['auth', 'session'], false);
      queryClient.setQueryData(ME_KEY, null);
      // Drop everything that depended on the previous session
      queryClient.removeQueries({ queryKey: ['shares'] });
    },
  });

  /**
   * Generic OAuth flow via the web app's mobile-bounce page.
   *
   * Why bounce through the web app instead of redirecting directly to
   * `myetal://`: BA's social-OAuth handler can only `callbackURL` to an
   * https origin reliably (Google, GitHub, ORCID providers all reject
   * non-https redirects in their console allow-lists). The web's
   * `/auth/mobile-bounce` page reads BA's session, fetches a JWT, then
   * issues `window.location = myetal://auth/callback?token=...` — which
   * `WebBrowser.openAuthSessionAsync` intercepts on the mobile side.
   */
  const runOAuthFlow = useCallback(
    async (startPath: string, providerLabel: string): Promise<AuthUser> => {
      // Deep link the web's bounce page hands back. createURL gives us the
      // right scheme for THIS environment:
      //   - Expo Go:    exp+myetal://expo-development-client/...?path=auth/callback
      //   - Dev build:  myetal:///auth/callback
      const returnUrl = Linking.createURL('/auth/callback');
      const bounceUrl = `${WEB_BASE_URL}/auth/mobile-bounce?return=${encodeURIComponent(returnUrl)}`;
      const startUrl = `${WEB_BASE_URL}${startPath}?callbackURL=${encodeURIComponent(bounceUrl)}`;

      const result = await WebBrowser.openAuthSessionAsync(startUrl, returnUrl);
      if (result.type === 'cancel' || result.type === 'dismiss') {
        throw new Error(`${providerLabel}_oauth_cancel`);
      }
      if (result.type !== 'success') {
        throw new Error(`${providerLabel}_oauth_${result.type}`);
      }

      const parsed = new URL(result.url);
      // The bounce page passes the JWT in the query string (deep links don't
      // preserve fragments reliably across iOS/Android schemes). It also
      // surfaces an `error` param for things like ORCID hijack-hardening.
      const error = parsed.searchParams.get('error');
      if (error) throw new Error(error);
      const token = parsed.searchParams.get('token');
      if (!token) {
        throw new Error(`${providerLabel}_callback_missing_token`);
      }
      return persistJwtAndRefreshUser(token);
    },
    [persistJwtAndRefreshUser],
  );

  const signInWithGoogle = useCallback(
    () => runOAuthFlow('/api/auth/sign-in/social/google', 'google'),
    [runOAuthFlow],
  );

  const signInWithGitHub = useCallback(
    () => runOAuthFlow('/api/auth/sign-in/social/github', 'github'),
    [runOAuthFlow],
  );

  const signInWithOrcid = useCallback(
    // ORCID is wired via BA's genericOAuth plugin (provider id "orcid"),
    // hence the different start path.
    () => runOAuthFlow('/api/auth/sign-in/oauth2/orcid', 'orcid'),
    [runOAuthFlow],
  );

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const user = await api<AuthUser>('/me');
      queryClient.setQueryData(ME_KEY, user);
      return user;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }, [queryClient]);

  const updateOrcidIdMutation = useMutation({
    mutationFn: async (orcid_id: string | null) => {
      const updated = await api<AuthUser>('/me/orcid', {
        method: 'PATCH',
        json: { orcid_id },
      });
      queryClient.setQueryData(ME_KEY, updated);
      return updated;
    },
  });

  const isAuthed = Boolean(meQuery.data);
  const isLoading =
    sessionQuery.isLoading ||
    (sessionQuery.data === true && meQuery.isLoading) ||
    signInMutation.isPending ||
    signUpMutation.isPending;

  return useMemo(
    () => ({
      user: meQuery.data ?? null,
      isAuthed,
      isLoading,
      signIn: signInMutation.mutateAsync,
      signUp: signUpMutation.mutateAsync,
      signOut: signOutMutation.mutateAsync,
      signInWithGitHub,
      signInWithGoogle,
      signInWithOrcid,
      refreshUser,
      updateOrcidId: updateOrcidIdMutation.mutateAsync,
    }),
    [
      meQuery.data,
      isAuthed,
      isLoading,
      signInMutation.mutateAsync,
      signUpMutation.mutateAsync,
      signOutMutation.mutateAsync,
      signInWithGitHub,
      signInWithGoogle,
      signInWithOrcid,
      refreshUser,
      updateOrcidIdMutation.mutateAsync,
    ],
  );
}

/**
 * Better Auth returns errors as JSON like ``{ message: "...", code: "..." }``.
 * Pull a human-friendly string out, falling back to status text.
 */
async function readBetterAuthError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; code?: string };
    if (typeof body.message === 'string') return body.message;
    if (typeof body.code === 'string') return body.code;
  } catch {
    // not JSON
  }
  return response.statusText || 'request failed';
}
