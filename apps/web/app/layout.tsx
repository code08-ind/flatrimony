import type { ReactNode } from 'react';

// The <html> element (with lang) is rendered by app/[locale]/layout.tsx.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
