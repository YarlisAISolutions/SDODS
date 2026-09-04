import type { Metadata } from 'next';
import { InstallTabs } from '@/components/install-tabs';
import { DOCS_URL, REPO_PUBLIC, REPO_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Install SDODS',
  description:
    'One command installs SDODS on macOS, Linux or Windows: Node check, dependencies, browser engines and the sdods command.',
};

const STEPS: Array<[string, string]> = [
  [
    'Checks Node',
    'Needs Node 22+. Prints the exact fix for your platform, or installs it with --install-node.',
  ],
  [
    'Installs Bun',
    'Only if you do not have it, and only inside ~/.sdods — your system stays untouched.',
  ],
  [
    'Fetches SDODS',
    'A shallow clone into ~/.sdods/app, switching to npm automatically once packages are published.',
  ],
  [
    'Installs browsers',
    'Chromium by default; --browsers all adds Firefox and WebKit, --browsers none skips them.',
  ],
  [
    'Writes the command',
    'An sdods shim in ~/.local/bin. Your shell profile changes only with --modify-path.',
  ],
  ['Verifies', 'Runs sdods doctor and prints the commands to try next.'],
];

const AFTER: Array<[string, string]> = [
  ['Run the demo suite', 'cd ~/.sdods/app && sdods run -p demo-shop -e staging -l api'],
  ['Try the UI layer', 'sdods run -p demo-shop -e staging -l ui -b chromium -t @smoke'],
  ['See the results', 'sdods report --last --open'],
  ['Open the web UI', 'sdods serve'],
  ['Start from your app', 'sdods analyze /path/to/your-app --apply'],
  ['Use it from your AI CLI', 'sdods mcp install claude   # or: codex'],
];

export default function InstallPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-4xl font-extrabold tracking-tight">Install SDODS</h1>
      <p className="muted mt-4 text-lg">
        One command on any operating system. It installs into <code>~/.sdods</code>, adds an{' '}
        <code>sdods</code> command, and tells you what to run next.
      </p>

      <div className="card mt-8 p-6">
        <InstallTabs />
      </div>

      <p className="muted mt-4 text-sm">
        Prefer to read it first?{' '}
        <a className="underline" href="https://sdods.com/install.sh">
          install.sh
        </a>{' '}
        ·{' '}
        <a className="underline" href="https://sdods.com/install.ps1">
          install.ps1
        </a>{' '}
        · checksums at{' '}
        <a className="underline" href="https://sdods.com/install.sh.sha256">
          install.sh.sha256
        </a>
        .
        {REPO_PUBLIC && (
          <>
            {' '}
            Both scripts live in{' '}
            <a className="underline" href={`${REPO_URL}/tree/main/installer`} rel="noreferrer">
              the repository
            </a>
            .
          </>
        )}
      </p>

      <section className="mt-14" aria-labelledby="what">
        <h2 id="what" className="text-2xl font-bold">
          What the installer does
        </h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-2">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="card p-5">
              <h3 className="font-semibold">
                <span className="muted mr-2">{i + 1}.</span>
                {title}
              </h3>
              <p className="muted mt-2 text-sm">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14" aria-labelledby="after">
        <h2 id="after" className="text-2xl font-bold">
          After it finishes
        </h2>
        <dl className="mt-6 grid gap-4">
          {AFTER.map(([title, cmd]) => (
            <div key={title} className="card p-5">
              <dt className="font-semibold">{title}</dt>
              <dd className="mt-2">
                <pre className="overflow-x-auto">
                  <code>{cmd}</code>
                </pre>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-14" aria-labelledby="options">
        <h2 id="options" className="text-2xl font-bold">
          Common options
        </h2>
        <pre className="mt-6 overflow-x-auto">
          <code>{`# scaffold a workspace and wire up Claude Code in one go
curl -fsSL https://sdods.com/install.sh | sh -s -- --workspace ~/my-tests --mcp claude

# every browser, and put sdods on PATH permanently
curl -fsSL https://sdods.com/install.sh | sh -s -- --browsers all --modify-path

# pin a release, install somewhere else
curl -fsSL https://sdods.com/install.sh | sh -s -- --version v0.2.0 --dir /opt/sdods

# see what it would do, or remove it
curl -fsSL https://sdods.com/install.sh | sh -s -- --dry-run
curl -fsSL https://sdods.com/install.sh | sh -s -- --uninstall --yes`}</code>
        </pre>
        <p className="muted mt-3 text-sm">
          Every flag has an environment-variable twin for Docker and CI. The full table is in the{' '}
          <a className="underline" href={`${DOCS_URL}/docs/reference/installer/`}>
            installer reference
          </a>
          .
        </p>
      </section>

      <section className="mt-14" aria-labelledby="requirements">
        <h2 id="requirements" className="text-2xl font-bold">
          Requirements
        </h2>
        <p className="muted mt-2">
          Node.js 22 or newer, and about 2 GB of disk for the checkout, its dependencies and one
          browser. Git is used for the source install. Everything else the installer handles, and
          nothing is required to run tests: SDODS needs no account and no API key.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a className="btn btn-primary" href={`${DOCS_URL}/docs/getting-started/installation/`}>
            Installation guide
          </a>
          <a
            className="btn btn-secondary"
            href={`${DOCS_URL}/docs/getting-started/first-api-test/`}
          >
            Your first test
          </a>
        </div>
      </section>
    </div>
  );
}
