import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

// Web is intentionally light-only (see globals.css). Pinning theme-color and
// color-scheme stops mobile browsers from drawing a dark URL bar over the
// off-white page and stops dark-mode UAs from painting native scrollbar
// chrome that clashes with the chalkboard palette (feedback round 3 #3, #6).
export const viewport: Viewport = {
  themeColor: '#FAFAF7',
  colorScheme: 'light',
};

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
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-paper text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
