import type { AgentSdkToolDef } from '@automax/mcp';

export type Provider = 'claude' | 'openai-compatible' | 'fake';

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
  model?: string;
  maxTurns?: number;
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

export const DEFAULT_MODELS: Record<Provider, string> = {
  claude: 'claude-opus-5',
  'openai-compatible': 'gpt-4.1',
  fake: 'fake-model',
};
