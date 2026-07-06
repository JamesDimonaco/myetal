/**
 * Unit tests for the client-side fetch wrapper.
 *
 * The distinguishing behaviour vs `api()` is the same-origin `/api/proxy`
 * prefix (so the httpOnly cookie can be attached server-side) and the absence
 * of an `auth` option — everything else mirrors the `api()` contract, and the
 * error-path tests here guard that the two wrappers never drift apart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from './api';
import { clientApi } from './client-api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('clientApi()', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes through the same-origin proxy, normalising the leading slash', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    await clientApi('/me/works');
    await clientApi('me/works');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/me/works');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/proxy/me/works');
  });

  it('sends json option as a stringified body with Content-Type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await clientApi('/shares', { method: 'POST', json: { name: 'n' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ name: 'n' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('returns parsed JSON on success and undefined on 204', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'x' }));
    await expect(clientApi('/shares/x')).resolves.toEqual({ id: 'x' });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(clientApi('/shares/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('throws ApiError with backend detail, falling back to statusText', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: 'Forbidden' }, { status: 403, statusText: 'Forbidden' }),
    );
    const err = await clientApi('/admin/overview').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isForbidden).toBe(true);

    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 500, statusText: 'Internal Server Error' }),
    );
    const err2 = await clientApi('/me').catch((e: unknown) => e);
    expect((err2 as ApiError).detail).toBe('Internal Server Error');
  });
});
