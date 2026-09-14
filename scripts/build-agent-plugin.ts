/**
 * Builds the public SDODS skills repository: Agent Skills for `npx skills add` and a Claude Code
 * plugin marketplace, from the sources that already drive SDODS so nothing is maintained twice.
 *
 *   skills/<name>/SKILL.md                 packages/cli/skills (what `sdods skills install` copies)
 *   .claude-plugin/marketplace.json        marketplace "sdods" with one plugin
 *   plugins/sdods/.claude-plugin/plugin.json
 *   plugins/sdods/.mcp.json                the sdods MCP server via `npx -y @sdods/cli mcp`
 *   plugins/sdods/skills/<name>/SKILL.md   the same skills under short names, plus the
 *                                          user-invoked commands in plugin/commands
 *   plugins/sdods/agents/sdods-<role>.md   the five SDODS roles, from ROLE_PROMPTS
 *   plugins/sdods/hooks/                   plugin/hooks
 *
 * Usage: bun run plugin:build [--out <dir>] [--sponsor-url <https url>]
 * The default output is dist/sdods-skills. After each release, publish it with
 * scripts/push-agent-plugin.mjs; see apps/docs/content/docs/guides/ai-coding-tools.mdx for what
 * users run.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONVENTIONS, ROLE_PROMPTS, type RoleName } from '@sdods/mcp';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MARKETPLACE = 'sdods';
export const PLUGIN = 'sdods';
export const SKILLS_REPO = 'siri1410/sdods-skills';

/** Bundled skill → the shorter name it gets inside the plugin, where Claude Code adds `sdods:`. */
export const PLUGIN_SKILL_NAMES: Record<string, string> = {
  sdods: 'workspace',
  'sdods-run': 'run',
  'sdods-record': 'record',
  'sdods-start-ui': 'start-ui',
};

const ROLE_USE: Record<RoleName, string> = {
  planner: 'plan tests',
  generator: 'write or generate features',
  healer: 'fix a failing scenario',
  upgrader: 'update tests after code changes',
  reviewer: 'review feature files',
};

function renameSkill(text: string, name: string): string {
  return text.replace(/^(---\r?\n(?:[\s\S]*?\r?\n)?)name:[^\n]*\n/, `$1name: ${name}\n`);
}

function withName(text: string, name: string): string {
  if (/^---\r?\n[\s\S]*?^name:/m.test(text)) return renameSkill(text, name);
  return text.replace(/^---\r?\n/, `---\nname: ${name}\n`);
}

/**
 * `npx skills add` also reads skills declared by `.claude-plugin/marketplace.json`, which would list
 * the plugin's copies (and its Claude-only commands) next to the portable ones in skills/. Marked
 * internal, they stay out of its normal discovery; Claude Code ignores the metadata.
 */
function markInternal(text: string): string {
  return text.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, `$1\nmetadata:\n  internal: true$2`);
}

function write(file: string, content: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

export interface BuildOptions {
  out: string;
  version: string;
  sponsorUrl?: string;
}

export function buildAgentPlugin(o: BuildOptions): string[] {
  const written: string[] = [];
  const put = (rel: string, content: string) => {
    write(join(o.out, rel), content);
    written.push(rel);
  };
  rmSync(o.out, { recursive: true, force: true });
  mkdirSync(o.out, { recursive: true });

  const skillsSrc = join(repoRoot, 'packages/cli/skills');
  const bundled = readdirSync(skillsSrc, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillsSrc, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();

  // 1. Agent Skills at the root of skills/, where `npx skills add` looks first.
  for (const name of bundled) {
    cpSync(join(skillsSrc, name), join(o.out, 'skills', name), { recursive: true });
    written.push(`skills/${name}/SKILL.md`);
  }

  // 2. The marketplace.
  const description =
    'SDODS for Claude Code: BDD test automation for UI, API and hybrid flows. Run, plan, generate, heal and review tests with the SDODS MCP server, skills and subagents.';
  put(
    '.claude-plugin/marketplace.json',
    JSON.stringify(
      {
        name: MARKETPLACE,
        owner: { name: 'SDODS', email: 'admin@sdods.com' },
        metadata: { description: 'Official SDODS plugins for Claude Code.' },
        plugins: [
          {
            name: PLUGIN,
            source: `./plugins/${PLUGIN}`,
            description,
            version: o.version,
            category: 'testing',
            keywords: ['testing', 'bdd', 'playwright', 'gherkin', 'api-testing', 'mcp'],
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );

  // 3. The plugin.
  const p = `plugins/${PLUGIN}`;
  put(
    `${p}/.claude-plugin/plugin.json`,
    JSON.stringify(
      {
        name: PLUGIN,
        version: o.version,
        description,
        author: { name: 'SDODS', email: 'admin@sdods.com', url: 'https://sdods.com' },
        homepage: 'https://docs.sdods.com/docs/guides/ai-coding-tools/',
        repository: `https://github.com/${SKILLS_REPO}`,
        license: 'Apache-2.0',
        keywords: ['testing', 'bdd', 'playwright', 'gherkin', 'api-testing', 'mcp'],
      },
      null,
      2,
    ) + '\n',
  );
  put(
    `${p}/.mcp.json`,
    JSON.stringify(
      { mcpServers: { sdods: { command: 'npx', args: ['-y', '@sdods/cli', 'mcp'] } } },
      null,
      2,
    ) + '\n',
  );

  for (const name of bundled) {
    const short = PLUGIN_SKILL_NAMES[name] ?? name;
    const text = readFileSync(join(skillsSrc, name, 'SKILL.md'), 'utf8');
    put(`${p}/skills/${short}/SKILL.md`, markInternal(renameSkill(text, short)));
  }
  const commandsDir = join(repoRoot, 'plugin/commands');
  for (const file of readdirSync(commandsDir)
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    const name = file.slice(0, -3);
    if (Object.values(PLUGIN_SKILL_NAMES).includes(name))
      throw new Error(`plugin/commands/${file} collides with a bundled skill named ${name}`);
    put(
      `${p}/skills/${name}/SKILL.md`,
      markInternal(withName(readFileSync(join(commandsDir, file), 'utf8'), name)),
    );
  }

  // Tool names of a plugin's MCP server are prefixed mcp__plugin_<plugin>_<server>__.
  const tools = `Read, Glob, Grep, mcp__plugin_${PLUGIN}_sdods__*`;
  for (const role of Object.keys(ROLE_PROMPTS) as RoleName[]) {
    const r = ROLE_PROMPTS[role];
    put(
      `${p}/agents/sdods-${role}.md`,
      `---\nname: sdods-${role}\ndescription: ${r.description} Use when the user asks SDODS to ${ROLE_USE[role]}.\ntools: ${tools}\n---\n\n${CONVENTIONS}\n\n${r.body}\n`,
    );
  }

  cpSync(
    join(repoRoot, 'plugin/hooks/session-start.mjs'),
    join(o.out, p, 'hooks/session-start.mjs'),
  );
  written.push(`${p}/hooks/session-start.mjs`);
  put(
    `${p}/hooks/hooks.json`,
    JSON.stringify(
      {
        description: 'Orients Claude when a session opens inside an SDODS workspace.',
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"',
                  timeout: 10,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ) + '\n',
  );

  // 4. Repository files.
  cpSync(join(repoRoot, 'LICENSE'), join(o.out, 'LICENSE'));
  written.push('LICENSE');
  put('README.md', readme(bundled, o));
  if (o.sponsorUrl) put('.github/FUNDING.yml', `custom: ['${o.sponsorUrl}']\n`);

  return written;
}

function readme(bundled: string[], o: BuildOptions): string {
  const skills = bundled
    .map((name) => {
      const fm = /^---\r?\n[\s\S]*?^description:\s*(.*)$/m.exec(
        readFileSync(join(repoRoot, 'packages/cli/skills', name, 'SKILL.md'), 'utf8'),
      );
      return `| \`${name}\` | ${(fm?.[1] ?? '').replace(/\|/g, '\\|')} |`;
    })
    .join('\n');
  const commands = readdirSync(join(repoRoot, 'plugin/commands'))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => `\`/${PLUGIN}:${f.slice(0, -3)}\``)
    .join(', ');
  return `# SDODS skills and Claude Code plugin

Skills, subagents and the MCP server that let AI coding agents write, run, heal and review
[SDODS](https://sdods.com) tests — BDD automation for UI, API and hybrid flows.

SDODS is free: Apache-2.0 on npm (\`@sdods/cli\`), unlimited API tokens, no paid tier.

> Generated from the SDODS monorepo by \`scripts/build-agent-plugin.ts\` (version ${o.version}).
> Changes made directly in this repository are overwritten on the next release.

## Claude Code plugin

Skills, the five SDODS subagents, the MCP server, slash commands and a session hook, in one install:

\`\`\`text
/plugin marketplace add ${SKILLS_REPO}
\`\`\`

\`\`\`text
/plugin install ${PLUGIN}@${MARKETPLACE}
\`\`\`

Commands: ${commands}.

To offer it to everyone who opens a repository, commit this to \`.claude/settings.json\`:

\`\`\`json
{
  "extraKnownMarketplaces": {
    "${MARKETPLACE}": { "source": { "source": "github", "repo": "${SKILLS_REPO}" } }
  },
  "enabledPlugins": { "${PLUGIN}@${MARKETPLACE}": true }
}
\`\`\`

## Any agent: skills with npx

Works with Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Amp, Goose and more:

\`\`\`bash
npx skills add ${SKILLS_REPO}
\`\`\`

Or with the SDODS CLI, which needs no GitHub access:

\`\`\`bash
npx -y @sdods/cli skills install
\`\`\`

| Skill | What it does |
| --- | --- |
${skills}

## MCP server only

\`\`\`bash
claude mcp add sdods -- npx -y @sdods/cli mcp
\`\`\`

Every other client — Codex, Cursor, VS Code, Windsurf, Gemini CLI, Zed, JetBrains, Claude Desktop
and a shared team endpoint — is covered in the
[AI coding tools guide](https://docs.sdods.com/docs/guides/ai-coding-tools/).
${o.sponsorUrl ? `\n## Support SDODS\n\nIf SDODS saves your team time, [sponsor its development](${o.sponsorUrl}).\n` : ''}
## License

Apache-2.0.
`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const out = resolve(arg('--out') ?? join(repoRoot, 'dist/sdods-skills'));
  const version = (
    JSON.parse(readFileSync(join(repoRoot, 'packages/cli/package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  const files = buildAgentPlugin({ out, version, sponsorUrl: arg('--sponsor-url') });
  console.log(`agent plugin — ${files.length} file(s) written to ${out}`);
}
