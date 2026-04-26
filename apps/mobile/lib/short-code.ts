/**
 * A QR scanned at a poster or slide can encode either:
 *  1. A canonical Universal Link:  https://myetal.app/c/{code}
 *  2. A bare short code:           Kp7vRq
 *
 * Both should land us on the same screen. Older shares may also use other
 * hostnames during dev (e.g. localhost) — we accept any host so long as
 * the path matches /c/{code}.
 */

const SHORT_CODE_REGEX = /^[A-Za-z0-9]{4,16}$/;
const URL_PATH_REGEX = /\/c\/([A-Za-z0-9]{4,16})\/?$/;

export function extractShortCode(scanned: string): string | null {
  const trimmed = scanned.trim();

  // Bare short code
  if (SHORT_CODE_REGEX.test(trimmed)) return trimmed;

  // URL form
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(URL_PATH_REGEX);
    if (match) return match[1];
  } catch {
    // Not a URL — fall through
  }

  return null;
}
