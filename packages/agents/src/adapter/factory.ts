import { ClaudeAdapter } from './claude.js';
import { ClaudeCodeCliAdapter } from './claude-code.js';
import { findOnPath } from './cli-common.js';
import { CodexCliAdapter } from './codex.js';
import { FakeAdapter, type FakeAdapterOptions } from './fake.js';
import { OllamaAdapter } from './ollama.js';
import { OpenAiCompatibleAdapter } from './openai-compat.js';
import { AgentsConfigError, type LlmAdapter, type Provider } from './types.js';

export interface CreateAdapterOptions {
  provider?: Provider | string;
  model?: string;
  /** Endpoint for the model server (ollama, vLLM, LM Studio, Azure …). */
  baseUrl?: string;
  /** `options.num_ctx` for local models, and the ceiling their prompts are measured against. */
  contextTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  fake?: FakeAdapterOptions;
  /** repo root, project and env let the CLI adapters start the sdods MCP server */
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
  if (p === 'ollama' || p === 'local') return 'ollama';
  if (
    p === 'openai' ||
    p === 'openai-compatible' ||
    p === 'azure' ||
    p === 'vllm' ||
    p === 'lmstudio'
  )
    return 'openai-compatible';
  if (p === 'fake' || p === 'dry-run') return 'fake';
  throw new AgentsConfigError(
    `Unknown LLM provider "${raw}".`,
    'Use claude, claude-code, codex, openai-compatible, ollama or fake.',
  );
}

/**
 * Detection order when nothing is set explicitly:
 * ANTHROPIC_API_KEY → `claude` CLI → `codex` CLI → OPENAI_API_KEY → Ollama → fake.
 *
 * A key or a CLI login is a deliberate statement of intent, so those come first; an installed
 * Ollama still beats `fake`, which produces nothing. Detection is synchronous and must not touch
 * the network, so it looks for `OLLAMA_HOST` or the binary; `detectProviderAsync` additionally
 * probes the default host for callers that can await.
 */
export function detectProvider(env: NodeJS.ProcessEnv = process.env): {
  provider: Provider;
  reason: string;
} {
  if (env.ANTHROPIC_API_KEY) return { provider: 'claude', reason: 'ANTHROPIC_API_KEY is set' };
  if (findOnPath('claude')) return { provider: 'claude-code', reason: 'claude CLI found on PATH' };
  if (findOnPath('codex')) return { provider: 'codex', reason: 'codex CLI found on PATH' };
  if (env.OPENAI_API_KEY) return { provider: 'openai-compatible', reason: 'OPENAI_API_KEY is set' };
  if (env.OLLAMA_HOST) return { provider: 'ollama', reason: 'OLLAMA_HOST is set' };
  if (findOnPath('ollama')) return { provider: 'ollama', reason: 'ollama found on PATH' };
  return {
    provider: 'fake',
    reason: 'no API key and no claude/codex CLI found; using the fake adapter',
  };
}

/** Detection plus a short probe of the default Ollama host, for callers that can await. */
export async function detectProviderAsync(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ provider: Provider; reason: string }> {
  const sync = detectProvider(env);
  if (sync.provider !== 'fake') return sync;
  if (await OllamaAdapter.reachable())
    return { provider: 'ollama', reason: 'a local Ollama server answered' };
  return sync;
}

export function resolveProvider(
  explicit?: string,
  projectDefault?: string,
  onAutoDetect?: (provider: Provider, reason: string) => void,
): Provider {
  const chosen = explicit ?? process.env.SDODS_LLM_PROVIDER ?? projectDefault;
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
      return new OpenAiCompatibleAdapter({
        model: opts.model,
        baseUrl: opts.baseUrl,
        temperature: opts.temperature,
        timeoutMs: opts.timeoutMs,
      });
    case 'ollama':
      return new OllamaAdapter({
        model: opts.model,
        baseUrl: opts.baseUrl,
        contextTokens: opts.contextTokens,
        temperature: opts.temperature,
        timeoutMs: opts.timeoutMs,
      });
    case 'fake':
      return new FakeAdapter(opts.fake);
  }
}
