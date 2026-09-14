import { SdodsError } from '../errors.js';
import type { MailAddress, MailInbox, MailMessage, MailSearch, MailSummary } from './types.js';

export interface MailpitOptions {
  url: string;
  auth?: { type: 'basic'; username: string; password: string };
}

interface MailpitAddress {
  Name?: string;
  Address?: string;
}

interface MailpitSummary {
  ID: string;
  From?: MailpitAddress | null;
  To?: MailpitAddress[] | null;
  Subject?: string;
  Created?: string;
}

interface MailpitMessage extends MailpitSummary {
  Date?: string;
  Text?: string;
  HTML?: string;
}

/** Page size for search. Mailpit's own default is 50; a per-address inbox rarely comes close. */
const PAGE = 100;
/** A hard stop on pagination, so a runaway inbox fails loudly instead of paging forever. */
const MAX_PAGES = 50;

/**
 * Mailpit over its REST API (`/api/v1`).
 *
 * The server-side query is only `to:"<address>"`. Mailpit's `to:` is a substring match and its
 * `subject:` is word-tokenised rather than a substring, so both are narrowed here, where the
 * semantics are the ones the step text promises.
 */
export class MailpitInbox implements MailInbox {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(opts: MailpitOptions) {
    this.base = opts.url.replace(/\/+$/, '');
    this.headers = { accept: 'application/json' };
    if (opts.auth) {
      const token = Buffer.from(`${opts.auth.username}:${opts.auth.password}`).toString('base64');
      this.headers.authorization = `Basic ${token}`;
    }
  }

  async clear(address: string): Promise<void> {
    const ids = (await this.search({ to: address })).map((m) => m.id);
    if (ids.length === 0) return;
    // By ID rather than `DELETE /api/v1/search?query=to:"…"`: that query is a substring match
    // and would also delete another scenario's mail to `b${address}`.
    await this.call('DELETE', '/api/v1/messages', { IDs: ids });
  }

  async search(query: MailSearch): Promise<MailSummary[]> {
    const wanted = query.to.trim().toLowerCase();
    const q = `to:"${wanted.replace(/"/g, '')}"`;
    const out: MailSummary[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        query: q,
        start: String(page * PAGE),
        limit: String(PAGE),
      });
      const body = (await this.call('GET', `/api/v1/search?${params}`)) as {
        messages?: MailpitSummary[];
        messages_count?: number;
        total?: number;
      };
      const messages = body.messages ?? [];
      for (const m of messages) {
        const summary = toSummary(m);
        if (!summary.to.some((t) => t.address.toLowerCase() === wanted)) continue;
        if (query.since && summary.receivedAt.getTime() < query.since.getTime()) continue;
        if (
          query.subjectContains !== undefined &&
          !summary.subject.includes(query.subjectContains)
        ) {
          continue;
        }
        out.push(summary);
      }
      // Newest first: once a page ends before `since`, every later page is older still.
      const oldest = messages.at(-1);
      if (messages.length < PAGE) break;
      if (query.since && oldest && toDate(oldest.Created).getTime() < query.since.getTime()) break;
    }
    return out.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  }

  async get(id: string): Promise<MailMessage> {
    const m = (await this.call(
      'GET',
      `/api/v1/message/${encodeURIComponent(id)}`,
    )) as MailpitMessage;
    return { ...toSummary(m), text: m.Text ?? '', html: m.HTML ?? '' };
  }

  private async call(method: string, path: string, json?: unknown): Promise<unknown> {
    const url = `${this.base}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers:
          json === undefined
            ? this.headers
            : { ...this.headers, 'content-type': 'application/json' },
        body: json === undefined ? undefined : JSON.stringify(json),
      });
    } catch (e) {
      throw new SdodsError('MAIL_REQUIRED', `Could not reach Mailpit at ${this.base}.`, {
        hint: 'Start Mailpit (for example `docker run -p 8025:8025 -p 1025:1025 axllent/mailpit`) and check `mail.url` in the environment yaml. The application under test must send its SMTP mail to the same Mailpit.',
        cause: e,
        details: { url, method },
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SdodsError(
        'MAIL_REQUIRED',
        `Mailpit answered ${res.status} to ${method} ${path}.`,
        {
          hint:
            res.status === 401 || res.status === 403
              ? 'Mailpit is protected: set `mail.auth: { type: basic, username, password: ${VAR} }` in the environment yaml.'
              : 'Check that `mail.url` points at the Mailpit web/API port (8025 by default), not the SMTP port.',
          details: { url, method, status: res.status, body: text.slice(0, 500) },
        },
      );
    }
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}

function toAddress(a: MailpitAddress | null | undefined): MailAddress {
  return { name: a?.Name ?? '', address: a?.Address ?? '' };
}

function toDate(s: string | undefined): Date {
  const d = s ? new Date(s) : new Date(0);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function toSummary(m: MailpitSummary): MailSummary {
  return {
    id: m.ID,
    from: toAddress(m.From),
    to: (m.To ?? []).map(toAddress),
    subject: m.Subject ?? '',
    receivedAt: toDate(m.Created),
  };
}
