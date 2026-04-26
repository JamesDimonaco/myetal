import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';

import { ApiError, API_BASE_URL, api, setForcedSignOutHandler } from '@/lib/api';
import { clearTokens, getTokens, setTokens } from '@/lib/auth-storage';
import type { AuthUser, TokenPair } from '@/types/auth';

const ME_KEY = ['auth', 'me'] as const;

/**
 * Single source of truth for the current user. The `me` query is gated on the
 * presence of stored tokens (a tiny "session" query that re-runs on focus and
 * after sign-in/out mutations) — that way an unauthenticated app doesn't fire
 * a doomed GET /auth/me on every mount.
 */
export function useAuth() {
  const queryClient = useQueryClient();

  // Lightweight presence check — drives whether the `me` query should fire.
  const sessionQuery = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: async () => {
      const tokens = await getTokens();
      return Boolean(tokens);
    },
    staleTime: Infinity,
  });

  const meQuery = useQuery({
    queryKey: ME_KEY,
    queryFn: () => api<AuthUser>('/auth/me'),
    enabled: sessionQuery.data === true,
    staleTime: 5 * 60_000,
    retry: (failureCount, error) => {
      // The api client already auto-refreshes once; if we still see 401 the
      // session is dead — don't keep retrying.
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 2;
    },
  });

  // Wire the api client's "forced sign out" callback to invalidate our cache
  // when the refresh token gets rejected (revoked / replayed / expired).
  useEffect(() => {
    setForcedSignOutHandler(() => {
      queryClient.setQueryData(['auth', 'session'], false);
      queryClient.setQueryData(ME_KEY, null);
    });
    return () => setForcedSignOutHandler(null);
  }, [queryClient]);

  const persistTokensAndRefreshUser = useCallback(
    async (pair: TokenPair) => {
      await setTokens(pair.access_token, pair.refresh_token);
      queryClient.setQueryData(['auth', 'session'], true);
      // Fetch /me eagerly so the (authed) layout doesn't briefly bounce to /sign-in
      const user = await api<AuthUser>('/auth/me');
      queryClient.setQueryData(ME_KEY, user);
      return user;
    },
    [queryClient],
  );

  const signInMutation = useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const pair = await api<TokenPair>('/auth/login', {
        method: 'POST',
        json: input,
        auth: null,
      });
      return persistTokensAndRefreshUser(pair);
    },
  });

  const signUpMutation = useMutation({
    mutationFn: async (input: { email: string; password: string; name?: string }) => {
      const pair = await api<TokenPair>('/auth/register', {
        method: 'POST',
        json: input,
        auth: null,
      });
      return persistTokensAndRefreshUser(pair);
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const tokens = await getTokens();
      if (tokens) {
        // Best-effort revocation — even if it fails (network/expired) we still
        // clear local state so the UI exits the authed group.
        try {
          await api('/auth/logout', {
            method: 'POST',
            json: { refresh_token: tokens.refresh },
            auth: null,
          });
        } catch {
          // ignore
        }
      }
      await clearTokens();
      queryClient.setQueryData(['auth', 'session'], false);
      queryClient.setQueryData(ME_KEY, null);
      // Drop everything that depended on the previous session
      queryClient.removeQueries({ queryKey: ['shares'] });
    },
  });

  const signInWithGitHub = useCallback(async (): Promise<AuthUser> => {
    /**
     * GitHub OAuth — pragmatic dev-build path.
     *
     * Real Universal Links flow waits on the EAS dev-build agent. Until then
     * we use the backend's `platform=devjson` mode which returns the JWT pair
     * as JSON in the browser response. We open an in-app auth session,
     * intercept GitHub's callback URL via the host platform's session API,
     * and read the tokens out of the trailing JSON page.
     *
     * On native this works because `WebBrowser.openAuthSessionAsync` keeps the
     * browser foregrounded long enough to fetch the JSON from the callback —
     * we then call /auth/github/callback ourselves with the same code+state to
     * receive the JSON body. (The backend completes the flow once and only
     * once; the second call would re-fail. So instead we fetch the JSON page
     * directly via fetch() after the browser-side redirect resolves.)
     *
     * Simpler approach taken here: open the start URL in `openAuthSessionAsync`,
     * wait for it to resolve, then surface a clear error if we couldn't capture
     * the tokens. The user-friendly fallback (manual paste of the JSON) is
     * implemented on the sign-in screen.
     */
    const startUrl =
      `${API_BASE_URL}/auth/github/start?platform=devjson&return_to=/dashboard`;

    if (Platform.OS === 'web') {
      // On web, just open the start URL in a new tab; user will paste tokens
      // back into the debug input.
      window.open(startUrl, '_blank');
      throw new Error(
        'github_devjson_manual: paste the JSON tokens into the debug input below.',
      );
    }

    const result = await WebBrowser.openAuthSessionAsync(startUrl, null);
    if (result.type !== 'success' && result.type !== 'dismiss') {
      throw new Error(`github_oauth_${result.type}`);
    }

    // The browser landed on the JSON page but expo-web-browser has no way to
    // read its body. Throw a sentinel error so the sign-in screen can prompt
    // the user to paste the JSON they see.
    throw new Error(
      'github_devjson_manual: paste the JSON tokens into the debug input below.',
    );
  }, []);

  /**
   * Consume a manually-pasted devjson response from the GitHub OAuth flow.
   * Returns the loaded user on success; throws on malformed input.
   */
  const consumeDevJsonTokens = useCallback(
    async (raw: string): Promise<AuthUser> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('Could not parse JSON. Copy the entire response body.');
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof (parsed as Record<string, unknown>).access_token !== 'string' ||
        typeof (parsed as Record<string, unknown>).refresh_token !== 'string'
      ) {
        throw new Error('JSON missing access_token or refresh_token.');
      }
      const pair = parsed as TokenPair;
      return persistTokensAndRefreshUser(pair);
    },
    [persistTokensAndRefreshUser],
  );

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
      consumeDevJsonTokens,
    }),
    [
      meQuery.data,
      isAuthed,
      isLoading,
      signInMutation.mutateAsync,
      signUpMutation.mutateAsync,
      signOutMutation.mutateAsync,
      signInWithGitHub,
      consumeDevJsonTokens,
    ],
  );
}
