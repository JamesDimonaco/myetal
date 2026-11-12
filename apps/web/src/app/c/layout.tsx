import type { Viewport } from 'next';

// Public share pages stay pinned light regardless of the visitor's saved
// dark-mode preference — link-preview crawlers must always render the same
// page (see globals.css, theme-provider.tsx).
export const viewport: Viewport = {
  themeColor: '#FAFAF7',
  colorScheme: 'light',
};

export default function PublicShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
