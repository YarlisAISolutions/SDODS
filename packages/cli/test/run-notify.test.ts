import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { enabledIntegrations, maybeNotify } from '../src/notify.js';
import { register, type RunFlags } from '../src/commands/run.js';

/**
 * `integrations.github.createIssueOnFailure` did nothing on its own: `sdods run` never called the
 * integrations layer, so issues and check runs only appeared when a separate
 * `sdods integrations notify --run-id <id>` step existed (issue #81).
 */
const github = (enabled: boolean) =>
  ({
    enabled,
    checkRun: true,
    prComment: true,
    createIssueOnFailure: 'smoke',
    closeOnPass: false,
    labels: ['sdods'],
    tokenEnv: 'GITHUB_TOKEN',
  }) as const;

const base = {
  integrations: { github: github(true), custom: [] },
  totals: { total: 3 },
  exitCode: 1,
};

describe('sdods run → integrations notify', () => {
  it('lists enabled integrations only', () => {
    expect(enabledIntegrations({ custom: [] })).toEqual([]);
    expect(enabledIntegrations({ github: github(false), custom: [] })).toEqual([]);
    expect(enabledIntegrations({ github: github(true), custom: [] })).toEqual(['github']);
    expect(enabledIntegrations({ custom: [{ module: './p.mjs' }] })).toEqual(['./p.mjs']);
  });

  it('runs notify after a run when an integration is enabled', async () => {
    const notify = vi.fn(async () => ({
      actions: [{ provider: 'github', kind: 'issue-created', target: 'acme/shop#1' }],
    }));
    const warn = vi.fn();
    const res = await maybeNotify({ ...base, flags: {}, notify, warn });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(res).toEqual({
      ran: true,
      actions: [{ provider: 'github', kind: 'issue-created', target: 'acme/shop#1' }],
      errors: [],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not notify with --no-notify, without an enabled integration, or when nothing ran', async () => {
    const notify = vi.fn(async () => ({ actions: [] }));
    const warn = vi.fn();
    expect(await maybeNotify({ ...base, flags: { notify: false }, notify, warn })).toEqual({
      ran: false,
      reason: 'disabled by --no-notify',
    });
    expect(
      await maybeNotify({
        ...base,
        integrations: { github: github(false), custom: [] },
        flags: {},
        notify,
        warn,
      }),
    ).toEqual({ ran: false, reason: 'no integration enabled' });
    expect(
      (await maybeNotify({ ...base, totals: { total: 0 }, flags: {}, notify, warn })).ran,
    ).toBe(false);
    expect((await maybeNotify({ ...base, exitCode: 130, flags: {}, notify, warn })).ran).toBe(
      false,
    );
    expect((await maybeNotify({ ...base, shardTotal: 3, flags: {}, notify, warn })).ran).toBe(
      false,
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('reports notify failures without throwing', async () => {
    const warn = vi.fn();
    const thrown = await maybeNotify({
      ...base,
      flags: {},
      notify: async () => {
        throw new Error('Bad credentials');
      },
      warn,
    });
    expect(thrown).toEqual({ ran: true, actions: [], errors: ['Bad credentials'] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Bad credentials'));

    warn.mockClear();
    const partial = await maybeNotify({
      ...base,
      flags: {},
      notify: async () => ({
        actions: [{ provider: 'jira', kind: 'error', detail: '401 Unauthorized' }],
      }),
      warn,
    });
    expect(partial.ran && partial.errors).toEqual(['jira: 401 Unauthorized']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('jira: 401 Unauthorized'));
  });

  it('parses --no-notify on run and test', async () => {
    const program = new Command().exitOverride();
    register(program);
    const seen: Record<string, RunFlags> = {};
    for (const name of ['run', 'test']) {
      program.commands
        .find((c) => c.name() === name)!
        .action((flags: RunFlags) => {
          seen[name] = flags;
        });
    }
    await program.parseAsync(['node', 'sdods', 'run', '-p', 'x']);
    expect(seen.run!.notify).toBe(true);
    await program.parseAsync(['node', 'sdods', 'test', '-p', 'x', '--no-notify']);
    expect(seen.test!.notify).toBe(false);
  });
});
