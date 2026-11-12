import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

// Default (root) viewport — most routes get the dark-mode toggle, so both
// color schemes are declared here. Forced-light routes (/u, /c) override
// this in their own layout to pin `light` (feedback round 3 #3, #6).
export const viewport: Viewport = {
  themeColor: '#FAFAF7',
  colorScheme: 'light dark',
};

// Applies the saved theme before first paint, so dark-mode users don't see
// a light flash. Mirrors theme-provider.tsx's forced-light route list —
// keep these in sync if that list changes.
const THEME_INIT_SCRIPT = `
try {
  var p = location.pathname;
  var forced = p.startsWith('/u/') || p.startsWith('/c/');
  if (!forced && localStorage.getItem('theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`;

export const metadata: Metadata = {
  title: {
    default: 'MyEtAl — share your research with a QR',
    template: '%s — MyEtAl',
  },
  description:
    'Share a paper or a curated reading list with a single QR code. Built for researchers.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myetal.app',
  ),
  icons: {
    // SVG-only favicon. Modern browsers (Safari 9+, Chrome 80+, Firefox 41+,
    // Edge) all support image/svg+xml favicons; the legacy /favicon.ico
    // reference produced a 404 in Safari because the file was never shipped.
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/favicon.svg',
  },
  openGraph: {
    siteName: 'MyEtAl',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-paper text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
