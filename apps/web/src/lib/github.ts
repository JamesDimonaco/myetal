/**
 * GitHub repo lookup, called server-side from the public viewer and the
 * add-item modal's repo flow. Mirrors the shape of `src/lib/openalex.ts` —
 * no auth required, native fetch, Next data cache for memoisation, every
 * failure swallowed to `null` so a flaky upstream just hides the meta row.
 *
 * `GITHUB_TOKEN` (when set) bumps the rate limit from 60/h/IP to 5000/h.
 */

const GITHUB_API = 'https://api.github.com/repos';
const REVALIDATE_SECONDS = 60 * 60; // 1h — repo metadata changes slowly

export type RepoInfo = {
  fullName: string;
  description: string | null;
  htmlUrl: string;
  stars: number;
  language: string | null;
  license: string | null;
  avatarUrl: string | null;
  pushedAt: string | null;
};

function nullableString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Resolve `owner/repo` to its public metadata. Returns `null` on any failure
 * — 404, rate-limited 403, network blip, malformed JSON — so callers never
 * have to think about errors.
 */
export async function lookupRepo(
  owner: string,
  repo: string,
): Promise<RepoInfo | null> {
  const o = owner.trim();
  const r = repo.trim();
  if (!o || !r) return null;

  const url = `${GITHUB_API}/${encodeURIComponent(o)}/${encodeURIComponent(r)}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'MyEtAl-Web/0.1',
        ...authHeaders(),
      },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      full_name?: unknown;
      description?: unknown;
      html_url?: unknown;
      stargazers_count?: unknown;
      language?: unknown;
      license?: { spdx_id?: unknown; name?: unknown } | null;
      owner?: { avatar_url?: unknown } | null;
      pushed_at?: unknown;
    };

    const fullName = nullableString(data.full_name) ?? `${o}/${r}`;
    const htmlUrl =
      nullableString(data.html_url) ?? `https://github.com/${o}/${r}`;
    const stars =
      typeof data.stargazers_count === 'number' ? data.stargazers_count : 0;

    // Prefer SPDX id (e.g. "MIT") and fall back to the human name; both are
    // commonly null for repos with no LICENSE file.
    const license =
      nullableString(data.license?.spdx_id) ??
      nullableString(data.license?.name);

    return {
      fullName,
      description: nullableString(data.description),
      htmlUrl,
      stars,
      language: nullableString(data.language),
      license,
      avatarUrl: nullableString(data.owner?.avatar_url),
      pushedAt: nullableString(data.pushed_at),
    };
  } catch {
    return null;
  }
}

/**
 * Look up many `owner/repo` pairs in parallel, keyed by `owner/repo`. Pairs
 * that fail to resolve are simply absent from the map. De-dupes before the
 * network calls so a project listing the same repo twice fires one fetch.
 */
export async function lookupManyRepos(
  pairs: ReadonlyArray<{ owner: string; repo: string } | null | undefined>,
): Promise<Map<string, RepoInfo>> {
  const seen = new Set<string>();
  const unique: Array<{ owner: string; repo: string; key: string }> = [];
  for (const p of pairs) {
    if (!p) continue;
    const owner = p.owner.trim();
    const repo = p.repo.trim();
    if (!owner || !repo) continue;
    const key = `${owner}/${repo}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ owner, repo, key });
  }

  const entries = await Promise.all(
    unique.map(
      async (u) => [u.key, await lookupRepo(u.owner, u.repo)] as const,
    ),
  );

  const out = new Map<string, RepoInfo>();
  for (const [key, info] of entries) {
    if (info) out.set(key, info);
  }
  return out;
}

/**
 * Parse the common GitHub URL forms into `{ owner, repo }`. Returns `null`
 * for anything that doesn't look like a repo URL — gist links, profile-only
 * URLs, sub-paths beyond `owner/repo` are still accepted (we just take the
 * first two segments).
 */
export function parseGithubUrl(
  url: string,
): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // git@github.com:owner/repo(.git)
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // Add a scheme so the URL parser accepts `github.com/foo/bar`.
  const withScheme = /^[a-z]+:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[0];
  let repo = segments[1];
  if (repo.toLowerCase().endsWith('.git')) {
    repo = repo.slice(0, -4);
  }
  if (!owner || !repo) return null;

  return { owner, repo };
}
