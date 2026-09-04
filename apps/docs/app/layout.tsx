import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { basePath, siteUrl, withBase } from '@/lib/base-path';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL(`${siteUrl}${basePath}/`),
  title: { template: '%s | AutoMax', default: 'AutoMax' },
  description:
    'AutoMax is an automation platform with a reusable architecture: BDD for UI, API and hybrid automation, multi-project, data-driven, self-healing, with an MCP server and AI agents.',
  icons: { icon: withBase('/img/favicon.svg') },
  openGraph: {
    title: 'AutoMax',
    description: 'An automation platform with a reusable architecture.',
    url: `${siteUrl}${basePath}/`,
    siteName: 'AutoMax',
    images: [{ url: withBase('/img/automax-logo.svg') }],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ options: { type: 'static', api: withBase('/api/search') } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
