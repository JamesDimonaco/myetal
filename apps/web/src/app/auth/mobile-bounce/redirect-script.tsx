'use client';

import { useEffect } from 'react';

/**
 * Client island for the mobile-bounce redirect.
 *
 * Why client-side: ``meta http-equiv="refresh"`` covers the no-JS case,
 * but on most mobile browsers ``window.location.replace`` is ~100ms
 * faster — meaningfully snappier as the user transitions back into the
 * native app. The visible <a> in page.tsx is the third fallback.
 *
 * The URL is built server-side in page.tsx after validating the deep-link
 * scheme is one we own (myetal://, exp+myetal://, exp://). It cannot
 * include arbitrary https origins, so this is a closed-redirect not an
 * open-redirect.
 */
export function RedirectScript({ url }: { url: string }) {
  useEffect(() => {
    try {
      window.location.replace(url);
    } catch {
      window.location.href = url;
    }
  }, [url]);
  return null;
}
