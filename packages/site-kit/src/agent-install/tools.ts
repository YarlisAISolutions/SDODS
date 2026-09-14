/**
 * What each AI coding tool needs to install a project, as data.
 *
 * Nothing here knows about SDODS: every command is built from an {@link AgentProject}, so another
 * project gets a correct widget by passing its own package, skills repository and plugin. A tool
 * whose inputs are missing (no skills repository, no remote endpoint) is left out rather than shown
 * with a command that cannot work.
 */

export interface AgentProject {
  /** Display name, e.g. "SDODS". */
  name: string;
  /** Name the MCP server is registered under in each client, e.g. "sdods". */
  serverName: string;
  /** npm package whose bin starts the MCP server over stdio, e.g. "@sdods/cli". */
  npmPackage: string;
  /** Arguments after the package, default `['mcp']`: `npx -y <npmPackage> mcp`. */
  mcpArgs?: string[];
  /** Public GitHub `owner/repo` holding `skills/<name>/SKILL.md` (for `npx skills add`). */
  skillsRepo?: string;
  /** Claude Code marketplace name, as declared in `.claude-plugin/marketplace.json`. */
  marketplace?: string;
  /** Claude Code plugin name inside that marketplace. */
  plugin?: string;
  /** A remote MCP endpoint, or a placeholder such as `https://<your-host>/mcp`. */
  remoteMcpUrl?: string;
  /** True when the remote endpoint supports OAuth, which ChatGPT and Claude.ai require. */
  remoteOAuth?: boolean;
}

export type ToolId =
  | 'claude-code'
  | 'cursor'
  | 'codex'
  | 'skills'
  | 'vscode'
  | 'gemini'
  | 'windsurf'
  | 'chatgpt'
  | 'claude-ai';

export type InstallStep =
  | { kind: 'command'; value: string; caption?: string }
  | { kind: 'link'; href: string; label: string; caption?: string }
  | { kind: 'note'; text: string };

export interface AgentTool {
  id: ToolId;
  label: string;
  /** One sentence above the steps, e.g. "Install the SDODS plugin in Claude Code." */
  intro: string;
  steps: InstallStep[];
}

export const DEFAULT_TOOL_ORDER: ToolId[] = [
  'claude-code',
  'cursor',
  'codex',
  'chatgpt',
  'skills',
  'vscode',
  'gemini',
  'windsurf',
  'claude-ai',
];

export function stdioArgs(p: AgentProject): string[] {
  return ['-y', p.npmPackage, ...(p.mcpArgs ?? ['mcp'])];
}

/** The server object Cursor's install link and VS Code's `--add-mcp` both take. */
export function stdioServer(p: AgentProject): { command: string; args: string[] } {
  return { command: 'npx', args: stdioArgs(p) };
}

function base64(text: string): string {
  // Browsers and Node 16+ both have btoa; the input is ASCII JSON.
  return btoa(text);
}

export function cursorInstallLink(p: AgentProject): string {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(p.serverName)}&config=${base64(JSON.stringify(stdioServer(p)))}`;
}

export function vscodeInstallLink(p: AgentProject): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: p.serverName, ...stdioServer(p) }))}`;
}

const skillsAdd = (p: AgentProject, agent?: string) =>
  p.skillsRepo ? `npx skills add ${p.skillsRepo}${agent ? ` -a ${agent}` : ''}` : undefined;

const npx = (p: AgentProject) => `npx ${stdioArgs(p).join(' ')}`;

function commands(values: Array<string | undefined>, captions: string[] = []): InstallStep[] {
  return values.flatMap((value, i) =>
    value ? [{ kind: 'command' as const, value, caption: captions[i] }] : [],
  );
}

type Builder = (p: AgentProject) => AgentTool | null;

export const TOOL_BUILDERS: Record<ToolId, Builder> = {
  'claude-code': (p) => {
    const plugin = p.skillsRepo && p.marketplace && p.plugin;
    return {
      id: 'claude-code',
      label: 'Claude Code',
      intro: plugin
        ? `Install the ${p.name} plugin in Claude Code: skills, subagents, commands and the MCP server.`
        : `Add the ${p.name} MCP server to Claude Code.`,
      steps: plugin
        ? commands([
            `/plugin marketplace add ${p.skillsRepo}`,
            `/plugin install ${p.plugin}@${p.marketplace}`,
          ])
        : commands([`claude mcp add ${p.serverName} -- ${npx(p)}`]),
    };
  },
  cursor: (p) => ({
    id: 'cursor',
    label: 'Cursor',
    intro: `Add the ${p.name} MCP server to Cursor${p.skillsRepo ? ', then its skills' : ''}.`,
    steps: [
      { kind: 'link', href: cursorInstallLink(p), label: 'Add to Cursor' },
      ...commands([skillsAdd(p, 'cursor')]),
    ],
  }),
  codex: (p) => ({
    id: 'codex',
    label: 'Codex',
    intro: `Add the ${p.name} MCP server to Codex${p.skillsRepo ? ', then its skills' : ''}.`,
    steps: commands([`codex mcp add ${p.serverName} -- ${npx(p)}`, skillsAdd(p, 'codex')]),
  }),
  skills: (p) =>
    p.skillsRepo
      ? {
          id: 'skills',
          label: 'Skills (npx)',
          intro: `Install the ${p.name} skills into any agent that reads Agent Skills.`,
          steps: commands(
            [skillsAdd(p), `npx ${['-y', p.npmPackage].join(' ')} skills install`],
            ['Choose your agents interactively', 'Or without GitHub, from npm'],
          ),
        }
      : null,
  vscode: (p) => ({
    id: 'vscode',
    label: 'VS Code',
    intro: `Add the ${p.name} MCP server to VS Code and GitHub Copilot.`,
    steps: [
      { kind: 'link', href: vscodeInstallLink(p), label: 'Add to VS Code' },
      ...commands([
        `code --add-mcp '${JSON.stringify({ name: p.serverName, ...stdioServer(p) })}'`,
      ]),
    ],
  }),
  gemini: (p) => ({
    id: 'gemini',
    label: 'Gemini CLI',
    intro: `Add the ${p.name} MCP server to Gemini CLI${p.skillsRepo ? ', then its skills' : ''}.`,
    // gemini treats dashed arguments as its own flags unless they follow `--`
    steps: commands([
      `gemini mcp add ${p.serverName} npx -- ${stdioArgs(p).join(' ')}`,
      skillsAdd(p, 'gemini-cli'),
    ]),
  }),
  windsurf: (p) => ({
    id: 'windsurf',
    label: 'Windsurf',
    intro: `Add this to ~/.codeium/windsurf/mcp_config.json.`,
    steps: commands([JSON.stringify({ mcpServers: { [p.serverName]: stdioServer(p) } })]),
  }),
  chatgpt: (p) =>
    p.remoteMcpUrl && p.remoteOAuth
      ? {
          id: 'chatgpt',
          label: 'ChatGPT',
          intro: `Connect ChatGPT to your ${p.name} server. Needs developer mode and a public https host.`,
          steps: [
            {
              kind: 'note',
              text: 'Settings → Apps & Connectors → Advanced settings → turn on Developer mode, then Create, and choose OAuth.',
            },
            ...commands([p.remoteMcpUrl], ['MCP server URL']),
          ],
        }
      : null,
  'claude-ai': (p) =>
    p.remoteMcpUrl && p.remoteOAuth
      ? {
          id: 'claude-ai',
          label: 'Claude.ai',
          intro: `Connect Claude.ai or Claude Desktop to your ${p.name} server as a custom connector.`,
          steps: [
            {
              kind: 'note',
              text: 'Settings → Connectors → Add custom connector, then paste the URL.',
            },
            ...commands([p.remoteMcpUrl], ['Remote MCP server URL']),
          ],
        }
      : null,
};

/** The tools to show, in order, with every tool that cannot work for this project removed. */
export function buildTools(p: AgentProject, order: ToolId[] = DEFAULT_TOOL_ORDER): AgentTool[] {
  return order.flatMap((id) => {
    const tool = TOOL_BUILDERS[id](p);
    return tool && tool.steps.length ? [tool] : [];
  });
}
