import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import pc from 'picocolors';
import { SdodsError } from '@sdods/core';
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
      .option(
        '--adapter <name>',
        'claude (API key) | claude-code (logged-in Claude Code CLI) | codex (logged-in Codex CLI) | openai | ollama (a model on this machine) | fake; default: auto-detect',
      )
      .option('--model <id>', 'model override')
      .option(
        '--profile <name>',
        'auto | full | small — how many tools and how much prompt the model is given',
      )
      .option(
        '--browser',
        'attach the browser MCP server even under the small profile (which omits it)',
      )
      .option('--no-browser', 'never attach the browser MCP server')
      .option('--base-url <url>', 'model server endpoint (ollama, vLLM, LM Studio, Azure)')
      .option('--context-tokens <n>', 'context window to load a local model with (num_ctx)')
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
        const { prepareJob, runJob } = await import('@sdods/agents');
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
          profile: opts.profile,
          browser: opts.browser as boolean | undefined,
          baseUrl: opts.baseUrl,
          contextTokens: opts.contextTokens ? Number(opts.contextTokens) : undefined,
          maxTurns: opts.maxTurns ? Number(opts.maxTurns) : undefined,
          budgetUsd: opts.budgetUsd ? Number(opts.budgetUsd) : undefined,
          dryRun: Boolean(opts.dryRun),
        };
        if (opts.dryRun) {
          const prep = await prepareJob(common);
          const view = {
            job: {
              id: prep.job.id,
              role: prep.job.role,
              provider: prep.job.provider,
              model: prep.job.model,
              budgetUsd: prep.job.budgetUsd,
              maxTurns: prep.job.maxTurns,
            },
            profile: { name: prep.profile.profile, reason: prep.profile.reason },
            tools: prep.tools.map((t) => t.name),
            mcpServers: Object.keys(prep.mcpServers),
            system: prep.system,
            prompt: prep.prompt,
          };
          if (ctx.opts.json) return json(view);
          out(pc.bold(`Dry run: sdods agent ${verb} (${role})`));
          out(
            `${pc.dim('adapter:')} fake  ${pc.dim('budget:')} $${view.job.budgetUsd}  ${pc.dim('max turns:')} ${view.job.maxTurns}  ${pc.dim('profile:')} ${view.profile.name} (${view.profile.reason})`,
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
          throw new SdodsError(
            'RUN_FAILED',
            `Agent job ${job.id} failed: ${job.error ?? 'unknown'}`,
            { details: { job: job.id } },
          );
        ok(`Job ${job.id}: ${line}`);
        if (job.proposalIds.length) {
          out(`Proposals: ${job.proposalIds.join(', ')}`);
          out(pc.dim(`Review with: sdods proposals show ${job.proposalIds[0]}`));
        }
      });
  }

  agent
    .command('jobs')
    .description('List recent agent jobs')
    .option('--limit <n>', 'max rows', '20')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const { JobJournal } = await import('@sdods/agents');
      const rows = new JobJournal(ctx.rootDir).list(Number(opts.limit)).map((j) => ({
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

  const installAction = async (
    opts: { for?: string; project?: string; env?: string; force?: boolean; mcp?: boolean },
    cmd: Command,
    forced?: 'claude',
  ) => {
    const ctx = createContext(cmd);
    const target = (forced ?? opts.for ?? 'all') as 'claude' | 'codex' | 'all';
    if (!['claude', 'codex', 'all'].includes(target)) {
      throw new SdodsError('NOT_SUPPORTED', `Unknown target "${target}".`, {
        hint: 'Use --for claude, --for codex or --for all.',
        exitCode: 2,
      });
    }
    const { installCodingAgents } = await import('@sdods/agents');
    const written = installCodingAgents(ctx.rootDir, {
      for: target,
      project: opts.project,
      env: opts.env,
      force: opts.force,
    });
    if (opts.mcp !== false) {
      const { execa } = await import('execa');
      const clients = target === 'all' ? ['claude', 'codex'] : [target];
      for (const client of clients) {
        const args = ['mcp', 'install', client];
        if (opts.project) args.push('-p', opts.project);
        if (opts.env) args.push('-e', opts.env);
        const r = await execa(process.execPath, [...process.execArgv, process.argv[1]!, ...args], {
          cwd: ctx.rootDir,
          reject: false,
        });
        written.push(
          `mcp:${client} → ${r.exitCode === 0 ? 'registered' : `failed (${(r.stderr || r.stdout).trim().split('\n').pop()})`}`,
        );
      }
    }
    if (ctx.opts.json) return json({ target, written });
    for (const w of written) ok(w.replace(ctx.rootDir + '/', ''));
    if (!written.length) out(pc.dim('Nothing written (files exist; use --force).'));
  };

  agent
    .command('install')
    .description(
      'Set up coding-agent CLIs: --for claude writes .claude/agents/sdods-*.md + CLAUDE.md, --for codex writes AGENTS.md; both get AGENT.md/SKILL.md and the MCP registration',
    )
    .option('--for <client>', 'claude | codex | all', 'all')
    .option('-p, --project <slug>')
    .option('-e, --env <name>')
    .option('--force', 'overwrite existing files')
    .option('--no-mcp', 'skip `sdods mcp install <client>`')
    .action((opts, cmd) => installAction(opts, cmd));

  agent
    .command('install-claude')
    .description('Alias of `agent install --for claude`')
    .option('-p, --project <slug>')
    .option('-e, --env <name>')
    .option('--force', 'overwrite existing files')
    .option('--no-mcp', 'skip `sdods mcp install claude`')
    .action((opts, cmd) => installAction(opts, cmd, 'claude'));
}
