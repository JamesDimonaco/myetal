import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
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
     * GitHub OAuth — uses the backend's dev `mobile_redirect` parameter so the
     * /auth/github/callback bounces tokens to a URL Expo can intercept,
     * eliminating the manual-paste step. When EAS Universal Links land,
     * swap `mobile_redirect` for the production `https://myetal.app/...`
     * deep link and the rest of this code stays the same.
     */
    const startUrl =
      `${API_BASE_URL}/auth/github/start?platform=mobile&return_to=/dashboard`;

    if (Platform.OS === 'web') {
      // On web the same flow doesn't apply — the production web app uses
      // server-side cookies (see Next.js /api/auth/finish). For now in dev
      // we fall through to the manual paste path.
      window.open(startUrl, '_blank');
      throw new Error(
        'github_devjson_manual: paste the JSON tokens into the debug input below.',
      );
    }

    // expo-linking gives us the right scheme for THIS environment:
    //   - Expo Go:    exp+myetal://expo-development-client/...?path=auth-finish
    //   - Dev build:  myetal:///auth-finish
    const returnUrl = Linking.createURL('/auth-finish');
    const url =
      `${startUrl}&mobile_redirect=${encodeURIComponent(returnUrl)}`;

    const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('github_oauth_cancel');
    }
    if (result.type !== 'success') {
      throw new Error(`github_oauth_${result.type}`);
    }

    const parsed = new URL(result.url);
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    if (!accessToken || !refreshToken) {
      throw new Error('GitHub callback returned no tokens.');
    }

    return persistTokensAndRefreshUser({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
    });
  }, [persistTokensAndRefreshUser]);

  const signInWithOrcid = useCallback(async (): Promise<AuthUser> => {
    /**
     * ORCID OAuth — identical flow to GitHub/Google but hitting /auth/orcid/start.
     * The backend handles the OAuth dance and bounces tokens back via the
     * mobile_redirect parameter.
     */
    const startUrl =
      `${API_BASE_URL}/auth/orcid/start?platform=mobile&return_to=/dashboard`;

    if (Platform.OS === 'web') {
      window.open(startUrl, '_blank');
      throw new Error(
        'orcid_devjson_manual: paste the JSON tokens into the debug input below.',
      );
    }

    const returnUrl = Linking.createURL('/auth-finish');
    const url =
      `${startUrl}&mobile_redirect=${encodeURIComponent(returnUrl)}`;

    const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('orcid_oauth_cancel');
    }
    if (result.type !== 'success') {
      throw new Error(`orcid_oauth_${result.type}`);
    }

    const parsed = new URL(result.url);
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    if (!accessToken || !refreshToken) {
      throw new Error('ORCID callback returned no tokens.');
    }

    return persistTokensAndRefreshUser({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
    });
  }, [persistTokensAndRefreshUser]);

  const updateOrcidIdMutation = useMutation({
    mutationFn: async (orcid_id: string | null) => {
      const updated = await api<AuthUser>('/auth/me', {
        method: 'PATCH',
        json: { orcid_id },
      });
      queryClient.setQueryData(ME_KEY, updated);
      return updated;
    },
  });

  const signInWithGoogle = useCallback(async (): Promise<AuthUser> => {
    /**
     * Google OAuth — identical flow to GitHub but hitting /auth/google/start.
     * The backend handles the OAuth dance and bounces tokens back via the
     * mobile_redirect parameter.
     */
    const startUrl =
      `${API_BASE_URL}/auth/google/start?platform=mobile&return_to=/dashboard`;

    if (Platform.OS === 'web') {
      window.open(startUrl, '_blank');
      throw new Error(
        'google_devjson_manual: paste the JSON tokens into the debug input below.',
      );
    }

    const returnUrl = Linking.createURL('/auth-finish');
    const url =
      `${startUrl}&mobile_redirect=${encodeURIComponent(returnUrl)}`;

    const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('google_oauth_cancel');
    }
    if (result.type !== 'success') {
      throw new Error(`google_oauth_${result.type}`);
    }

    const parsed = new URL(result.url);
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    if (!accessToken || !refreshToken) {
      throw new Error('Google callback returned no tokens.');
    }

    return persistTokensAndRefreshUser({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
    });
  }, [persistTokensAndRefreshUser]);

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
      signInWithGoogle,
      signInWithOrcid,
      consumeDevJsonTokens,
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
      consumeDevJsonTokens,
      updateOrcidIdMutation.mutateAsync,
    ],
  );
}
