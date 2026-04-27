import { redirect } from 'next/navigation';

/**
 * /sign-up now redirects to the unified auth page at /sign-in.
 * Users who bookmarked /sign-up will land on the same page with
 * OAuth buttons prominent and an email/password fallback below.
 * Query params (e.g. return_to) are forwarded.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (typeof val === 'string') qs.set(key, val);
  }
  const query = qs.toString();
  redirect(query ? `/sign-in?${query}` : '/sign-in');
}
