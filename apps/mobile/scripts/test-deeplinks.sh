#!/usr/bin/env bash
# test-deeplinks.sh
#
# Manually fire deep links into a running iOS simulator or Android emulator
# (or attached Android device) so you can verify the routing behaviour
# without scanning a real-world QR code.
#
# Usage:
#   ./scripts/test-deeplinks.sh ios universal           [SHORTCODE]
#   ./scripts/test-deeplinks.sh ios scheme              [SHORTCODE]
#   ./scripts/test-deeplinks.sh ios expo-go             [SHORTCODE]
#   ./scripts/test-deeplinks.sh android universal       [SHORTCODE]
#   ./scripts/test-deeplinks.sh android scheme          [SHORTCODE]
#   ./scripts/test-deeplinks.sh android expo-go         [SHORTCODE]
#   ./scripts/test-deeplinks.sh all                     [SHORTCODE]
#
# SHORTCODE defaults to "PLACEHOLDER" — replace with a real share short code
# (e.g. "abc123") for end-to-end testing.
#
# What each variant tests:
#   universal  -> https://ceteris.app/c/<code>
#                 (iOS Universal Link / Android App Link — only works
#                  in a dev/preview/production build, NOT in Expo Go)
#   scheme     -> ceteris://c/<code>
#                 (custom-scheme deep link — works in dev builds and the
#                  standalone app, but NOT in Expo Go)
#   expo-go    -> exp+ceteris://c/<code>
#                 (Expo Go's wrapped scheme — use this when iterating in
#                  Expo Go before you have a dev build installed)
#
# Prereqs:
#   iOS:     Xcode + the iOS simulator booted (`xcrun simctl list`)
#   Android: Android SDK + an emulator running OR a device attached
#            with USB debugging enabled (`adb devices`)

set -euo pipefail

PLATFORM="${1:-}"
KIND="${2:-}"
CODE="${3:-PLACEHOLDER}"

ANDROID_PACKAGE="app.ceteris.mobile"

usage() {
  sed -n '2,30p' "$0"
  exit 1
}

ios_open() {
  local url="$1"
  echo "[ios] opening: $url"
  xcrun simctl openurl booted "$url"
}

android_open() {
  local url="$1"
  echo "[android] opening: $url  (package=$ANDROID_PACKAGE)"
  # -W = wait for launch; helpful for catching ActivityNotFoundException
  adb shell am start -W -a android.intent.action.VIEW -d "$url" "$ANDROID_PACKAGE"
}

run_ios() {
  case "$KIND" in
    universal) ios_open "https://ceteris.app/c/${CODE}" ;;
    scheme)    ios_open "ceteris://c/${CODE}" ;;
    expo-go)   ios_open "exp+ceteris://c/${CODE}" ;;
    *) usage ;;
  esac
}

run_android() {
  case "$KIND" in
    universal) android_open "https://ceteris.app/c/${CODE}" ;;
    scheme)    android_open "ceteris://c/${CODE}" ;;
    expo-go)   android_open "exp+ceteris://c/${CODE}" ;;
    *) usage ;;
  esac
}

case "$PLATFORM" in
  ios)     run_ios ;;
  android) run_android ;;
  all)
    KIND="universal"; run_ios || true; run_android || true
    KIND="scheme";    run_ios || true; run_android || true
    KIND="expo-go";   run_ios || true; run_android || true
    ;;
  *) usage ;;
esac
