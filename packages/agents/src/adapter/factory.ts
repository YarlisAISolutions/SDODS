import { ClaudeAdapter } from './claude.js';
import { FakeAdapter, type FakeAdapterOptions } from './fake.js';
import { OpenAiCompatibleAdapter } from './openai-compat.js';
import { AgentsConfigError, type LlmAdapter, type Provider } from './types.js';

export interface CreateAdapterOptions {
  provider?: Provider | string;
  model?: string;
  fake?: FakeAdapterOptions;
}

export function resolveProvider(explicit?: string, projectDefault?: string): Provider {
  const p = (
    explicit ??
    process.env.AUTOMAX_LLM_PROVIDER ??
    projectDefault ??
    'claude'
  ).toLowerCase();
  if (p === 'claude' || p === 'anthropic') return 'claude';
  if (p === 'openai' || p === 'openai-compatible' || p === 'ollama' || p === 'azure')
    return 'openai-compatible';
  if (p === 'fake' || p === 'dry-run') return 'fake';
  throw new AgentsConfigError(
    `Unknown LLM provider "${explicit}".`,
    'Use claude, openai-compatible or fake.',
  );
}

export function createAdapter(
  opts: CreateAdapterOptions = {},
  projectDefault?: string,
): LlmAdapter {
  const provider = resolveProvider(opts.provider, projectDefault);
  switch (provider) {
    case 'claude':
      return new ClaudeAdapter({ model: opts.model });
    case 'openai-compatible':
      return new OpenAiCompatibleAdapter({ model: opts.model });
    case 'fake':
      return new FakeAdapter(opts.fake);
  }
}
