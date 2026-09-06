'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MobileNav } from '@/components/mobile-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { NAV_LINKS } from '@/lib/nav';
import { DESKTOP_RELEASE } from '@/lib/desktop-release';

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3"
      >
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <img src="/img/favicon.svg" alt="" width={26} height={26} />
          <span>
            SD<span className="text-[var(--brand)]">ODS</span>
          </span>
        </Link>
        <ul className="hidden items-center gap-6 text-sm md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              {link.external ? (
                <a href={link.href} className="hover:underline" rel="noreferrer">
                  {link.label}
                </a>
              ) : (
                <Link
                  href={link.href}
                  aria-current={pathname === link.href ? 'page' : undefined}
                  className="hover:underline aria-[current=page]:font-semibold aria-[current=page]:text-[var(--brand)]"
                >
                  {link.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* The primary call to action stays at every width; `.btn` sets its own display, so
              it is never given a responsive display utility.

              It points at the download page only once installers actually exist. Before the first
              desktop release, sending people to a page that says "not released yet" is worse than
              sending them to the installer that works — so this flips itself when the release
              manifest is filled in. */}
          {DESKTOP_RELEASE.tag ? (
            <Link href="/download/" className="btn btn-primary px-3 text-sm sm:px-4">
              Download
            </Link>
          ) : (
            <Link href="/install/" className="btn btn-primary px-3 text-sm sm:px-4">
              Install
            </Link>
          )}
          <ThemeToggle />
          <MobileNav />
        </div>
      </nav>
    </header>
  );
}
