import Link from 'next/link';
import { InstallTabs } from '@/components/install-tabs';
import { DOCS_URL, REPO_URL } from '@/lib/links';

const WHY: Array<[string, string]> = [
  [
    'UI, API and mixed scenarios in one language',
    'Gherkin with one merged fixture set, so a scenario can seed through the API and assert in the browser.',
  ],
  [
    'Many apps, many environments',
    'One YAML per project plus one per environment; strict, explainable configuration precedence; secrets only through ${VAR}.',
  ],
  [
    'Reusable data',
    'CSV, JSON, YAML, database tables and faker factories per environment, plus user pools leased per worker with login-state reuse.',
  ],
  [
    'Confidence across browsers',
    'Chromium, Firefox, WebKit and mobile emulation; --project-matrix runs every browser you declared, @skip:<browser> is validated by lint.',
  ],
  [
    'Readable results',
    'Before/after screenshots per step by suite tag, API request/response snapshots, and a run viewer with slider, overlay and pixel diff.',
  ],
  [
    'Institutional memory',
    'Cucumber NDJSON ingested into SQLite or Postgres: flakiness, locator fragility, environment stability and suite health over time.',
  ],
];

const FEATURES: Array<[string, string]> = [
  [
    'BDD for UI, API and hybrid',
    'Reusable step library, page objects with decorators, module and process taxonomy.',
  ],
  [
    'Data and user pools',
    'Per-environment datasets, factories, leased accounts, cached storage state.',
  ],
  [
    'Self-healing locators',
    'Scored candidate probes, persisted heal history, proposals to fix page objects.',
  ],
  ['Before/after narratives', 'Screenshot policy by suite tag; visual baselines; API snapshots.'],
  ['SQLite or Postgres', 'One schema, runtime toggle, verified switch in both directions.'],
  [
    'MCP server and agents',
    '37 tools for Claude Code, Codex, Cursor and VS Code; planner, generator, healer, upgrader.',
  ],
  [
    'GitHub and Jira',
    'Check runs, PR comments, deduplicated issues, @jira:KEY links, transitions.',
  ],
  [
    'Schedules',
    'Cron recipes with overlap policy; runs from the server, crontab, launchd, systemd or Actions.',
  ],
  [
    'Web UI with roles',
    'Organizations, workspaces, projects, modules; run viewer, Gherkin editor, tokens.',
  ],
];

function Flow() {
  const nodes = [
    'sdods CLI',
    'Config + registry',
    'Browser runs',
    'NDJSON + screenshots',
    'SQLite / Postgres',
    'Web UI · MCP · agents',
  ];
  return (
    <ol
      className="flex flex-wrap items-center justify-center gap-2 text-sm"
      aria-label="How SDODS works"
    >
      {nodes.map((n, i) => (
        <li key={n} className="flex items-center gap-2">
          <span className="flow-node">{n}</span>
          {i < nodes.length - 1 && (
            <span className="flow-arrow" aria-hidden="true">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-16 text-center md:pt-24">
        <p className="mb-4 inline-block rounded-full border border-[var(--line)] px-3 py-1 text-xs muted">
          Open source · Apache-2.0 · API tokens are free
        </p>
        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold tracking-tight md:text-6xl">
          <span className="brand-gradient">SDODS</span> — an automation platform with a reusable
          architecture
        </h1>
        <p className="muted mx-auto mt-6 max-w-2xl text-lg">
          BDD for UI, API and hybrid flows. Multi-project, multi-environment, data-driven and
          self-healing, with before/after screenshot narratives, a database-backed history, an MCP
          server, AI agents, GitHub and Jira integration and a web UI.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/install/" className="btn btn-primary">
            Install SDODS
          </Link>
          <a href={DOCS_URL} className="btn btn-secondary">
            Read the docs
          </a>
          <a href={REPO_URL} className="btn btn-secondary" rel="noreferrer">
            View on GitHub
          </a>
        </div>

        <div className="card mx-auto mt-10 max-w-3xl p-5 text-left">
          <p className="muted mb-3 text-sm">Install in one line, on any operating system:</p>
          <InstallTabs compact />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="why">
        <h2 id="why" className="text-2xl font-bold">
          Why SDODS
        </h2>
        <p className="muted mt-2 max-w-3xl">
          Every team rebuilds the same scaffolding around their test runner: environment switching,
          tagging policy, test data, login reuse, reporting, flaky triage, CI wiring, and now AI
          helpers. SDODS ships those once, with opinions.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {WHY.map(([title, body]) => (
            <article key={title} className="card p-5">
              <h3 className="font-semibold">{title}</h3>
              <p className="muted mt-2 text-sm">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="how">
        <h2 id="how" className="text-2xl font-bold">
          How it works
        </h2>
        <p className="muted mt-2 max-w-3xl">
          Everything is CLI-first. The web UI, the MCP server and the scheduler spawn the same
          commands and stream their output, so CI needs nothing but Node and the repository.
        </p>
        <div className="card mt-8 p-6">
          <Flow />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="see">
        <h2 id="see" className="text-2xl font-bold">
          See every step
        </h2>
        <p className="muted mt-2 max-w-3xl">
          Regression scenarios capture a screenshot before and after every UI step. The run viewer
          pairs them with a slider, an overlay and a pixel diff. These are real captures from the
          demo project.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <figure className="card overflow-hidden">
            <img
              src="/screenshots/step-02-before.png"
              alt="SauceDemo login form filled in, before the login button is clicked"
              loading="lazy"
            />
            <figcaption className="muted p-3 text-sm">
              Before: login form, credentials filled
            </figcaption>
          </figure>
          <figure className="card overflow-hidden">
            <img
              src="/screenshots/step-02-after.png"
              alt="SauceDemo inventory page after the login step"
              loading="lazy"
            />
            <figcaption className="muted p-3 text-sm">After: inventory page, logged in</figcaption>
          </figure>
        </div>
        <figure className="card mt-4 overflow-hidden">
          <img
            src="/screenshots/ui/scenario-steps.png"
            alt="SDODS run viewer showing the step timeline with a before/after comparison"
            loading="lazy"
          />
          <figcaption className="muted p-3 text-sm">
            Run viewer: step timeline with before/after comparison and API panels
          </figcaption>
        </figure>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="features">
        <h2 id="features" className="text-2xl font-bold">
          What ships in the box
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([title, body]) => (
            <article key={title} className="card p-5">
              <h3 className="font-semibold">{title}</h3>
              <p className="muted mt-2 text-sm">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="quickstart">
        <h2 id="quickstart" className="text-2xl font-bold">
          Quickstart
        </h2>
        <pre className="mt-6">
          <code>{`curl -fsSL https://sdods.com/install.sh | sh   # or on Windows: irm .../install.ps1 | iex

cd ~/.sdods/app
sdods run -p demo-shop -e staging -l api
sdods run -p demo-shop -e staging -l ui -b chromium -t @smoke`}</code>
        </pre>
        <p className="muted mt-3 text-sm">
          Only Node 22 is required. Options, upgrade and uninstall are on the{' '}
          <Link href="/install/" className="underline">
            install page
          </Link>{' '}
          and in the{' '}
          <a href={`${DOCS_URL}/docs/getting-started/installation/`} className="underline">
            installation guide
          </a>
          .
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="clients">
        <div className="card flex flex-col items-start justify-between gap-4 p-6 md:flex-row md:items-center">
          <div>
            <h2 id="clients" className="text-xl font-bold">
              Works with Claude Code and Codex
            </h2>
            <p className="muted mt-1 text-sm">
              SDODS is an MCP server: <code>sdods mcp install claude</code> or{' '}
              <code>sdods mcp install codex</code>, then ask your assistant to run, analyze or heal
              tests. Agents can reuse your logged-in CLI session, so no API key is required.
            </p>
          </div>
          <a href={`${DOCS_URL}/docs/guides/mcp/`} className="btn btn-secondary whitespace-nowrap">
            MCP guide
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 pt-8" aria-labelledby="feedback">
        <div className="card p-6 text-center">
          <h2 id="feedback" className="text-xl font-bold">
            Want a feature? Tell us.
          </h2>
          <p className="muted mt-1 text-sm">
            Feature requests and feedback go straight to the maintainers as GitHub issues and
            discussions. No account with us, no tracking.
          </p>
          <Link href="/feedback/" className="btn btn-primary mt-4">
            Send feedback
          </Link>
        </div>
      </section>
    </>
  );
}
