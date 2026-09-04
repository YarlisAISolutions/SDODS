import type { AgentSdkToolDef } from '@sdods/mcp';

/**
 * claude / openai-compatible: API keys. claude-code / codex: shell out to the user's logged-in
 * CLI (no key needed). ollama: a model running on this machine, no key and no cost.
 * fake: scripted, for tests and --dry-run.
 */
export type Provider = 'claude' | 'claude-code' | 'codex' | 'openai-compatible' | 'ollama' | 'fake';

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: unknown; isError?: boolean }
  | { type: 'status'; message: string }
  | {
      type: 'result';
      costUsd?: number;
      usage?: TokenUsage;
      turns: number;
      stopReason: string;
      isError?: boolean;
    };

export interface ExternalMcpServerConfig {
  transport?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  allowedTools?: string[];
}

export interface CompleteRequest {
  system?: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** JSON schema the answer must satisfy, where the provider can enforce one. */
  responseSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface CompleteResult {
  text: string;
  usage?: TokenUsage;
  costUsd?: number;
  model?: string;
}

export interface RunAgentOptions {
  system: string;
  prompt: string;
  tools: AgentSdkToolDef[];
  mcpServers?: Record<string, ExternalMcpServerConfig>;
  /** The role wants to look at the application, so a browser server should be attached. */
  needsBrowser?: boolean;
  model?: string;
  maxTurns?: number;
  /** Cap on one assistant turn; local models otherwise ramble until the context ends. */
  maxTokens?: number;
  maxBudgetUsd?: number;
  cwd?: string;
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
}

export interface RunAgentResult {
  text: string;
  costUsd?: number;
  usage?: TokenUsage;
  turns: number;
  stopReason: string;
  isError?: boolean;
  toolCalls: number;
}

export interface LlmAdapter {
  readonly provider: Provider;
  readonly defaultModel: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
  stream(req: CompleteRequest): AsyncIterable<string>;
  runAgent(opts: RunAgentOptions): Promise<RunAgentResult>;
}

export class AgentsConfigError extends Error {
  readonly code = 'AGENTS_CONFIG';
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'AgentsConfigError';
  }
}

/** `default` means "let the CLI pick its configured model" (claude-code, codex). */
export const DEFAULT_MODELS: Record<Provider, string> = {
  claude: 'claude-opus-5',
  'claude-code': 'default',
  codex: 'default',
  'openai-compatible': 'gpt-4.1',
  // Small enough to run on a laptop, and the best of that size at tool calls and structured output.
  ollama: 'qwen2.5-coder:7b',
  fake: 'fake-model',
};
