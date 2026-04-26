# EAS Build & Universal Links — operator's guide

This document is the runbook for taking MyEtal from "runs in Expo Go" to
"runs as a real iOS/Android app, with QR codes opening directly into the
installed app via Universal Links / App Links."

Everything in this repo is already wired up for it. **You** still need to
do the bits that require account access, credential generation, or burning
EAS Build minutes. Those are listed below in order.

---

## TL;DR — what's already done in this branch

- `eas.json` with `development` / `preview` / `production` profiles
- `app.json` placeholder for `extra.eas.projectId`
- `eas-cli` pinned in `apps/mobile/devDependencies`
- `.well-known/apple-app-site-association` template (TEAM_ID placeholder)
- `.well-known/assetlinks.json` template (cert fingerprint placeholder)
- `scripts/test-deeplinks.sh` — fires deep links into sim/emulator/device

The Expo Go workflow (`pnpm --filter @myetal/mobile start`) **still works
exactly as before**. Dev builds are an additional path, not a replacement.

---

## Setup once

### 1. Accounts

- **Apple Developer** — already enrolled. ✓
- **Google Play Console** — *TODO*. $25 one-time fee, approval is usually
  same-day. Sign up at https://play.google.com/console/signup. Required
  before you can `eas submit --platform android` or upload any APK/AAB to
  Internal Testing. Not required to *build* an APK locally.
- **Expo (EAS)** — free tier is enough for setup; the $99/mo Production
  plan only matters once you start iterating heavily on Universal Links
  (the free 30-build/mo allowance disappears fast during AASA debugging).

### 2. CLI login + project link

From `apps/mobile/`:

```bash
pnpm install                   # picks up the new eas-cli devDependency
npx eas-cli login              # use your Expo account
npx eas-cli init               # writes the real projectId into app.json's
                               # extra.eas.projectId field
```

After `eas init` runs, `extra.eas.projectId` in `app.json` will change
from `"TBD-set-via-eas-init"` to a real UUID. **Commit that change.**

### 3. Configure native credentials (interactive, ~5 min)

```bash
npx eas-cli credentials --platform ios       # creates / fetches iOS cert + provisioning
npx eas-cli credentials --platform android   # creates / fetches Android keystore
```

EAS can manage these for you (recommended for v1 — pick "Let EAS handle it"
when prompted). Both platforms generate a key pair and store them
server-side; you don't have to keep .p12/.jks files locally.

While you're in `eas credentials`, grab and save:

- **iOS Team ID** — shown at the top of the iOS credentials menu, also
  visible in the Apple Developer portal under Membership. Format: 10
  alphanumeric chars (e.g. `ABCDE12345`).
- **Android SHA-256 cert fingerprints** — printed under the keystore
  details. There may already be more than one (debug keystore, EAS-managed
  upload key, Google Play app-signing key). You'll want **all** of them
  in `assetlinks.json` so any signed variant of the app can claim the
  domain.

---

## First dev build

Dev builds give you the production native shell (real bundle ID, icon,
splash, custom native modules) but with the JS bundle still served from
your laptop's Metro server. This is what makes Universal Links work on a
real device — Expo Go can't, because its bundle ID is `host.exp.Exponent`,
not `app.myetal.mobile`.

```bash
# iOS simulator build (no provisioning headaches, installs straight onto
# whichever simulator is booted)
npx eas-cli build --profile development --platform ios

# Android APK for emulator or sideload onto a real device
npx eas-cli build --profile development --platform android
```

Each takes **10–20 minutes** the first time (subsequent builds are faster
because the native dep cache warms up). When the build finishes you'll get
a QR code in the terminal — scan it on your phone (or click the URL on
the simulator) to install the dev client.

Once installed, instead of `npx expo start` use:

```bash
npx expo start --dev-client
```

…and shake the device (or hit `Cmd+D` in the iOS sim / `Cmd+M` in the
Android emu) to open the dev menu.

> **Reminder:** the `development` profile sets
> `EXPO_PUBLIC_API_URL=http://localhost:8000`. That works on the **iOS
> simulator** (which shares your Mac's localhost) but **not on a physical
> device**. For phone testing, either:
>
> 1. Override at `expo start` time:
>    `EXPO_PUBLIC_API_URL=http://192.168.1.x:8000 npx expo start --dev-client`
>    (substitute your Mac's LAN IP — `ipconfig getifaddr en0`), OR
> 2. Point at a deployed staging API.

---

## Universal Links checklist

This is the part that always bites. Follow it in order.

### 1. Fill in the placeholders

- Open `apps/mobile/.well-known/apple-app-site-association`
- Replace `TEAM_ID` with your actual Team ID (e.g. the file becomes
  `"appID": "ABCDE12345.app.myetal.mobile"`)
- Open `apps/mobile/.well-known/assetlinks.json`
- Replace `TBD-FROM-EAS-CREDENTIALS` with your SHA-256 fingerprint(s).
  Multiple fingerprints? The `sha256_cert_fingerprints` array takes any
  number — paste all of them. Format is colon-separated hex (e.g.
  `"AB:CD:EF:..."`), upper-case.

### 2. Get the files served at the public domain

The two files MUST end up at:

- `https://myetal.app/.well-known/apple-app-site-association`
- `https://myetal.app/.well-known/assetlinks.json`

…served as `Content-Type: application/json`, **no redirects, no auth**.

The Next.js web app (under `apps/web/`, owned by another agent in this
sprint) is the right home for them. When that branch lands, copy or
symlink these two files into `apps/web/public/.well-known/`. Don't do
that copy from this branch — coordinate at merge time.

In the interim, if you need to test before the web app exists, you can
host them on any HTTPS endpoint that resolves under `myetal.app`
(temporary Cloudflare Worker, a static `nginx` container, Caddy on the
same home server, etc.) — Apple/Google don't care who serves it as long
as the domain matches.

### 3. Verify before you tell users about it

Apple has a public validator at:

```
https://app-site-association.cdn-apple.com/a/v1/myetal.app
```

That's the URL Apple's CDN will hit; if it returns valid JSON, you're
good. Note **Apple caches AASA aggressively** — get-it-wrong-then-fix
cycles can take ~24 hours to clear. Validate **before** you publish
anything to the App Store.

For Android:

```bash
# Statement List Tester:
# https://developers.google.com/digital-asset-links/tools/generator
# Or hit the Google verification endpoint:
curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://myetal.app&relation=delegate_permission/common.handle_all_urls" | jq
```

On a connected device:

```bash
adb shell pm get-app-links app.myetal.mobile
# Should show: myetal.app -> verified
```

### 4. Smoke-test the round trip

Once the dev build is installed and the .well-known files are live:

```bash
./scripts/test-deeplinks.sh ios universal abc123
./scripts/test-deeplinks.sh android universal abc123
```

Expected: app opens directly to the public viewer for share `abc123`,
*without* Safari/Chrome appearing first. If a browser flashes, the
Universal Link verification failed — re-check the AASA file and Team ID.

---

## Day-to-day dev once the dev build is installed

```bash
# In one terminal:
docker compose up backend          # if you want the API local

# In another terminal, from apps/mobile:
npx expo start --dev-client        # NOT just `expo start` — that targets Expo Go

# On the device: open MyEtal (the dev build), shake for menu, "Reload"
```

The Expo Go path still works for fast UI-only iteration:

```bash
pnpm --filter @myetal/mobile start    # Expo Go, no Universal Links
```

Use whichever fits the task.

---

## Promoting builds

```bash
# Internal preview (TestFlight-style internal distribution, no store review)
npx eas-cli build --profile preview --platform all

# Production (store-bound binaries)
npx eas-cli build --profile production --platform all
```

The `preview` profile currently points at
`https://staging-api.myetal.app` — set up that staging API in the EAS
dashboard's project env vars, or override here in `eas.json` if you'd
rather pin it in source.

---

## Submitting to stores

```bash
# After a production build finishes:
npx eas-cli submit --platform ios       # uploads to App Store Connect
npx eas-cli submit --platform android   # uploads to Play Console (track defaults to "internal")
```

The `submit.production.ios.ascAppId` and `appleTeamId` placeholders in
`eas.json` need to be filled in before the first iOS submit:

- `ascAppId`: created when you make the app entry in App Store Connect
  (https://appstoreconnect.apple.com → My Apps → "+")
- `appleTeamId`: same Team ID you put in the AASA file

For Android, the `serviceAccountKeyPath` flow is documented at
https://docs.expo.dev/submit/android — you'll need a Google Play API
service account JSON before automated submits work.

---

## Sanity check — expo-router deep-link wiring

The Expo Router file layout already maps routes correctly. No changes
needed in `app/_layout.tsx` or `app/c/[code].tsx`:

- `scheme: "myetal"` in `app.json` → registers `myetal://` URLs
- `ios.associatedDomains: ["applinks:myetal.app"]` → entitles the iOS app
  to handle `https://myetal.app/*` Universal Links
- `android.intentFilters` with `autoVerify: true`, `host: "myetal.app"`,
  `pathPrefix: "/c"` → registers Android App Link verification
- File `app/c/[code].tsx` → automatically maps to the `/c/:code` path
  segment via expo-router's file-based routing

Combined: a tap on `https://myetal.app/c/abc123` (universal) or a scan
of `myetal://c/abc123` (custom-scheme fallback) will land in
`PublicShareScreen` with `params.code === "abc123"`. No extra
`Linking.addEventListener` plumbing required — expo-router handles it.

**One thing worth knowing:** the Android `intentFilter` block in
`app.json` uses `pathPrefix: "/c"`, which matches `/c`, `/c/`, `/c/abc`,
`/cats/anything`, etc. (Android does prefix-not-segment matching.) That's
fine for v1 because nothing else lives at `/c…`. If we ever add e.g.
`/changelog`, switch to `pathPattern: "/c/.*"` to be safe.

---

## Troubleshooting cheatsheet

| Symptom | Likely cause |
|---|---|
| Tap on link opens Safari/Chrome instead of app | AASA file 404, wrong MIME, or behind a redirect. Check `curl -I https://myetal.app/.well-known/apple-app-site-association` |
| Apple validator (`cdn-apple.com/.../myetal.app`) returns 404 | AASA hasn't propagated yet, or domain doesn't match `associatedDomains` exactly |
| Android shows a chooser instead of opening app | `autoVerify` succeeded but other apps also claim `https://myetal.app/c/*`. Check `adb shell pm get-app-links app.myetal.mobile` |
| Dev build can't reach API on physical device | `EXPO_PUBLIC_API_URL=http://localhost:8000` doesn't resolve from a phone — use LAN IP or staging URL (see "First dev build" note) |
| `eas build` says "no projectId" | You haven't run `eas init` yet, or the result wasn't committed |
| iOS Universal Link works in Safari address bar but not from Notes/Messages | This is normal — Apple disables Universal Links for the same domain when navigated within Safari. Long-press + "Open in MyEtal" |
