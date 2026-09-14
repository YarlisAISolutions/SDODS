import Anthropic from '@anthropic-ai/sdk';
import type { UsageTotals } from './store.js';
import { runTool, TOOLS, type StepCatalog } from './tools.js';

/** Events streamed to the browser. */
export type ChatEvent =
  | { event: 'text'; data: { text: string } }
  | { event: 'tool'; data: { name: string } }
  | { event: 'done'; data: { id: string; stopReason: string } }
  | { event: 'error'; data: { message: string; retryable: boolean } };

export interface ChatResult {
  answer: string;
  stopReason: string;
  toolCalls: string[];
  usage: UsageTotals;
  /** False when no request to Claude completed, so there is nothing to bill or log. */
  completed: boolean;
}

export interface ChatDeps {
  client: Pick<Anthropic, 'messages'>;
  model: string;
  maxTokens: number;
  system: Anthropic.TextBlockParam[];
  catalog: StepCatalog;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/** find_steps and validate_feature a few times each is plenty; past that, make Claude answer. */
export const MAX_TOOL_ROUNDS = 6;

const REFUSAL_TEXT =
  "I can't help with that one. I'm happy to help with installing SDODS, setting up a project or writing tests.";
const MAX_TOKENS_TEXT = '\n\n_(I ran out of room there. Ask me to continue.)_';

export function withPage(
  messages: Anthropic.MessageParam[],
  page?: string,
): Anthropic.MessageParam[] {
  if (!page) return messages;
  const last = messages[messages.length - 1]!;
  const text = typeof last.content === 'string' ? last.content : '';
  return [
    ...messages.slice(0, -1),
    {
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'text', text: `<page>${page}</page>` },
      ],
    },
  ];
}

function friendlyError(e: unknown): { message: string; retryable: boolean } {
  if (e instanceof Anthropic.RateLimitError)
    return {
      message: 'Lots of people are asking Maxi things right now. Try again in a minute.',
      retryable: true,
    };
  if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError)
    return {
      message: 'Maxi could not reach its model just now. Try again in a moment.',
      retryable: true,
    };
  if (e instanceof Anthropic.APIError && e.status === 529)
    return { message: 'Maxi is overloaded right now. Try again in a minute.', retryable: true };
  return {
    message: 'Something went wrong on Maxi’s side. Try again, or ask on the community Q&A.',
    retryable: false,
  };
}

/**
 * One visitor turn: streams Claude's reply, runs tool calls in between, and reports the result
 * through `onComplete` for logging and the spend counter.
 */
export async function* runChat(
  deps: ChatDeps,
  id: string,
  messages: Anthropic.MessageParam[],
  opts: { page?: string; signal?: AbortSignal; onComplete?: (r: ChatResult) => void },
): AsyncGenerator<ChatEvent> {
  const convo = withPage(messages, opts.page);
  const result: ChatResult = {
    answer: '',
    stopReason: 'error',
    toolCalls: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    completed: false,
  };
  const emit = (text: string): ChatEvent => {
    result.answer += text;
    return { event: 'text', data: { text } };
  };

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const stream = deps.client.messages.stream(
        {
          model: deps.model,
          max_tokens: deps.maxTokens,
          system: deps.system,
          tools: TOOLS,
          // The last round may not call tools, so a loop between tools and Claude always ends.
          ...(round === MAX_TOOL_ROUNDS ? { tool_choice: { type: 'none' as const } } : {}),
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low' },
          messages: convo,
        },
        { signal: opts.signal },
      );

      // Text before a tool call and text after it belong to different paragraphs.
      let separate = result.answer.length > 0 && !result.answer.endsWith('\n');
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          if (separate) {
            yield emit('\n\n');
            separate = false;
          }
          yield emit(event.delta.text);
        } else if (
          event.type === 'content_block_start' &&
          event.content_block.type === 'tool_use'
        ) {
          yield { event: 'tool', data: { name: event.content_block.name } };
        }
      }

      const message = await stream.finalMessage();
      result.completed = true;
      result.stopReason = message.stop_reason ?? 'unknown';
      const u = message.usage;
      result.usage.input_tokens += u.input_tokens;
      result.usage.output_tokens += u.output_tokens;
      result.usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
      result.usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;

      if (message.stop_reason === 'tool_use') {
        convo.push({ role: 'assistant', content: message.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of message.content) {
          if (block.type !== 'tool_use') continue;
          result.toolCalls.push(block.name);
          const { content, isError } = runTool(block.name, block.input, deps.catalog);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content,
            is_error: isError,
          });
        }
        convo.push({ role: 'user', content: toolResults });
        continue;
      }
      if (message.stop_reason === 'pause_turn') {
        convo.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (message.stop_reason === 'refusal')
        yield emit(result.answer ? `\n\n${REFUSAL_TEXT}` : REFUSAL_TEXT);
      if (message.stop_reason === 'max_tokens') yield emit(MAX_TOKENS_TEXT);
      break;
    }
    yield { event: 'done', data: { id, stopReason: result.stopReason } };
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError || opts.signal?.aborted) {
      result.stopReason = 'aborted';
      return;
    }
    deps.log?.('chat failed', {
      error: (e as Error).message,
      status: (e as { status?: number }).status,
    });
    yield { event: 'error', data: friendlyError(e) };
  } finally {
    opts.onComplete?.(result);
  }
}
