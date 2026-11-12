'use client';

/**
 * User-toggled dark mode (not OS `prefers-color-scheme` — see globals.css).
 * Public share pages (`/u/*`, `/c/*`) force light so link-preview crawlers
 * always render the same page regardless of the visitor's saved preference.
 *
 * Applies the `.dark` class to `<html>` directly (no re-render needed) and
 * persists to localStorage. A blocking inline script in layout.tsx applies
 * the class before first paint to avoid a light-mode flash.
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'theme';
const FORCE_LIGHT_PREFIXES = ['/u/', '/c/'];

type Theme = 'light' | 'dark';

const ThemeContext = createContext<{
  theme: Theme;
  forcedLight: boolean;
  toggle: () => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const forcedLight = FORCE_LIGHT_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
  // Lazy init reads localStorage directly rather than in a mount effect —
  // the server always renders 'light' (no window), so the class-application
  // effect below (and the blocking script in layout.tsx) is what actually
  // avoids a flash; this just gets subsequent client renders right.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== 'undefined' &&
    localStorage.getItem(STORAGE_KEY) === 'dark'
      ? 'dark'
      : 'light',
  );

  // Layout effect so a client navigation into a forced-light route never
  // paints a dark frame. pathname is a dep because Next re-renders the
  // theme-color meta per route.
  useLayoutEffect(() => {
    const dark = !forcedLight && theme === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#0F0F10' : '#FAFAF7');
  }, [theme, forcedLight, pathname]);

  function toggle() {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }

  return (
    <ThemeContext.Provider
      value={{ theme: forcedLight ? 'light' : theme, forcedLight, toggle }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
