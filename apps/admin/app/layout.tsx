import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import '@flatrimony/design-tokens/tokens.css';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '800'],
  variable: '--font-latin',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Flatrimony Admin',
  robots: { index: false, follow: false },
};

// Admin UI is English-only: it is used by moderators, not end users (FR-ADM-01).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
