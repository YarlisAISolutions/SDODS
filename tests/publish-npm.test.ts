import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * scripts/publish-npm.sh against changesets/action v2's reader. v2 creates the GitHub releases and
 * tags, and sets the `published` output the GHCR image job gates on, from $CHANGESETS_OUTPUT and
 * nothing else. A script that publishes but writes no file (or a file of the wrong shape) looks,
 * to the action, like a release where nothing happened.
 *
 * The script runs for real, from a copy in a temp checkout, with `bun` and `npm` stubbed on PATH:
 * the build and staging steps become fixtures, `npm view` answers from a list, and `npm publish`
 * only logs. Nothing reaches a registry or this repository's tags.
 */

const repoRoot = join(import.meta.dirname, '..');
const PKGS = ['contracts', 'core', 'db', 'mcp', 'integrations', 'agents', 'server', 'cli'];

const workspace = new Map(
  PKGS.map((p) => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'packages', p, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
    };
    return [pkg.name, pkg.version] as const;
  }),
);

// ── The reader, copied from changesets/action v2.1.2 src/run.ts ─────────────────────────────────
// `readChangesetsOutput` and `isChangesetsOutputEvent`, trimmed of their error classes. A line that
// fails JSON.parse throws; a parsed line of the wrong shape is skipped silently -- which is the
// failure worth testing for, because it publishes and reports nothing.

type ChangesetsOutputEvent = { type: 'git-tag'; tag: string; packageName: string };

function isChangesetsOutputEvent(value: unknown): value is ChangesetsOutputEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'git-tag' &&
    'tag' in value &&
    typeof value.tag === 'string' &&
    'packageName' in value &&
    typeof value.packageName === 'string'
  );
}

function readChangesetsOutput(rawOutput: string): ChangesetsOutputEvent[] {
  const events: ChangesetsOutputEvent[] = [];
  for (const line of rawOutput.split('\n')) {
    if (/^\s*$/.test(line)) continue;
    const event: unknown = JSON.parse(line);
    if (isChangesetsOutputEvent(event)) events.push(event);
  }
  return events;
}

// ── A throwaway checkout the script can run in ──────────────────────────────────────────────────

function checkout() {
  const root = mkdtempSync(join(tmpdir(), 'sdods-publish-'));
  const bin = join(root, '.bin');
  const fixture = join(root, '.fixture-stage');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(bin);
  copyFileSync(join(repoRoot, 'scripts', 'publish-npm.sh'), join(root, 'scripts', 'publish-npm.sh'));
  // Tested on its own in tests/verify-staged-version.test.ts.
  writeFileSync(join(root, 'scripts', 'verify-staged-version.mjs'), '');

  const past = new Date(Date.now() - 60_000);
  for (const [i, p] of PKGS.entries()) {
    const src = join(root, 'packages', p, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'index.ts'), '');
    utimesSync(join(src, 'index.ts'), past, past);
    mkdirSync(join(fixture, p, 'dist'), { recursive: true });
    const [name, version] = [...workspace][i]!;
    writeFileSync(join(fixture, p, 'package.json'), JSON.stringify({ name, version }));
  }

  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // `bun run publish:stage <dir>` copies the fixture in; every other `bun run` is a no-op build.
  stub(
    'bun',
    `[ "$1 $2" = 'run publish:stage' ] && { mkdir -p "$3"; cp -R "${fixture}/." "$3/"; }\nexit 0`,
  );
  stub(
    'npm',
    `printf '%s\\n' "$*" >> "${join(root, 'npm.log')}"
case "$1" in
  view) case " $NPM_ALREADY_PUBLISHED " in *" $2 "*) echo published; exit 0 ;; esac; exit 1 ;;
  *) exit 0 ;;
esac`,
  );

  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'init');

  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('bash', [join(root, 'scripts', 'publish-npm.sh'), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        NPM_TOKEN: '',
        SDODS_NPM_TOKEN_SECRET: '',
        SDODS_PUBLISH_DRY_RUN: '',
        CHANGESETS_OUTPUT: '',
        ...env,
      },
    });

  const npmCalls = () =>
    existsSync(join(root, 'npm.log')) ? readFileSync(join(root, 'npm.log'), 'utf8') : '';
  const tags = () => git('tag', '--list').stdout.split('\n').filter(Boolean).sort();
  return { root, run, npmCalls, tags, output: join(root, 'runner-temp', 'changesets-output.ndjson') };
}

const everyTag = [...workspace].map(([name, version]) => `${name}@${version}`).sort();

describe('publish-npm.sh → changesets/action v2', () => {
  it('writes one event per published package, in the shape the action reads', () => {
    const c = checkout();
    const r = run(c, ['--dry-run']);
    expect(r.stderr).not.toMatch(/!/);
    expect(r.status).toBe(0);

    const raw = readFileSync(c.output, 'utf8');
    const lines = raw.trimEnd().split('\n');
    const events = readChangesetsOutput(raw);
    // Every line survives the action's filter: none was silently dropped as the wrong shape.
    expect(events).toHaveLength(lines.length);
    expect(events).toHaveLength(PKGS.length);
    for (const e of events) {
      expect(Object.keys(e).sort()).toEqual(['packageName', 'tag', 'type']);
      // The action looks each name up among the workspace packages and throws on a stranger, then
      // reports the workspace version -- so the tag has to be that name at that version.
      expect(workspace.has(e.packageName)).toBe(true);
      expect(e.tag).toBe(`${e.packageName}@${workspace.get(e.packageName)}`);
    }
    expect(events.map((e) => e.tag).sort()).toEqual(everyTag);
  });

  it('keeps the New tag: lines, and a dry run neither publishes nor tags', () => {
    const c = checkout();
    const r = run(c, [], { SDODS_PUBLISH_DRY_RUN: '1' });
    expect(r.status).toBe(0);
    const newTags = r.stdout.match(/^New tag: .+$/gm) ?? [];
    expect(newTags.map((l) => l.slice('New tag: '.length)).sort()).toEqual(everyTag);
    expect(r.stdout).toContain('dry run: would publish 8, skipped 0');
    expect(c.npmCalls()).toContain('view ');
    expect(c.npmCalls()).not.toMatch(/^publish/m);
    expect(c.tags()).toEqual([]);
  });

  it('reports nothing for a version the registry already has', () => {
    const c = checkout();
    const cli = `@sdods/cli@${workspace.get('@sdods/cli')}`;
    const r = run(c, ['--dry-run'], { NPM_ALREADY_PUBLISHED: cli });
    expect(r.status).toBe(0);
    const tags = readChangesetsOutput(readFileSync(c.output, 'utf8')).map((e) => e.tag);
    expect(tags).toHaveLength(PKGS.length - 1);
    expect(tags).not.toContain(cli);
    expect(r.stdout).not.toContain(`New tag: ${cli}`);
  });

  it('writes the same file on a real publish, and tags locally', () => {
    const c = checkout();
    const r = run(c, []);
    expect(r.status).toBe(0);
    expect(c.npmCalls().match(/^publish --access public$/gm)).toHaveLength(PKGS.length);
    const events = readChangesetsOutput(readFileSync(c.output, 'utf8'));
    expect(events.map((e) => e.tag).sort()).toEqual(everyTag);
    expect(c.tags()).toEqual(everyTag);
  });

  it('writes no file when the action did not ask for one', () => {
    const c = checkout();
    const r = c.run(['--dry-run']);
    expect(r.status).toBe(0);
    expect(existsSync(c.output)).toBe(false);
    expect(r.stdout.match(/^New tag: /gm)).toHaveLength(PKGS.length);
  });
});

function run(c: ReturnType<typeof checkout>, args: string[], env: Record<string, string> = {}) {
  return c.run(args, { CHANGESETS_OUTPUT: c.output, ...env });
}
