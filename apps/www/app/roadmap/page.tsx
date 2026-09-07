import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CURRENT_YEAR,
  ERAS,
  HISTORY,
  HISTORY_FROM,
  HORIZON,
  LEVELS,
  NEXT_UP,
  ROADMAP,
  VERIFICATION,
  yearsOfEra,
  type CheckpointState,
} from '@sdods/roadmap';
import { ERA_ART, JourneyRail, MaxiSays, YEAR_ART, type MaxiMood } from '@/components/roadmap-art';
import { DOCS_URL, REPO_PUBLIC, REPO_URL } from '@/lib/links';

const LAST_YEAR = HORIZON[HORIZON.length - 1]!.year;

export const metadata: Metadata = {
  title: 'Roadmap',
  description: `SDODS from ${HISTORY_FROM} to ${LAST_YEAR}: the years of test automation that shaped it, what ships today, and the customer value each year ahead buys.`,
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

/** Maxi is pleased about what shipped, chatty about the present and thoughtful about direction. */
const MOOD: Record<CheckpointState, MaxiMood> = {
  delivered: 'happy',
  now: 'talking',
  planned: 'idle',
  direction: 'thinking',
};

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight md:text-5xl">
        {HISTORY.length} years of lessons, {HORIZON.length} years of{' '}
        <span className="brand-gradient">ladder</span>
      </h1>
      <p className="muted mt-4 max-w-2xl text-lg">
        SDODS did not begin in {CURRENT_YEAR}. It begins in {HISTORY_FROM}, with a suite that only
        ran on one machine. Every year since left something behind, and the five ahead are what
        those lessons add up to: one ladder, where each year buys a level of confidence the year
        before could not.
      </p>

      {/* Two rows on a phone, one continuous road above that: the component picks. */}
      <div className="mt-8 md:mt-10">
        <JourneyRail
          past={HISTORY.map((h) => ({ year: h.year, era: h.era }))}
          eras={ERAS}
          years={HORIZON.map((h) => h.year)}
          current={CURRENT_YEAR}
        />
      </div>

      <section className="mt-16 border-t border-[var(--line)] pt-12" aria-labelledby="road-here">
        <h2 id="road-here" className="text-2xl font-bold">
          The road here · {HISTORY_FROM}–{HISTORY[HISTORY.length - 1]!.year}
        </h2>
        <p className="muted mt-2 max-w-3xl">
          Nothing was released in these years, so this is lineage rather than a changelog. Each one
          records two things you can check for yourself: what the tooling actually did that year,
          dated against its public releases, and the design decision it left behind that you can
          point at in the product today.
        </p>

        {ERAS.map((era) => {
          const Art = ERA_ART[era.order]!;
          return (
            <div key={era.id} id={era.id} className="mt-12 scroll-mt-24">
              <div className="grid items-center gap-8 md:grid-cols-[1fr_320px]">
                <div>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h3 className="text-xl font-bold">{era.name}</h3>
                    <span className="muted text-sm font-semibold tabular-nums">
                      {era.from}–{era.to}
                    </span>
                  </div>
                  <p className="mt-2 text-lg font-semibold leading-snug">{era.tagline}</p>
                  <MaxiSays mood="thinking" className="mt-5 max-w-2xl">
                    {era.maxi}
                  </MaxiSays>
                </div>
                {/* On a phone the scene stacks under Maxi rather than disappearing: it is the
                    character the section is carried by, not decoration. */}
                <figure className="mx-auto w-full max-w-[320px] md:mx-0 md:max-w-none">
                  <Art />
                </figure>
              </div>

              <ol className="mt-6 grid gap-3 md:grid-cols-2">
                {yearsOfEra(era).map((year) => (
                  <li key={year.year} className="card p-5">
                    <div className="flex flex-wrap items-baseline gap-3">
                      <p className="text-2xl font-black tabular-nums text-[var(--brand)]">
                        {year.year}
                      </p>
                      <span className="rounded-full border border-[var(--line)] px-2.5 py-0.5 text-xs font-semibold">
                        {year.label}
                      </span>
                    </div>
                    <p className="mt-2 font-semibold leading-snug">{year.title}</p>
                    <p className="muted mt-2 text-sm">{year.shift}</p>
                    <p className="mt-4 border-l-2 border-[var(--brand-2)] pl-4 text-sm">
                      <span className="font-bold">SDODS carries. </span>
                      <span className="muted">{year.carried}</span>
                    </p>
                    <ul className="mt-4 flex flex-wrap gap-1.5">
                      {year.tech.map((t) => (
                        <li
                          key={t}
                          className="muted rounded-md border border-[var(--line)] px-2 py-0.5 text-xs"
                        >
                          {t}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </section>

      <section className="mt-16 border-t border-[var(--line)] pt-12" aria-labelledby="ladder">
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
        const Art = YEAR_ART[h.year]!;
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

            <MaxiSays mood={MOOD[h.state]} className="mt-8 max-w-3xl">
              {h.maxi}
            </MaxiSays>

            {h.year === CURRENT_YEAR && (
              <div className="mt-8 grid gap-4 md:grid-cols-2">
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
        <div
          tabIndex={0}
          role="region"
          aria-label="Value at a glance, scrolls sideways"
          className="card mt-6 overflow-x-auto"
        >
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
          Everything up to {HISTORY[HISTORY.length - 1]!.year} is history, and belongs to the
          industry rather than to us. {HORIZON[0]!.year} is shipped and verifiable today.{' '}
          {HORIZON[1]!.year} is being built. The years after that are the direction we are steering,
          not a dated commitment, and feature requests move them.
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
        <div
          tabIndex={0}
          role="region"
          aria-label="How level 1 was built, scrolls sideways"
          className="card mt-6 overflow-x-auto"
        >
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
            Month by month, in the docs
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
