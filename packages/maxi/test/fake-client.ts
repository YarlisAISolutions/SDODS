import type Anthropic from '@anthropic-ai/sdk';

/** One scripted reply from the fake model. */
export interface Turn {
  text?: string;
  tool?: { name: string; input: Record<string, unknown> };
  stop?: Anthropic.StopReason;
  usage?: Partial<Anthropic.Usage>;
  /** Throw this instead of replying. */
  error?: Error;
}

/**
 * Stands in for `client.messages.stream`: replays scripted turns as stream events and records
 * every request, so tests can assert on what Maxi sent without calling the API.
 */
export function fakeClient(turns: Turn[]) {
  const requests: Anthropic.MessageCreateParams[] = [];
  let i = 0;
  const client = {
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params));
        const turn = turns[i++] ?? { text: 'out of script' };
        const content: Anthropic.ContentBlock[] = [];
        const events: Anthropic.RawMessageStreamEvent[] = [];
        if (turn.text) {
          content.push({ type: 'text', text: turn.text, citations: null } as Anthropic.TextBlock);
          events.push({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '', citations: null },
          } as Anthropic.RawMessageStreamEvent);
          for (const piece of turn.text.match(/.{1,5}/gs) ?? []) {
            events.push({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: piece },
            } as Anthropic.RawMessageStreamEvent);
          }
        }
        if (turn.tool) {
          const block = {
            type: 'tool_use',
            id: `toolu_${i}`,
            name: turn.tool.name,
            input: turn.tool.input,
          } as Anthropic.ToolUseBlock;
          content.push(block);
          events.push({
            type: 'content_block_start',
            index: content.length - 1,
            content_block: { ...block, input: {} },
          } as Anthropic.RawMessageStreamEvent);
        }
        const message = {
          id: `msg_${i}`,
          type: 'message',
          role: 'assistant',
          model: params.model,
          content,
          stop_reason: turn.stop ?? (turn.tool ? 'tool_use' : 'end_turn'),
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 1000,
            ...turn.usage,
          },
        } as unknown as Anthropic.Message;
        return {
          async *[Symbol.asyncIterator]() {
            if (turn.error) throw turn.error;
            for (const e of events) yield e;
          },
          async finalMessage() {
            if (turn.error) throw turn.error;
            return message;
          },
        };
      },
    },
  };
  return { client: client as unknown as Pick<Anthropic, 'messages'>, requests };
}
