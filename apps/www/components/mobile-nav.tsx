'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_LINKS } from '@/lib/nav';

/**
 * The navigation below `md`.
 *
 * A disclosure rather than a drawer: the links open in flow underneath the bar, so there is
 * nothing to trap focus in, nothing to restore, and no scroll lock to undo. Escape closes it,
 * as does arriving on a new page.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // A link inside the panel navigates; the panel it was opened from should not survive that.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close the menu' : 'Open the menu'}
        onClick={() => setOpen((was) => !was)}
        className="card inline-flex size-11 items-center justify-center"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
          {open ? (
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-[var(--line)] bg-[var(--bg)] shadow-lg"
      >
        <ul className="mx-auto max-w-6xl px-4 py-2">
          {NAV_LINKS.map((link) => (
            <li key={link.label} className="border-b border-[var(--line)] last:border-0">
              {link.external ? (
                <a href={link.href} className="block px-1 py-3.5" rel="noreferrer">
                  {link.label}
                </a>
              ) : (
                <Link
                  href={link.href}
                  aria-current={pathname === link.href ? 'page' : undefined}
                  className="block px-1 py-3.5 aria-[current=page]:font-semibold aria-[current=page]:text-[var(--brand)]"
                >
                  {link.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
