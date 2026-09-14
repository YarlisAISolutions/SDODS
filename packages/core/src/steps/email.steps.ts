import { expect, type Page } from '@playwright/test';
import type { EnvConfig, MailConfig } from '@sdods/contracts';
import './params.js';
import { BeforeScenario, Then, When } from '../fixtures/test.js';
import { renderStrict } from '../api/template.js';
import { SdodsError } from '../errors.js';
import { createMailInbox } from '../mail/index.js';
import {
  extractLinks,
  findCode,
  findLinkMatching,
  findLinkNamed,
  readableText,
} from '../mail/extract.js';
import type { MailInbox, MailMessage, MailSummary } from '../mail/types.js';

/**
 * Email assertions over a mail catcher (Mailpit), for the funnels that go through an inbox:
 * signup verification, invitations, password reset, emailed 2FA codes.
 *
 * WHY — without these a scenario can assert "check your inbox" on screen and nothing about
 * whether a message was sent, to whom, or whether its link works. That is a whole funnel the suite
 * cannot reach, and every page behind the link is unreachable with it.
 *
 * WHAT "LATEST" MEANS — scenarios must not see each other's mail, so the inbox is scoped:
 *   - only messages received after the scenario started, or after the last
 *     `I clear the inbox for` that address in this scenario, count at all;
 *   - `the inbox for X should receive an email with subject containing S` PINS the message it
 *     matched, and every later "latest email to X" step reads that message. A signup that sends
 *     "Welcome" and "Verify your email" in either order still gives the verify link;
 *   - with nothing pinned, "latest" is the newest message to X in scope, waited for up to
 *     `mail.timeoutSeconds`.
 * The start time comes from the runner's clock and `receivedAt` from Mailpit's, so the window opens
 * `mail.clockSkewMs` early. The strongest isolation is still a unique address per scenario
 * (`{{email}}` from a factory); a fixed address wants `I clear the inbox for` first.
 *
 * Polled with a deadline, never slept: a step returns as soon as the message is there.
 */

type Vars = { vars: { toObject(): Record<string, unknown>; set(k: string, v: unknown): void } };
type Fx = { apiContext: Vars; env: Pick<EnvConfig, 'vars' | 'mail'> };

interface MailState {
  /** Epoch ms the scenario started. */
  since: number;
  /** address → epoch ms of the last clear in this scenario. */
  cleared: Map<string, number>;
  /** address → id of the message the last "should receive" step matched. */
  pinned: Map<string, string>;
}

// Keyed by the per-scenario ApiContext, so state never outlives or crosses a scenario.
const states = new WeakMap<object, MailState>();

function stateFor(apiContext: object): MailState {
  let s = states.get(apiContext);
  if (!s) {
    s = { since: Date.now(), cleared: new Map(), pinned: new Map() };
    states.set(apiContext, s);
  }
  return s;
}

/**
 * Opens the window when the scenario starts rather than at the first email step: in the typical
 * flow the application sends the message during a UI step, before any email step has run.
 */
BeforeScenario({ name: 'sdods:mail:window' }, async ({ apiContext }) => {
  stateFor(apiContext);
});

function requireMail(env: Fx['env']): MailConfig {
  if (!env.mail) {
    throw new SdodsError(
      'MAIL_REQUIRED',
      'This scenario reads email but no mail catcher is configured.',
      {
        hint: 'Declare `mail: { provider: mailpit, url: http://localhost:8025 }` in the environment yaml, and point the application under test at the same Mailpit for SMTP (port 1025 by default).',
        docsPath: '/docs/reference/env-yaml',
      },
    );
  }
  return {
    provider: env.mail.provider ?? 'mailpit',
    url: env.mail.url,
    auth: env.mail.auth,
    pollIntervalMs: env.mail.pollIntervalMs ?? 1000,
    clockSkewMs: env.mail.clockSkewMs ?? 2000,
    timeoutSeconds: env.mail.timeoutSeconds ?? 15,
  };
}

const scopesOf = ({ apiContext, env }: Fx) => [apiContext.vars.toObject(), env.vars];
const arg = (fx: Fx, value: string) => renderStrict(value, ...scopesOf(fx));
const addressArg = (fx: Fx, value: string) => arg(fx, value).trim().toLowerCase();

function windowStart(fx: Fx, config: MailConfig, address: string): Date {
  const s = stateFor(fx.apiContext);
  return new Date(Math.max(s.since, s.cleared.get(address) ?? 0) - config.clockSkewMs);
}

/** Search until something matches or the deadline passes; `[]` on timeout. */
async function pollSearch(
  inbox: MailInbox,
  query: Parameters<MailInbox['search']>[0],
  timeoutMs: number,
  intervalMs: number,
): Promise<MailSummary[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await inbox.search(query);
    if (found.length > 0) return found;
    const left = deadline - Date.now();
    if (left <= 0) return [];
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, left)));
  }
}

function describeSeen(seen: MailSummary[]): string {
  if (seen.length === 0) return 'No email at all reached that address in this scenario.';
  const list = seen
    .slice(0, 10)
    .map((m) => `  - "${m.subject}" from ${m.from.address} at ${m.receivedAt.toISOString()}`)
    .join('\n');
  return `Emails that did reach it in this scenario (newest first):\n${list}`;
}

/** The message "the latest email to <address>" refers to. See the header for the rules. */
async function latestEmail(fx: Fx, rawAddress: string): Promise<MailMessage> {
  const config = requireMail(fx.env);
  const inbox = createMailInbox(config);
  const address = addressArg(fx, rawAddress);
  const pinned = stateFor(fx.apiContext).pinned.get(address);
  if (pinned) return inbox.get(pinned);
  const since = windowStart(fx, config, address);
  const found = await pollSearch(
    inbox,
    { to: address, since },
    config.timeoutSeconds * 1000,
    config.pollIntervalMs,
  );
  if (found.length === 0) {
    throw new SdodsError(
      'MAIL_NOT_RECEIVED',
      `No email to ${address} arrived within ${config.timeoutSeconds} s.`,
      {
        hint: 'Only mail received after the scenario started (or after `I clear the inbox for` that address) counts. Check that the application sends SMTP to the Mailpit in `mail.url`, or wait explicitly with `the inbox for … should receive an email with subject containing … within … seconds`.',
        details: { address, since: since.toISOString(), mailpit: config.url },
      },
    );
  }
  return inbox.get(found[0]!.id);
}

When('I clear the inbox for {string}', async ({ apiContext, env }, rawAddress: string) => {
  const fx = { apiContext, env } as Fx;
  const config = requireMail(env);
  const address = addressArg(fx, rawAddress);
  await createMailInbox(config).clear(address);
  const s = stateFor(apiContext);
  s.cleared.set(address, Date.now());
  s.pinned.delete(address);
});

Then(
  'the inbox for {string} should receive an email with subject containing {string} within {int} seconds',
  async ({ apiContext, env }, rawAddress: string, rawSubject: string, seconds: number) => {
    const fx = { apiContext, env } as Fx;
    const config = requireMail(env);
    const inbox = createMailInbox(config);
    const address = addressArg(fx, rawAddress);
    const subject = arg(fx, rawSubject);
    const since = windowStart(fx, config, address);
    const found = await pollSearch(
      inbox,
      { to: address, subjectContains: subject, since },
      seconds * 1000,
      config.pollIntervalMs,
    );
    if (found.length === 0) {
      // "Nothing arrived" and "something with the wrong subject arrived" are different bugs, so
      // the failure says which one this is.
      const seen = await inbox.search({ to: address, since });
      throw new SdodsError(
        'MAIL_NOT_RECEIVED',
        `No email to ${address} with subject containing "${subject}" arrived within ${seconds} s.\n${describeSeen(seen)}`,
        {
          hint: 'The subject match is a case-sensitive substring. Only mail received after the scenario started (or after `I clear the inbox for` that address) counts; check that the application sends SMTP to the Mailpit in `mail.url`.',
          details: {
            address,
            subject,
            since: since.toISOString(),
            seen: seen.map((m) => ({
              subject: m.subject,
              from: m.from.address,
              receivedAt: m.receivedAt.toISOString(),
            })),
          },
        },
      );
    }
    stateFor(apiContext).pinned.set(address, found[0]!.id);
  },
);

Then(
  'the latest email to {string} should contain the text {string}',
  async ({ apiContext, env }, rawAddress: string, rawText: string) => {
    const fx = { apiContext, env } as Fx;
    const message = await latestEmail(fx, rawAddress);
    const needle = arg(fx, rawText);
    expect(
      readableText(message),
      `the latest email to ${message.to.map((t) => t.address).join(', ')} ("${message.subject}")`,
    ).toContain(needle);
  },
);

Then(
  'the latest email to {string} should have been sent from {string}',
  async ({ apiContext, env }, rawAddress: string, rawFrom: string) => {
    const fx = { apiContext, env } as Fx;
    const message = await latestEmail(fx, rawAddress);
    const wanted = arg(fx, rawFrom).trim();
    const { name, address } = message.from;
    const candidates = [address, name, `${name} <${address}>`].map((s) => s.toLowerCase());
    if (!candidates.includes(wanted.toLowerCase())) {
      expect(
        name ? `${name} <${address}>` : address,
        `sender of "${message.subject}" (compare the address, the display name, or "Name <address>")`,
      ).toBe(wanted);
    }
  },
);

When(
  'I save the link matching {string} from the latest email to {string} as {string}',
  async ({ apiContext, env }, rawPattern: string, rawAddress: string, name: string) => {
    const fx = { apiContext, env } as Fx;
    const message = await latestEmail(fx, rawAddress);
    const pattern = arg(fx, rawPattern);
    const link = findLinkMatching(message, pattern);
    if (!link) throw noLink(message, `matching ${pattern}`);
    // `name` is the variable being written, an identifier rather than a template.
    apiContext.vars.set(name, link.href);
  },
);

When(
  'I save the code matching {string} from the latest email to {string} as {string}',
  async ({ apiContext, env }, rawPattern: string, rawAddress: string, name: string) => {
    const fx = { apiContext, env } as Fx;
    const message = await latestEmail(fx, rawAddress);
    const pattern = arg(fx, rawPattern);
    const code = findCode(message, pattern);
    if (code === undefined) {
      throw new SdodsError('RUN_FAILED', `Nothing in "${message.subject}" matches ${pattern}.`, {
        hint: 'The pattern is a regular expression over the text part (or the HTML part rendered to text). With a capture group, group 1 is saved: `code: (\\d{6})`.',
        details: { subject: message.subject, text: readableText(message).slice(0, 1000) },
      });
    }
    apiContext.vars.set(name, code);
  },
);

When(
  'I open the link {string} from the latest email to {string}',
  async ({ apiContext, env, page }, rawName: string, rawAddress: string) => {
    const fx = { apiContext, env } as Fx;
    const message = await latestEmail(fx, rawAddress);
    const name = arg(fx, rawName);
    const link = findLinkNamed(message, name);
    if (!link) throw noLink(message, `named "${name}"`);
    await (page as Page).goto(link.href, { waitUntil: 'domcontentloaded' });
  },
);

function noLink(message: MailMessage, what: string): SdodsError {
  const links = extractLinks(message);
  return new SdodsError('RUN_FAILED', `No link ${what} in "${message.subject}".`, {
    hint: links.length
      ? `Links in that email:\n${links.map((l) => `  - ${l.text ? `"${l.text}" ` : ''}${l.href}`).join('\n')}`
      : 'That email has no links at all: no <a href> in the HTML part and no http(s) URL in the text part.',
    details: { subject: message.subject, links },
  });
}
