import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './global.css';

export const metadata: Metadata = {
  title: { template: '%s | AutoMax', default: 'AutoMax' },
  description:
    'An automation platform with a reusable architecture built on Playwright: BDD for UI, API and hybrid automation.',
  icons: { icon: '/AutoMax/img/favicon.svg' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ options: { type: 'static', api: '/AutoMax/api/search' } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
