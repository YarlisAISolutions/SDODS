/**
 * Where Maxi keeps conversation logs and its daily spend counter.
 *
 * MaxiStore is the port; MemoryStore keeps both in the process (tests, local development, a
 * single-instance self-host). sdods.com's deployment uses the Firestore store in ./firebase/.
 *
 * Logs are anonymous by design: no IP address, no user agent, no account.
 */
export interface ChatLog {
  id: string;
  question: string;
  answer: string;
  /** Number of messages in the conversation, this answer included. */
  turns: number;
  model: string;
  corpusHash: string;
  page?: string;
  toolCalls: string[];
  stopReason: string;
  usage: UsageTotals;
  costUsd: number;
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export type Vote = 'up' | 'down';

export interface MaxiStore {
  saveChat(log: ChatLog): Promise<void>;
  /** Returns false when no conversation has that id. */
  vote(id: string, vote: Vote): Promise<boolean>;
  spentToday(day: string): Promise<number>;
  addSpend(day: string, usd: number): Promise<void>;
}

export class MemoryStore implements MaxiStore {
  readonly chats = new Map<string, ChatLog & { vote?: Vote }>();
  readonly spend = new Map<string, number>();

  async saveChat(log: ChatLog): Promise<void> {
    this.chats.set(log.id, { ...log });
  }
  async vote(id: string, vote: Vote): Promise<boolean> {
    const chat = this.chats.get(id);
    if (!chat) return false;
    chat.vote = vote;
    return true;
  }
  async spentToday(day: string): Promise<number> {
    return this.spend.get(day) ?? 0;
  }
  async addSpend(day: string, usd: number): Promise<void> {
    this.spend.set(day, (this.spend.get(day) ?? 0) + usd);
  }
}
