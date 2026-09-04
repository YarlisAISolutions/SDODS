import Link from 'next/link';
import { DISCUSSIONS_URL, DOCS_URL, LINKEDIN_URL, REPO_URL } from '@/lib/links';

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <img src="/img/favicon.svg" alt="" width={22} height={22} />
            SDODS
          </div>
          <p className="muted mt-2">
            An automation platform with a reusable architecture. Open source, Apache-2.0. API tokens
            are free.
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Product</h2>
          <ul className="space-y-1">
            <li>
              <Link href="/install/" className="hover:underline">
                Install
              </Link>
            </li>
            <li>
              <a href={DOCS_URL} className="hover:underline">
                Documentation
              </a>
            </li>
            <li>
              <a
                href={`${DOCS_URL}/docs/getting-started/installation/`}
                className="hover:underline"
              >
                Quickstart
              </a>
            </li>
            <li>
              <Link href="/roadmap/" className="hover:underline">
                Roadmap
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Community</h2>
          <ul className="space-y-1">
            <li>
              <a href={REPO_URL} className="hover:underline" rel="noreferrer">
                GitHub
              </a>
            </li>
            <li>
              <a href={DISCUSSIONS_URL} className="hover:underline" rel="noreferrer">
                Discussions
              </a>
            </li>
            <li>
              <Link href="/feedback/" className="hover:underline">
                Feedback and feature requests
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Legal</h2>
          <ul className="space-y-1">
            <li>
              <Link href="/privacy/" className="hover:underline">
                Privacy
              </Link>
            </li>
            <li>
              <a
                href={`${REPO_URL}/blob/main/LICENSE`}
                className="hover:underline"
                rel="noreferrer"
              >
                Apache-2.0 license
              </a>
            </li>
            <li>
              <a
                href={`${REPO_URL}/blob/main/SECURITY.md`}
                className="hover:underline"
                rel="noreferrer"
              >
                Security policy
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[var(--line)] py-4 text-center text-xs muted">
        Created by{' '}
        <a href={LINKEDIN_URL} className="underline" rel="noreferrer">
          Sireesh Yarlagadda
        </a>{' '}
        · © {new Date().getFullYear()} SDODS contributors
      </div>
    </footer>
  );
}
