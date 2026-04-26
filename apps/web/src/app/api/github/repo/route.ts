/**
 * Thin same-origin wrapper around `lookupRepo` so the client-side add-item
 * modal can ask "what does this GitHub URL look like?" without leaking
 * `GITHUB_TOKEN` to the browser. Returns 404 when the URL doesn't parse or
 * the upstream lookup fails, otherwise the `RepoInfo` JSON.
 */

import { NextResponse } from 'next/server';

import { lookupRepo, parseGithubUrl } from '@/lib/github';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('url');
  if (!raw) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }

  const parsed = parseGithubUrl(raw);
  if (!parsed) {
    return NextResponse.json({ error: 'not a github url' }, { status: 400 });
  }

  const info = await lookupRepo(parsed.owner, parsed.repo);
  if (!info) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json(info);
}
