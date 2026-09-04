import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProposalStore } from '@sdods/mcp';
import { FakeAdapter } from '../src/adapter/fake.js';
import { JobJournal, prepareJob, runJob } from '../src/jobs/runner.js';
import { installClaudeCode } from '../src/claude-code/install.js';

/** A minimal repo copy: workspace file + one project with a feature dir. */
function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'sdods-job-'));
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(
    join(root, 'sdods.workspace.yaml'),
    'organization: { slug: acme, name: Acme }\nworkspaces: [{ slug: default, name: Default }]\ndefaultWorkspace: default\n',
  );
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'features', 'auth'), { recursive: true });
  mkdirSync(join(proj, 'envs'), { recursive: true });
  writeFileSync(
    join(proj, 'sdods.project.yaml'),
    'slug: shop\nname: Shop\nlayers: [ui, api]\nenvs: { default: local, available: [local] }\nagents: { provider: fake, budgetUsd: { default: 1, generator: 2 }, maxTurns: { generator: 9 } }\n',
  );
  writeFileSync(
    join(proj, 'envs', 'local.yaml'),
    'ui: { baseUrl: http://localhost:3000 }\napi: { baseUrl: http://localhost:3000/api }\n',
  );
  return root;
}

const FEATURE =
  '@ui @smoke @auth\nFeature: Login\n  Scenario: ok\n    Given I am on the login page\n';

describe('agent jobs', () => {
  it('prepareJob resolves budgets from the project yaml and filters tools per role', async () => {
    const root = tempRepo();
    const prep = await prepareJob({
      role: 'generator',
      input: { project: 'shop', goal: 'login' },
      rootDir: root,
      dryRun: true,
    });
    expect(prep.job.provider).toBe('fake');
    expect(prep.job.budgetUsd).toBe(2);
    expect(prep.job.maxTurns).toBe(9);
    const names = prep.tools.map((t) => t.name);
    expect(names).toContain('feature_write');
    expect(names).toContain('run_tests');
    expect(names).not.toContain('proposal_accept');
    expect(prep.system).toContain('SDODS GENERATOR');
    expect(prep.prompt).toContain('Goal: login');
    const rev = await prepareJob({
      role: 'reviewer',
      input: { project: 'shop' },
      rootDir: root,
      dryRun: true,
    });
    expect(rev.tools.map((t) => t.name)).not.toContain('run_tests');
    expect(rev.job.budgetUsd).toBe(1);
  });

  it('runs end to end with the fake adapter: generate → proposal → accept → files present', async () => {
    const root = tempRepo();
    const adapter = new FakeAdapter({
      script: [
        { text: 'Writing login feature. ' },
        { toolCall: { name: 'feature_parse', input: { text: FEATURE, project: 'shop' } } },
        {
          toolCall: {
            name: 'feature_write',
            input: {
              project: 'shop',
              path: 'auth/login.feature',
              text: FEATURE,
              summary: 'login smoke',
              extraFiles: [{ path: 'steps/auth.steps.ts', content: '// steps\n' }],
            },
          },
        },
        { text: 'Proposal created.' },
      ],
    });
    const job = await runJob({
      role: 'generator',
      input: { project: 'shop', goal: 'login' },
      rootDir: root,
      adapter,
      keepEvents: true,
    });
    expect(job.status).toBe('awaiting_review');
    expect(job.proposalIds).toHaveLength(1);
    expect(job.toolCalls).toBe(2);
    expect(job.resultText).toContain('Proposal created.');
    expect(new JobJournal(root).get(job.id)?.status).toBe('awaiting_review');

    const store = new ProposalStore(root);
    const m = store.get(job.proposalIds[0]!)!;
    expect(m.files.map((f) => f.path)).toEqual([
      'projects/shop/features/auth/login.feature',
      'projects/shop/steps/auth.steps.ts',
    ]);
    expect(existsSync(join(root, 'projects/shop/features/auth/login.feature'))).toBe(false);

    const target = mkdtempSync(join(tmpdir(), 'sdods-apply-'));
    cpSync(root, target, { recursive: true });
    new ProposalStore(target).accept(m.id, { reviewedBy: 'test' });
    expect(readFileSync(join(target, 'projects/shop/features/auth/login.feature'), 'utf8')).toBe(
      FEATURE,
    );
    expect(readFileSync(join(target, 'projects/shop/steps/auth.steps.ts'), 'utf8')).toBe(
      '// steps\n',
    );
  }, 60_000);

  it('rejects tag-policy violations through feature_write and reports a completed job without proposals', async () => {
    const root = tempRepo();
    const adapter = new FakeAdapter({
      script: [
        {
          toolCall: {
            name: 'feature_write',
            input: {
              project: 'shop',
              path: 'x.feature',
              text: 'Feature: untagged\n  Scenario: s\n    Given g\n',
            },
          },
        },
      ],
    });
    const job = await runJob({
      role: 'generator',
      input: { project: 'shop' },
      rootDir: root,
      adapter,
    });
    expect(job.status).toBe('completed');
    expect(job.proposalIds).toEqual([]);
    const out = adapter.calls[0]!.output as {
      isError?: boolean;
      content: Array<{ text?: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain('Tag policy');
  });

  it('installs Claude Code agents, .mcp.json, AGENT.md and SKILL.md', () => {
    const root = tempRepo();
    const written = installClaudeCode(root, { project: 'shop' });
    expect(written.some((w) => w.endsWith('.claude/agents/sdods-healer.md'))).toBe(true);
    const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(mcp.mcpServers.sdods!.args).toEqual(['sdods', 'mcp', '--project', 'shop']);
    expect(mcp.mcpServers.playwright).toBeDefined();
    expect(readFileSync(join(root, 'AGENT.md'), 'utf8')).toContain(
      'automation and orchestration platform with a reusable architecture',
    );
    expect(readFileSync(join(root, 'SKILL.md'), 'utf8')).toContain('name: sdods');
    expect(installClaudeCode(root, { project: 'shop' })).toEqual([join(root, '.mcp.json')]); // idempotent except the merged config
  });
});
