# Universal Links / App Links manifests

These two files declare the binding between the `myetal.app` domain and the
mobile app, so that taps on `https://myetal.app/c/{shortcode}` open MyEtal
directly instead of bouncing through Safari / Chrome.

## Files

- `apple-app-site-association` (no `.json` extension — Apple is strict)
- `assetlinks.json`

## Hosting requirements

Both files MUST be served from `https://myetal.app/.well-known/<filename>`
with these exact characteristics:

- `Content-Type: application/json` for both (yes, even AASA — Apple changed
  the rule in iOS 9.3+; the file has no extension but the MIME type still
  must be JSON)
- HTTP 200, NO redirects (Apple's CDN follows zero redirects)
- NO authentication wall, NO cookies required
- HTTPS with a valid cert (Apple verifies)
- `Cache-Control` is fine but Apple will cache aggressively regardless

## Where these files actually live in production

The Next.js web app (`apps/web/`, owned by another agent) is responsible for
serving them at the public domain. The canonical location once the web app
ships will be `apps/web/public/.well-known/`. **DO NOT** copy them there
from this branch — coordinate with the web-app agent at merge time. For now
they sit here as the source of truth that the web team can copy or symlink
when they're ready.

## Placeholders

Both files contain placeholder strings that James must fill in before the
files go live:

- `TEAM_ID` in `apple-app-site-association` — get from Apple Developer
  portal (Membership tab) or `npx eas-cli credentials --platform ios`.
  Format: 10 alphanumeric chars, e.g. `ABCDE12345`.
- `TBD-FROM-EAS-CREDENTIALS` in `assetlinks.json` — get from
  `npx eas-cli credentials --platform android`. There will be **multiple**
  fingerprints to add (one per build profile + Google Play upload key); the
  array supports any number of strings.

See `../EAS.md` for the end-to-end checklist.
