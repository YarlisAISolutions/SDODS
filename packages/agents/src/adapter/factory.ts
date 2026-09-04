import { ClaudeAdapter } from './claude.js';
import { ClaudeCodeCliAdapter } from './claude-code.js';
import { findOnPath } from './cli-common.js';
import { CodexCliAdapter } from './codex.js';
import { FakeAdapter, type FakeAdapterOptions } from './fake.js';
import { OpenAiCompatibleAdapter } from './openai-compat.js';
import { AgentsConfigError, type LlmAdapter, type Provider } from './types.js';

export interface CreateAdapterOptions {
  provider?: Provider | string;
  model?: string;
  fake?: FakeAdapterOptions;
  /** repo root, project and env let the CLI adapters start the automax MCP server */
  rootDir?: string;
  project?: string;
  env?: string;
  /** called when the provider was auto-detected (not set explicitly) */
  onAutoDetect?: (provider: Provider, reason: string) => void;
}

export function normalizeProvider(raw: string): Provider {
  const p = raw.toLowerCase();
  if (p === 'claude' || p === 'anthropic') return 'claude';
  if (p === 'claude-code' || p === 'claudecode' || p === 'claude-cli') return 'claude-code';
  if (p === 'codex' || p === 'codex-cli' || p === 'openai-codex') return 'codex';
  if (p === 'openai' || p === 'openai-compatible' || p === 'ollama' || p === 'azure')
    return 'openai-compatible';
  if (p === 'fake' || p === 'dry-run') return 'fake';
  throw new AgentsConfigError(
    `Unknown LLM provider "${raw}".`,
    'Use claude, claude-code, codex, openai-compatible or fake.',
  );
}

/**
 * Detection order when nothing is set explicitly:
 * ANTHROPIC_API_KEY → `claude` CLI on PATH → `codex` CLI on PATH → OPENAI_API_KEY → fake.
 */
export function detectProvider(env: NodeJS.ProcessEnv = process.env): {
  provider: Provider;
  reason: string;
} {
  if (env.ANTHROPIC_API_KEY) return { provider: 'claude', reason: 'ANTHROPIC_API_KEY is set' };
  if (findOnPath('claude')) return { provider: 'claude-code', reason: 'claude CLI found on PATH' };
  if (findOnPath('codex')) return { provider: 'codex', reason: 'codex CLI found on PATH' };
  if (env.OPENAI_API_KEY) return { provider: 'openai-compatible', reason: 'OPENAI_API_KEY is set' };
  return {
    provider: 'fake',
    reason: 'no API key and no claude/codex CLI found; using the fake adapter',
  };
}

export function resolveProvider(
  explicit?: string,
  projectDefault?: string,
  onAutoDetect?: (provider: Provider, reason: string) => void,
): Provider {
  const chosen = explicit ?? process.env.AUTOMAX_LLM_PROVIDER ?? projectDefault;
  if (chosen) return normalizeProvider(chosen);
  const d = detectProvider();
  onAutoDetect?.(d.provider, d.reason);
  return d.provider;
}

export function createAdapter(
  opts: CreateAdapterOptions = {},
  projectDefault?: string,
): LlmAdapter {
  const provider = resolveProvider(opts.provider, projectDefault, opts.onAutoDetect);
  const cliCtx = { rootDir: opts.rootDir, project: opts.project, env: opts.env, model: opts.model };
  switch (provider) {
    case 'claude':
      return new ClaudeAdapter({ model: opts.model });
    case 'claude-code':
      return new ClaudeCodeCliAdapter(cliCtx);
    case 'codex':
      return new CodexCliAdapter(cliCtx);
    case 'openai-compatible':
      return new OpenAiCompatibleAdapter({ model: opts.model });
    case 'fake':
      return new FakeAdapter(opts.fake);
  }
}
