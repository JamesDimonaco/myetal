/**
 * Unit tests for the server-side fetch wrapper (`api`) and `ApiError`.
 *
 * `fetch` is stubbed per-test; assertions cover the request-shaping contract
 * (URL joining, JSON body + Content-Type, Bearer header) and the
 * response-handling contract (detail extraction, non-JSON error bodies,
 * 204 → undefined). `API_BASE_URL` is imported rather than hardcoded so the
 * tests hold regardless of what the environment sets `NEXT_PUBLIC_API_URL` to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, API_BASE_URL, ApiError } from './api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('ApiError', () => {
  it('carries status + detail into the message', () => {
    const err = new ApiError(404, 'share not found');
    expect(err.message).toBe('HTTP 404: share not found');
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(404);
    expect(err.detail).toBe('share not found');
  });

  it('exposes the status-class getters', () => {
    expect(new ApiError(404, 'x').isNotFound).toBe(true);
    expect(new ApiError(401, 'x').isUnauthorized).toBe(true);
    expect(new ApiError(403, 'x').isForbidden).toBe(true);
    expect(new ApiError(500, 'x').isNotFound).toBe(false);
    expect(new ApiError(500, 'x').isUnauthorized).toBe(false);
    expect(new ApiError(500, 'x').isForbidden).toBe(false);
  });
});

describe('api()', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('joins paths onto API_BASE_URL, normalising a missing leading slash', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    await api('/me');
    await api('me');
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE_URL}/me`, expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE_URL}/me`, expect.anything());
  });

  it('sends json option as a stringified body with Content-Type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api('/shares', { method: 'POST', json: { name: 'My share' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'My share' }));
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Accept).toBe('application/json');
  });

  it('omits body and Content-Type when json is not passed', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api('/me');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('attaches a Bearer header when auth is passed, none otherwise', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    await api('/me', { auth: 'jwt-token' });
    await api('/public/browse');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-token');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it('returns the parsed JSON body on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'abc', item_count: 2 }));
    await expect(api('/shares/abc')).resolves.toEqual({ id: 'abc', item_count: 2 });
  });

  it('returns undefined for 204 No Content', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api('/shares/abc', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it("throws ApiError with the backend's detail string", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'Share not found' }, { status: 404, statusText: 'Not Found' }),
    );
    const err = await api('/shares/missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).detail).toBe('Share not found');
  });

  it('falls back to statusText when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>upstream exploded</html>', {
        status: 502,
        statusText: 'Bad Gateway',
      }),
    );
    const err = await api('/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).detail).toBe('Bad Gateway');
  });

  it('falls back to a generic detail when statusText is empty too', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500, statusText: '' }));
    const err = await api('/me').catch((e: unknown) => e);
    expect((err as ApiError).detail).toBe('request failed');
  });

  it('ignores non-string detail fields in the error body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: [{ loc: ['body'], msg: 'validation' }] }, { status: 422, statusText: 'Unprocessable Entity' }),
    );
    const err = await api('/shares', { method: 'POST', json: {} }).catch((e: unknown) => e);
    expect((err as ApiError).detail).toBe('Unprocessable Entity');
  });
});
