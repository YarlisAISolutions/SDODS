import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CURRENT_YEAR,
  HORIZON,
  LEVELS,
  NEXT_UP,
  ROADMAP,
  VERIFICATION,
  type CheckpointState,
} from '@sdods/roadmap';
import { RailHero, YEAR_ART } from '@/components/roadmap-art';
import { DOCS_URL, REPO_PUBLIC, REPO_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Roadmap',
  description:
    'Five years of SDODS: what shipped, what is being built, and the customer value each year buys.',
};

const STATUS_STYLE: Record<CheckpointState, string> = {
  delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  now: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  planned: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  direction: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const STATUS_WORD: Record<CheckpointState, string> = {
  delivered: 'Shipped',
  now: 'Being built',
  planned: 'Planned',
  direction: 'Direction',
};

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight md:text-5xl">
        Five years from <span className="brand-gradient">evidence</span> to sign-off
      </h1>
      <p className="muted mt-4 max-w-2xl text-lg">
        SDODS climbs one ladder. Each year buys a level of confidence the year before could not, and
        every level is described by what it changes for the people using it.
      </p>

      {/* The rail cannot fit five years on a phone, so it scrolls and says so with a fade. */}
      <div className="relative mt-10">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <RailHero years={HORIZON.map((h) => h.year)} current={CURRENT_YEAR} />
          </div>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[var(--bg)] to-transparent md:hidden"
        />
      </div>

      <section className="mt-14" aria-labelledby="ladder">
        <h2 id="ladder" className="text-2xl font-bold">
          The ladder
        </h2>
        <p className="muted mt-2 max-w-3xl">
          Five levels, in order, because each one rests on the one below. Find where your team
          stands today and the next rung is the one worth arguing for.
        </p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {LEVELS.map(([n, name, line]) => (
            <li
              key={n}
              className={`card p-4 ${n === 1 ? 'ring-2 ring-[var(--brand)]' : ''}`}
              aria-current={n === 1 ? 'step' : undefined}
            >
              <p className="text-2xl font-black tabular-nums text-[var(--brand)]">{n}</p>
              <p className="mt-1 font-semibold">{name}</p>
              <p className="muted mt-1 text-sm">{line}</p>
              {n === 1 && (
                <p className="mt-3 text-xs font-semibold text-[var(--brand)]">Available today</p>
              )}
            </li>
          ))}
        </ol>
      </section>

      {HORIZON.map((h, i) => {
        const Art = YEAR_ART[h.year];
        const flip = i % 2 === 1;
        return (
          <section
            key={h.year}
            className="mt-16 scroll-mt-24 border-t border-[var(--line)] pt-12"
            id={`y${h.year}`}
            aria-labelledby={`h${h.year}`}
          >
            <div className="grid items-center gap-8 md:grid-cols-2">
              <div className={flip ? 'md:order-2' : undefined}>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 id={`h${h.year}`} className="text-3xl font-extrabold tabular-nums">
                    {h.year}
                  </h2>
                  <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-semibold">
                    Level {h.level} · {h.name}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[h.state]}`}
                  >
                    {STATUS_WORD[h.state]}
                  </span>
                </div>

                <p className="mt-5 text-xl font-semibold leading-snug">{h.value}</p>
                <p className="muted mt-3">{h.because}</p>

                <h3 className="mt-7 text-sm font-bold">What ships</h3>
                <ul className="mt-3 space-y-2">
                  {h.features.map((f) => (
                    <li key={f} className="flex gap-3 text-sm">
                      <span
                        aria-hidden
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <p className="mt-6 border-l-2 border-[var(--brand-2)] pl-4 text-sm">
                  <span className="font-bold">Milestone. </span>
                  <span className="muted">{h.milestone}</span>
                </p>
              </div>

              <figure className={flip ? 'md:order-1' : undefined}>
                <Art />
              </figure>
            </div>

            {h.year === CURRENT_YEAR && (
              <div className="mt-10 grid gap-4 md:grid-cols-2">
                <figure className="card overflow-hidden">
                  <img
                    src="/screenshots/ui/dashboard.png"
                    alt="The SDODS dashboard listing recent runs with their pass rate and duration"
                    loading="lazy"
                    width={1280}
                    height={800}
                    className="w-full"
                  />
                  <figcaption className="muted border-t border-[var(--line)] p-3 text-sm">
                    The run dashboard, today. Not a mockup.
                  </figcaption>
                </figure>
                <figure className="card overflow-hidden">
                  <img
                    src="/screenshots/ui/run-detail.png"
                    alt="A run opened to its scenarios, grouped by module, with status, browser, tags and a linked issue"
                    loading="lazy"
                    width={1280}
                    height={800}
                    className="w-full"
                  />
                  <figcaption className="muted border-t border-[var(--line)] p-3 text-sm">
                    One run, every scenario, grouped by the capability it covers.
                  </figcaption>
                </figure>
              </div>
            )}
          </section>
        );
      })}

      <section className="mt-16 border-t border-[var(--line)] pt-12" aria-labelledby="value">
        <h2 id="value" className="text-2xl font-bold">
          Value at a glance
        </h2>
        <p className="muted mt-2 max-w-3xl">
          The same five years, if you would rather read them as a table than scroll them.
        </p>
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="text-left">
              <tr className="border-b border-[var(--line)]">
                <th className="p-3">Year</th>
                <th className="p-3">Level</th>
                <th className="p-3">What you get</th>
                <th className="p-3">Proof it landed</th>
              </tr>
            </thead>
            <tbody>
              {HORIZON.map((h) => (
                <tr key={h.year} className="border-b border-[var(--line)] last:border-0 align-top">
                  <td className="p-3 font-bold tabular-nums">
                    <a href={`#y${h.year}`} className="hover:underline">
                      {h.year}
                    </a>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {h.level} · {h.name}
                  </td>
                  <td className="p-3">{h.value}</td>
                  <td className="muted p-3">{h.milestone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted mt-4 max-w-3xl text-sm">
          2026 is shipped and verifiable today. 2027 is being built. The years after that are the
          direction we are steering, not a dated commitment, and feature requests move them.
        </p>
      </section>

      <section className="mt-16 border-t border-[var(--line)] pt-12" aria-labelledby="delivered">
        <h2 id="delivered" className="text-2xl font-bold">
          How level 1 was built
        </h2>
        <p className="muted mt-2 max-w-3xl">
          Fourteen phases, each ending runnable and verified. The same table appears in the
          repository and the documentation.
        </p>
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-[var(--line)]">
                <th className="p-3">Phase</th>
                <th className="p-3">Scope</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {ROADMAP.map((r) => (
                <tr key={r.phase} className="border-b border-[var(--line)] last:border-0">
                  <td className="p-3 font-mono">{r.phase}</td>
                  <td className="p-3">{r.scope}</td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE.delivered}`}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mt-10 text-lg font-bold">Verified on the demo project</h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {VERIFICATION.map((row) => (
            <li key={row.label} className="card flex justify-between gap-4 px-4 py-3 text-sm">
              <span className="muted">{row.label}</span>
              <span className="font-semibold">{row.result}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16 border-t border-[var(--line)] pt-12" aria-labelledby="next">
        <h2 id="next" className="text-2xl font-bold">
          Next up
        </h2>
        <p className="muted mt-2 max-w-3xl">
          The nearest items, in the order they are likely to land. This list is shaped by what
          people ask for.
        </p>
        <ul className="muted mt-4 list-disc space-y-1 pl-5 text-sm">
          {NEXT_UP.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/feedback/" className="btn btn-primary">
            Request a feature
          </Link>
          <a href={`${DOCS_URL}/docs/roadmap/`} className="btn btn-secondary">
            Roadmap in the docs
          </a>
          {REPO_PUBLIC && (
            <a
              href={`${REPO_URL}/issues?q=is%3Aissue+label%3Aenhancement`}
              className="btn btn-secondary"
              rel="noreferrer"
            >
              Open feature requests
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
