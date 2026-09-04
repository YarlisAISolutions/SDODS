import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SITE_URL } from '@/lib/links';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: '%s | AutoMax',
    default: 'AutoMax — an automation platform with a reusable architecture',
  },
  description:
    'AutoMax: BDD for UI, API and hybrid automation, multi-project and multi-environment, data-driven, self-healing, with before/after screenshot narratives, SQLite or Postgres, an MCP server, AI agents, GitHub and Jira integration and a web UI. Open source, Apache-2.0.',
  icons: { icon: '/img/favicon.svg' },
  openGraph: {
    title: 'AutoMax',
    description: 'An automation platform with a reusable architecture.',
    url: SITE_URL,
    siteName: 'AutoMax',
    type: 'website',
    images: [{ url: '/img/automax-logo.svg', width: 640, height: 160, alt: 'AutoMax' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AutoMax',
    description: 'An automation platform with a reusable architecture.',
  },
  alternates: { canonical: SITE_URL },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-black"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
