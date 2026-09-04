import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import pc from 'picocolors';
import { AutomaxError } from '@automax/core';
import { createContext } from '../context.js';
import { collect, json, ok, out, table } from '../ui.js';

const ROLES = ['plan', 'generate', 'heal', 'upgrade', 'review'] as const;
const ROLE_MAP: Record<
  (typeof ROLES)[number],
  'planner' | 'generator' | 'healer' | 'upgrader' | 'reviewer'
> = {
  plan: 'planner',
  generate: 'generator',
  heal: 'healer',
  upgrade: 'upgrader',
  review: 'reviewer',
};

export function register(program: Command) {
  const agent = program
    .command('agent')
    .description(
      'AI agents that plan, generate, heal, upgrade and review tests (they only write proposals)',
    );

  for (const verb of ROLES) {
    agent
      .command(verb)
      .description(
        verb === 'plan'
          ? 'Explore the app or its source and write a tagged test plan'
          : verb === 'generate'
            ? 'Turn a plan, goal or recorded spec into features, steps and page objects'
            : verb === 'heal'
              ? 'Diagnose a failing scenario and propose the smallest fix'
              : verb === 'upgrade'
                ? 'Map a code/API change to affected scenarios and propose updates'
                : 'Review feature files for tagging, reuse and best practices',
      )
      .requiredOption('-p, --project <slug>', 'project slug')
      .option('-e, --env <name>', 'environment')
      .option('--goal <text>', 'what to do')
      .option('--plan <file>', 'plan markdown (generate)')
      .option('--spec <file>', 'recorded spec to convert (generate)')
      .option('--scenario <fingerprint>', 'scenario fingerprint or name (heal)')
      .option('--run-id <id>', 'run id (heal), default last', 'last')
      .option('--diff <range>', 'git range (upgrade), e.g. main..HEAD')
      .option('--files <list>', 'feature files (review)', collect, [])
      .option('--adapter <name>', 'claude | openai | fake')
      .option('--model <id>', 'model override')
      .option('--max-turns <n>', 'turn budget')
      .option('--budget-usd <n>', 'cost budget in USD')
      .option(
        '--dry-run',
        'use the fake adapter and print the prompt, tools and budget without calling an LLM',
      )
      .option('--events', 'print agent events as they arrive')
      .action(async (opts, cmd) => {
        const ctx = createContext(cmd);
        ctx.registry.entry(opts.project);
        const { prepareJob, runJob } = await import('@automax/agents');
        const role = ROLE_MAP[verb];
        const input = {
          project: opts.project,
          env: opts.env,
          goal: opts.goal,
          plan: opts.plan ? readFileSync(opts.plan, 'utf8') : undefined,
          spec: opts.spec ? readFileSync(opts.spec, 'utf8') : undefined,
          scenario: opts.scenario,
          runId: opts.runId,
          diff: opts.diff,
          files: opts.files,
        };
        const common = {
          role,
          input,
          rootDir: ctx.rootDir,
          provider: opts.dryRun ? 'fake' : opts.adapter,
          model: opts.model,
          maxTurns: opts.maxTurns ? Number(opts.maxTurns) : undefined,
          budgetUsd: opts.budgetUsd ? Number(opts.budgetUsd) : undefined,
          dryRun: Boolean(opts.dryRun),
        };
        if (opts.dryRun) {
          const prep = prepareJob(common);
          const view = {
            job: {
              id: prep.job.id,
              role: prep.job.role,
              provider: prep.job.provider,
              model: prep.job.model,
              budgetUsd: prep.job.budgetUsd,
              maxTurns: prep.job.maxTurns,
            },
            tools: prep.tools.map((t) => t.name),
            mcpServers: Object.keys(prep.mcpServers),
            system: prep.system,
            prompt: prep.prompt,
          };
          if (ctx.opts.json) return json(view);
          out(pc.bold(`Dry run: automax agent ${verb} (${role})`));
          out(
            `${pc.dim('adapter:')} fake  ${pc.dim('budget:')} $${view.job.budgetUsd}  ${pc.dim('max turns:')} ${view.job.maxTurns}`,
          );
          out(`${pc.dim('tools:')} ${view.tools.join(', ')}`);
          if (view.mcpServers.length)
            out(`${pc.dim('external MCP servers:')} ${view.mcpServers.join(', ')}`);
          out(pc.dim('\n--- system prompt ---'));
          out(view.system);
          out(pc.dim('\n--- user prompt ---'));
          out(view.prompt);
          out(
            pc.dim(
              '\nNo files were written. Drop --dry-run (and set ANTHROPIC_API_KEY or OPENAI_API_KEY) to run for real.',
            ),
          );
          return;
        }
        const job = await runJob({
          ...common,
          onEvent:
            opts.events || !ctx.opts.json
              ? (e) => {
                  if (ctx.opts.json) return;
                  if (e.type === 'text') process.stdout.write(e.text);
                  else if (e.type === 'tool_call')
                    out(pc.cyan(`\n▶ ${e.name} ${JSON.stringify(e.input).slice(0, 160)}`));
                  else if (e.type === 'tool_result')
                    out(pc.dim(`  ↳ ${e.isError ? 'error' : 'ok'}`));
                  else if (e.type === 'status') out(pc.dim(`  · ${e.message}`));
                }
              : undefined,
        });
        if (ctx.opts.json) return json(job);
        out('');
        const line = `${job.status} · turns ${job.turns ?? 0} · tool calls ${job.toolCalls ?? 0} · cost $${(job.costUsd ?? 0).toFixed(3)} · model ${job.model}`;
        if (job.status === 'failed')
          throw new AutomaxError(
            'RUN_FAILED',
            `Agent job ${job.id} failed: ${job.error ?? 'unknown'}`,
            { details: { job: job.id } },
          );
        ok(`Job ${job.id}: ${line}`);
        if (job.proposalIds.length) {
          out(`Proposals: ${job.proposalIds.join(', ')}`);
          out(pc.dim(`Review with: automax proposals show ${job.proposalIds[0]}`));
        }
      });
  }

  agent
    .command('jobs')
    .description('List recent agent jobs')
    .option('--limit <n>', 'max rows', '20')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const { JobJournal } = await import('@automax/agents');
      const rows = new JobJournal(ctx.rootDir)
        .list(Number(opts.limit))
        .map((j) => ({
          id: j.id,
          role: j.role,
          project: j.project ?? '',
          status: j.status,
          cost: `$${(j.costUsd ?? 0).toFixed(3)}`,
          turns: j.turns ?? 0,
          proposals: j.proposalIds.length,
          started: j.startedAt,
        }));
      if (ctx.opts.json) return json(rows);
      table(rows);
    });

  agent
    .command('install-claude')
    .description(
      'Write .claude/agents/automax-*.md, .mcp.json, AGENT.md and SKILL.md for Claude Code',
    )
    .option('-p, --project <slug>')
    .option('-e, --env <name>')
    .option('--force', 'overwrite existing files')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const { installClaudeCode } = await import('@automax/agents');
      const written = installClaudeCode(ctx.rootDir, {
        project: opts.project,
        env: opts.env,
        force: opts.force,
      });
      if (ctx.opts.json) return json({ written });
      for (const w of written) ok(w.replace(ctx.rootDir + '/', ''));
      if (!written.length) out(pc.dim('Nothing written (files exist; use --force).'));
    });
}
