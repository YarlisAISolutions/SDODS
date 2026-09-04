import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONVENTIONS, ROLE_PROMPTS, installClientConfig, type RoleName } from '@automax/mcp';

const TAGLINE =
  'AutoMax is an automation platform with a reusable architecture built on Playwright.';

/** Write `.claude/agents/automax-*.md`, `.mcp.json`, AGENT.md and SKILL.md for Claude Code users. */
export function installClaudeCode(
  rootDir: string,
  opts: { project?: string; env?: string; force?: boolean } = {},
): string[] {
  const written: string[] = [];
  const agentsDir = join(rootDir, '.claude', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  for (const role of Object.keys(ROLE_PROMPTS) as RoleName[]) {
    const p = ROLE_PROMPTS[role];
    const file = join(agentsDir, `automax-${role}.md`);
    if (existsSync(file) && !opts.force) continue;
    writeFileSync(
      file,
      `---\nname: automax-${role}\ndescription: ${p.description} Use when the user asks AutoMax to ${role === 'planner' ? 'plan tests' : role === 'generator' ? 'write or generate features' : role === 'healer' ? 'fix a failing scenario' : role === 'upgrader' ? 'update tests after code changes' : 'review feature files'}.\ntools: Read, Glob, Grep, mcp__automax__*, mcp__playwright__*\n---\n\n${CONVENTIONS}\n\n${p.body}\n`,
    );
    written.push(file);
  }
  const mcp = installClientConfig(rootDir, 'claude', {
    project: opts.project,
    env: opts.env,
    args: ['automax', 'mcp'],
  });
  written.push(mcp.file);

  const agentMd = join(rootDir, 'AGENT.md');
  if (!existsSync(agentMd) || opts.force) {
    writeFileSync(agentMd, agentMdContent());
    written.push(agentMd);
  }
  const skillMd = join(rootDir, 'SKILL.md');
  if (!existsSync(skillMd) || opts.force) {
    writeFileSync(skillMd, skillMdContent());
    written.push(skillMd);
  }
  return written;
}

export function agentMdContent(): string {
  return `# AGENT.md — AutoMax for coding agents

${TAGLINE} This file orients an AI coding assistant working in this repository.

## Mental model

- **Hierarchy**: organization → workspace(s) → project (\`projects/<slug>\`) → module (\`features/<module>/\`). \`automax.workspace.yaml\` at the root names the org and workspaces; each project has \`automax.project.yaml\` and \`envs/<env>.yaml\`.
- **Layers**: \`@ui\`, \`@api\`, \`@hybrid\` scenarios share ONE merged Playwright/BDD fixture set (\`@automax/core/fixtures\`). A scenario can seed through the API and assert in the browser.
- **Processes**: named run recipes (pr-check, nightly-regression, release-gate). \`automax run --process <name>\`.
- **Everything is CLI-first**: \`automax run\`, \`lint\`, \`steps list\`, \`features list\`, \`report\`, \`heal report\`, \`record\`, \`har\`, \`db\`, \`mcp\`, \`agent\`, \`proposals\`, \`serve\`.
- **Agents never edit the working tree**; they write proposals under \`proposals/<id>/\` that a person accepts with \`automax proposals accept <id>\`.

## Conventions

${CONVENTIONS.split('\n').slice(3).join('\n')}

## Where things live

| Path | Purpose |
|---|---|
| \`packages/contracts\` | schemas, ids, attachment names, scopes (leaf package) |
| \`packages/core\` | config precedence, registry, fixtures, step library, data, screenshots, heal, recorder, lint, analyze |
| \`packages/cli\` | the \`automax\` command |
| \`packages/db\` | Kysely, SQLite ⇄ Postgres, ingest, insights |
| \`packages/mcp\` | tool registry, MCP server (stdio + HTTP), proposals, prompts |
| \`packages/agents\` | LLM adapters, roles, jobs |
| \`packages/integrations\` | GitHub, Jira |
| \`packages/server\`, \`packages/web\` | Fastify API and React UI |
| \`projects/demo-shop\` | reference project and release acceptance suite |

## Verify before you claim done

\`\`\`bash
bun run typecheck && bun run lint && bun run test
bun run automax lint -p <slug>
bun run automax run -p <slug> -e <env> -l api
bun run automax run -p <slug> -e <env> -l ui -b chromium -t @smoke
\`\`\`
`;
}

export function skillMdContent(): string {
  return `---
name: automax
description: Work inside an AutoMax repository — an automation platform with a reusable architecture built on Playwright. Use for writing or fixing Gherkin features, page objects, step definitions, project/env yaml, running suites, reading results, and driving the automax CLI or MCP tools.
---

# AutoMax skill

## Quick reference

| Task | Command |
|---|---|
| See projects / hierarchy | \`automax project list\`, \`automax workspace tree\` |
| Resolve config with provenance | \`automax config show -p <slug> -e <env> --explain\` |
| Validate features | \`automax lint -p <slug>\` |
| Run a slice | \`automax run -p <slug> -e <env> -l api\` · \`-l ui -b chromium -t @smoke\` · \`--process pr-check\` |
| Results | \`automax report --last\`, \`automax heal report --last\` |
| Steps available | \`automax steps list -p <slug>\` |
| Record / replay | \`automax record -p <slug> -e <env> --user <role> --name <name>\`, \`automax har replay --strict\` |
| Agents | \`automax agent plan|generate|heal|upgrade|review -p <slug> [--dry-run]\`, \`automax proposals list|show|accept|reject\` |
| MCP | \`automax mcp --project <slug>\`, \`automax mcp install claude\` |

## Rules

${CONVENTIONS.split('\n').slice(3).join('\n')}

## Writing a scenario (checklist)

1. Pick the module directory under \`features/\` and the module tag.
2. Tag the Feature: one layer (\`@ui|@api|@hybrid\`) + one suite (\`@smoke|@regression|@sanity\`).
3. Reuse steps from \`automax steps list\`; add project steps in \`steps/<module>.steps.ts\` only when needed.
4. Data through datasets (\`Given I load dataset "users" row 1\`) or \`@user:<role>\`; never literal secrets.
5. \`automax lint -p <slug>\` then run the scenario; check before/after screenshots in \`.automax/runs/<runId>/\`.
`;
}
