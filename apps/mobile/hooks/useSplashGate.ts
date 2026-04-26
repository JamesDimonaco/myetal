/**
 * Holds the native splash screen on first render and dismisses it once
 * the caller has rendered its first paint. Returns `ready` so any
 * fade-in / staggered-entrance can key off it.
 *
 * The native splash configured in app.json is the static image; this
 * hook controls the *dismissal* moment so the JS UI fades in cleanly
 * rather than flash-cutting after the static splash.
 *
 * Call once near the top of the app. We call it inside the root `_layout`
 * but the auth agent owns that file — so for now it is also safe to call
 * inside the landing `index.tsx`, which is the user's entry point.
 */
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';

let preventCalled = false;
function ensurePrevent() {
  if (preventCalled) return;
  preventCalled = true;
  SplashScreen.preventAutoHideAsync().catch(() => {
    // already-hidden or unsupported; harmless
  });
}

// eagerly call at module load so we capture the splash before React mounts
ensurePrevent();

export function useSplashGate(): { ready: boolean } {
  const [ready, setReady] = useState(false);
  const hidden = useRef(false);

  useEffect(() => {
    if (hidden.current) return;
    hidden.current = true;

    // Defer one frame so we don't tear; then fade-out the native splash.
    const t = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
      setReady(true);
    }, 50);
    return () => clearTimeout(t);
  }, []);

  return { ready };
}
