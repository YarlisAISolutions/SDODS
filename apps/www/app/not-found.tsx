'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DOCS_URL } from '@/lib/links';

/**
 * The 404 page.
 *
 * It exists because Next's built-in one injects `body{color:#000;background:#fff}` with a
 * `prefers-color-scheme` override, and this site's dark mode is a `.dark` class. Anyone who chose
 * dark in the header while their OS is in light mode got a white page under a dark header, with
 * text the theme had already decided should be light. Defining this route removes that stylesheet
 * entirely — there is nothing to override once the default component is not used.
 */

// The desktop download is absent while DESKTOP_PUBLIC is off: suggesting a page that only
// explains why there is nothing to download is not a useful thing to offer someone who is lost.
const PLACES: Array<{ href: string; title: string; body: string }> = [
  {
    href: '/install',
    title: 'Install SDODS',
    body: 'One command, or your own package manager — npm, Homebrew, Docker, Scoop, apt.',
  },
  {
    href: `${DOCS_URL}/docs/getting-started/installation/`,
    title: 'Documentation',
    body: 'Getting started, the reference, and the workshop.',
  },
  { href: '/questions/', title: 'Questions', body: 'Ask one, or read what others have asked.' },
];

export default function NotFound() {
  // Only known in the browser: this file is one static 404.html served for every unmatched path,
  // so the address that failed cannot be rendered ahead of time.
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => setPath(window.location.pathname), []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-20">
      <h1 className="text-4xl font-extrabold tracking-tight">That page isn&rsquo;t here</h1>
      <p className="muted mt-4 text-lg">
        The address may be mistyped, or it may have moved since the link was written.
      </p>

      {path && path !== '/' && (
        <pre
          tabIndex={0}
          role="region"
          aria-label="The address that was not found"
          className="mt-6 overflow-x-auto"
        >
          <code>{path}</code>
        </pre>
      )}

      <h2 className="mt-14 text-2xl font-bold tracking-tight">Where you may have been going</h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {PLACES.map((place) => (
          <li key={place.href} className="card min-w-0 p-5">
            {/* Internal routes go through Link; the docs live on another origin. */}
            {place.href.startsWith('/') ? (
              <Link className="font-semibold underline" href={place.href}>
                {place.title}
              </Link>
            ) : (
              <a className="font-semibold underline" href={place.href}>
                {place.title}
              </a>
            )}
            <p className="muted mt-2 text-sm">{place.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
