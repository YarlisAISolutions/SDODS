import { withBase } from '@/lib/base-path';
import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

const features: Array<{ title: string; body: string; href: string }> = [
  {
    title: 'One language for UI, API and hybrid',
    body: 'Gherkin on playwright-bdd with a single merged fixture set: seed through the API, assert in the browser.',
    href: '/docs/getting-started/hybrid-scenario',
  },
  {
    title: 'Projects and environments',
    body: 'A YAML file per project, a YAML file per environment, six-layer precedence you can explain with one command.',
    href: '/docs/guides/configuration',
  },
  {
    title: 'Data and user pools',
    body: 'CSV, JSON, YAML, database tables and factories per environment. Users leased per worker with login reuse.',
    href: '/docs/guides/test-data-and-user-pools',
  },
  {
    title: 'Screenshot narratives',
    body: 'Before and after every UI step for regression suites, start and end for smoke, pixel baselines for visual.',
    href: '/docs/guides/screenshots-and-visual',
  },
  {
    title: 'SQLite or Postgres',
    body: 'Run history, flakiness and locator fragility in a database you switch with one command.',
    href: '/docs/guides/database',
  },
  {
    title: 'MCP and agents',
    body: 'SDODS is an MCP server; agents plan, generate, heal and upgrade tests but only write proposals.',
    href: '/docs/guides/mcp',
  },
];

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex max-w-5xl flex-col items-center px-4 py-16 text-center">
        <img src={withBase('/img/sdods-logo.svg')} alt="SDODS" className="w-full max-w-lg" />
        <p className="mt-6 max-w-2xl text-lg text-fd-muted-foreground">
          An automation platform with a reusable architecture. BDD for UI, API and hybrid flows,
          multi-project and multi-environment, data-driven, self-healing, with a web UI, an MCP
          server and AI agents.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/docs"
            className="rounded-md bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground"
          >
            Get started
          </Link>
          <Link
            href="/docs/reference/cli"
            className="rounded-md border border-fd-border px-5 py-2.5 font-medium"
          >
            CLI reference
          </Link>
        </div>
        <pre className="mt-8 w-full max-w-2xl overflow-x-auto rounded-lg border border-fd-border bg-fd-card p-4 text-left text-sm">
          {`git clone https://github.com/siri1410/SDODS.git && cd SDODS
bun install && npx playwright install --with-deps
bun run sdods run -p demo-shop -e staging -l api`}
        </pre>
        <section className="mt-12 grid w-full grid-cols-1 gap-4 text-left md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Link
              key={f.title}
              href={f.href}
              className="rounded-lg border border-fd-border p-4 transition hover:bg-fd-accent"
            >
              <h3 className="mb-2 font-semibold">{f.title}</h3>
              <p className="text-sm text-fd-muted-foreground">{f.body}</p>
            </Link>
          ))}
        </section>
        <p className="mt-12 text-sm text-fd-muted-foreground">
          Created by{' '}
          <a className="underline" href="https://www.linkedin.com/in/yarlagadda/">
            Sireesh Yarlagadda
          </a>{' '}
          · Apache-2.0
        </p>
      </main>
    </HomeLayout>
  );
}
