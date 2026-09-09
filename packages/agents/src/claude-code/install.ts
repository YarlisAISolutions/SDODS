import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONVENTIONS, ROLE_PROMPTS, installClientConfig, type RoleName } from '@sdods/mcp';

const TAGLINE =
  'SDODS is an automation and orchestration platform with a reusable architecture: BDD for UI, API and hybrid flows.';

export type CodingAgentTarget = 'claude' | 'codex' | 'all';

export interface InstallCodingAgentsOptions {
  for?: CodingAgentTarget;
  project?: string;
  env?: string;
  force?: boolean;
  /** also write `.mcp.json` for Claude Code (the CLI normally registers MCP via `sdods mcp install`) */
  mcp?: boolean;
}

function roleUse(role: RoleName): string {
  return role === 'planner'
    ? 'plan tests'
    : role === 'generator'
      ? 'write or generate features'
      : role === 'healer'
        ? 'fix a failing scenario'
        : role === 'upgrader'
          ? 'update tests after code changes'
          : 'review feature files';
}

/**
 * Set up coding-agent CLIs for an SDODS repo:
 * - Claude Code: `.claude/agents/sdods-<role>.md` (one subagent per role) + `CLAUDE.md`
 * - Codex: `AGENTS.md` (Codex reads it as project instructions; roles become sections)
 * - both: `AGENT.md` and `SKILL.md` with the conventions
 * Returns the paths written. Existing files are kept unless `force`.
 */
export function installCodingAgents(
  rootDir: string,
  opts: InstallCodingAgentsOptions = {},
): string[] {
  const target = opts.for ?? 'all';
  const written: string[] = [];
  const writeIfMissing = (file: string, content: string) => {
    if (existsSync(file) && !opts.force) return;
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
    written.push(file);
  };

  if (target === 'claude' || target === 'all') {
    const agentsDir = join(rootDir, '.claude', 'agents');
    for (const role of Object.keys(ROLE_PROMPTS) as RoleName[]) {
      const p = ROLE_PROMPTS[role];
      writeIfMissing(
        join(agentsDir, `sdods-${role}.md`),
        `---\nname: sdods-${role}\ndescription: ${p.description} Use when the user asks SDODS to ${roleUse(role)}.\ntools: Read, Glob, Grep, mcp__sdods__*\n---\n\n${CONVENTIONS}\n\n${p.body}\n`,
      );
    }
    writeIfMissing(join(rootDir, 'CLAUDE.md'), claudeMdContent(opts));
    if (opts.mcp) {
      const mcp = installClientConfig(rootDir, 'claude', {
        project: opts.project,
        env: opts.env,
        args: ['sdods', 'mcp'],
      });
      written.push(mcp.file);
    }
  }
  if (target === 'codex' || target === 'all') {
    writeIfMissing(join(rootDir, 'AGENTS.md'), agentsMdContent(opts));
  }
  writeIfMissing(join(rootDir, 'AGENT.md'), agentMdContent());
  writeIfMissing(join(rootDir, 'SKILL.md'), skillMdContent());
  return written;
}

/** Backwards-compatible alias: Claude Code files plus `.mcp.json`. */
export function installClaudeCode(
  rootDir: string,
  opts: { project?: string; env?: string; force?: boolean } = {},
): string[] {
  return installCodingAgents(rootDir, { ...opts, for: 'claude', mcp: true });
}

function projectFlags(opts: { project?: string; env?: string }): string {
  return `${opts.project ? ` -p ${opts.project}` : ''}${opts.env ? ` -e ${opts.env}` : ''}`;
}

/** CLAUDE.md: what Claude Code loads automatically. Short pointer plus the rules that matter. */
export function claudeMdContent(opts: { project?: string; env?: string } = {}): string {
  return `# CLAUDE.md — SDODS

${TAGLINE} Read \`AGENT.md\` for the mental model and \`SKILL.md\` for the command reference.

## Working in this repo

- Use the SDODS MCP server (\`sdods mcp\`) for anything about projects, features, steps, runs and results — it is registered in \`.mcp.json\` (\`sdods mcp install claude\` re-registers it).
- Subagents live in \`.claude/agents/sdods-*.md\`: planner, generator, healer, upgrader, reviewer. Delegate matching requests to them.
- Never edit features/steps/pages directly when acting as an SDODS agent: write a proposal (\`write_proposal\` / \`feature_write\`) and let a person accept it with \`sdods proposals accept <id>\`.
- Verify with \`sdods lint${projectFlags(opts)}\` and \`sdods run${projectFlags(opts)} -l api\` / \`-l ui -b chromium -t @smoke\` before claiming done.

## Rules

${CONVENTIONS.split('\n').slice(3).join('\n')}
`;
}

/** AGENTS.md: Codex reads this as project instructions; roles become sections. */
export function agentsMdContent(opts: { project?: string; env?: string } = {}): string {
  const roles = (Object.keys(ROLE_PROMPTS) as RoleName[])
    .map(
      (role) =>
        `### sdods-${role}\n\n${ROLE_PROMPTS[role].description}\n\n${ROLE_PROMPTS[role].body}`,
    )
    .join('\n\n');
  return `# AGENTS.md — SDODS instructions for Codex

${TAGLINE} This file is read by the OpenAI Codex CLI. \`AGENT.md\` holds the mental model and \`SKILL.md\` the command reference.

## Tools

- The SDODS MCP server is registered as \`sdods\` (\`sdods mcp install codex\` re-registers it in \`~/.codex/config.toml\`); use its tools for projects, features, steps, runs, results, proposals.
- Drive a browser with the \`browser_*\` tools on the \`sdods\` server (\`browser_session_open\`, then \`browser_navigate\`, \`browser_snapshot\`, \`browser_click\`). They are the upstream Playwright MCP tools bound to the project and environment, so the page carries the right test-id attribute and login state.
- Commands: \`sdods lint${projectFlags(opts)}\`, \`sdods run${projectFlags(opts)} -l api\`, \`sdods run${projectFlags(opts)} -l ui -b chromium -t @smoke\`, \`sdods steps list${projectFlags(opts)}\`, \`sdods proposals list|show|accept\`.

## Rules

${CONVENTIONS.split('\n').slice(3).join('\n')}

## Roles

Pick the role that matches the request and follow its instructions. Every role only writes proposals; a person accepts them.

${roles}
`;
}

export function agentMdContent(): string {
  return `# AGENT.md — SDODS for coding agents

${TAGLINE} This file orients an AI coding assistant working in this repository.

## Mental model

- **Hierarchy**: organization → workspace(s) → project (\`projects/<slug>\`) → module (\`features/<module>/\`). \`sdods.workspace.yaml\` at the root names the org and workspaces; each project has \`sdods.project.yaml\` and \`envs/<env>.yaml\`.
- **Layers**: \`@ui\`, \`@api\`, \`@hybrid\` scenarios share ONE merged BDD fixture set (\`@sdods/core/fixtures\`). A scenario can seed through the API and assert in the browser.
- **Processes**: named run recipes (pr-check, nightly-regression, release-gate). \`sdods run --process <name>\`.
- **Everything is CLI-first**: \`sdods run\`, \`lint\`, \`steps list\`, \`features list\`, \`report\`, \`heal report\`, \`record\`, \`har\`, \`db\`, \`mcp\`, \`agent\`, \`proposals\`, \`serve\`.
- **Agents never edit the working tree**; they write proposals under \`proposals/<id>/\` that a person accepts with \`sdods proposals accept <id>\`.

## Conventions

${CONVENTIONS.split('\n').slice(3).join('\n')}

## Where things live

| Path | Purpose |
|---|---|
| \`packages/contracts\` | schemas, ids, attachment names, scopes (leaf package) |
| \`packages/core\` | config precedence, registry, fixtures, step library, data, screenshots, heal, recorder, lint, analyze |
| \`packages/cli\` | the \`sdods\` command |
| \`packages/db\` | Kysely, SQLite ⇄ Postgres, ingest, insights |
| \`packages/mcp\` | tool registry, MCP server (stdio + HTTP), proposals, prompts |
| \`packages/agents\` | LLM adapters, roles, jobs |
| \`packages/integrations\` | GitHub, Jira |
| \`packages/server\`, \`packages/web\` | Fastify API and React UI |
| \`projects/demo-shop\` | reference project and release acceptance suite |

## Verify before you claim done

\`\`\`bash
bun run typecheck && bun run lint && bun run test
bun run sdods lint -p <slug>
bun run sdods run -p <slug> -e <env> -l api
bun run sdods run -p <slug> -e <env> -l ui -b chromium -t @smoke
\`\`\`
`;
}

export function skillMdContent(): string {
  return `---
name: sdods
description: Work inside an SDODS repository — an automation and orchestration platform with a reusable architecture. Use for writing or fixing Gherkin features, page objects, step definitions, project/env yaml, running suites, reading results, and driving the sdods CLI or MCP tools.
---

# SDODS skill

## Quick reference

| Task | Command |
|---|---|
| See projects / hierarchy | \`sdods project list\`, \`sdods workspace tree\` |
| Resolve config with provenance | \`sdods config show -p <slug> -e <env> --explain\` |
| Validate features | \`sdods lint -p <slug>\` |
| Run a slice | \`sdods run -p <slug> -e <env> -l api\` · \`-l ui -b chromium -t @smoke\` · \`--process pr-check\` |
| Results | \`sdods report --last\`, \`sdods heal report --last\` |
| Steps available | \`sdods steps list -p <slug>\` |
| Record / replay | \`sdods record -p <slug> -e <env> --user <role> --name <name>\`, \`sdods har replay --strict\` |
| Agents | \`sdods agent plan|generate|heal|upgrade|review -p <slug> [--dry-run]\`, \`sdods proposals list|show|accept|reject\` |
| MCP | \`sdods mcp --project <slug>\`, \`sdods mcp install claude\` |

## Rules

${CONVENTIONS.split('\n').slice(3).join('\n')}

## Writing a scenario (checklist)

1. Pick the module directory under \`features/\` and the module tag.
2. Tag the Feature: one layer (\`@ui|@api|@hybrid\`) + one suite (\`@smoke|@regression|@sanity\`).
3. Reuse steps from \`sdods steps list\`; add project steps in \`steps/<module>.steps.ts\` only when needed.
4. Data through datasets (\`Given I load dataset "users" row 1\`) or \`@user:<role>\`; never literal secrets.
5. \`sdods lint -p <slug>\` then run the scenario; check before/after screenshots in \`.sdods/runs/<runId>/\`.
`;
}
