import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { DOCS_URL, REPO_PUBLIC, REPO_URL } from '@/lib/links';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3"
      >
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <img src="/img/favicon.svg" alt="" width={26} height={26} />
          <span>
            SD<span className="text-[var(--brand)]">ODS</span>
          </span>
        </Link>
        <div className="hidden items-center gap-6 text-sm md:flex">
          <Link href="/install/" className="hover:underline">
            Install
          </Link>
          <a href={DOCS_URL} className="hover:underline">
            Docs
          </a>
          <Link href="/roadmap/" className="hover:underline">
            Roadmap
          </Link>
          <Link href="/questions/" className="hover:underline">
            Questions
          </Link>
          <Link href="/feedback/" className="hover:underline">
            Feedback
          </Link>
          {REPO_PUBLIC && (
            <a href={REPO_URL} className="hover:underline" rel="noreferrer">
              GitHub
            </a>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/install/" className="btn btn-primary hidden text-sm sm:inline-flex">
            Install
          </Link>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
