import { createServer, type IncomingMessage, type Server } from 'node:http';
import { expect } from '@playwright/test';
import './params.js';
import { AfterScenario, Given, Then, When } from '../fixtures/test.js';
import { render } from '../api/template.js';
import { SdodsError } from '../errors.js';

/**
 * An ephemeral callback receiver, for the leg where the application calls BACK.
 *
 * WHY — 16 trigger providers deliver by webhook. Without a receiver a suite can
 * assert that a subscription was created and nothing about whether a delivery
 * ever arrived, which is the half that actually matters: a trigger that
 * registers and never fires looks identical to a working one.
 *
 * DESIGN — the server binds to an EPHEMERAL port on 127.0.0.1 and its URL is
 * published into the scenario's template scope as `{{callback.url}}`, so the
 * scenario never hardcodes a port. It is torn down at scenario end even when
 * the scenario fails; a leaked listener silently poisons the next run on the
 * same worker, and that is the kind of failure nobody traces back.
 *
 * Deliveries are recorded in arrival order and asserted by POLLING, never by
 * sleeping. "Wait two seconds then check" is how a webhook suite becomes both
 * slow and flaky at the same time.
 *
 * NOT a public tunnel. This receives from an application that can reach the
 * runner — a local or in-VPC app under test. Reaching a hosted staging
 * deployment needs a tunnel, which is an infrastructure decision rather than
 * something a step library should quietly stand up.
 */

export interface Delivery {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  receivedAt: number;
}

export interface Receiver {
  server: Server;
  url: string;
  deliveries: Delivery[];
}

const receivers = new Map<string, Receiver>();

function key(apiContext: unknown): string {
  return String((apiContext as { runId?: string }).runId ?? 'default');
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function requireReceiver(k: string): Receiver {
  const r = receivers.get(k);
  if (!r) {
    throw new SdodsError('NOT_SUPPORTED', 'No callback receiver is listening.', {
      hint: 'Use `Given a callback receiver is listening` first; its URL is available as {{callback.url}}.',
    });
  }
  return r;
}

/**
 * Extracted from the step so the receiver itself is testable without a browser,
 * a config or a Playwright runner. It is the most intricate piece here — an
 * HTTP server, async body reading and a shared array — and "it worked when I
 * tried it" is not a claim anyone can re-check later.
 */
export async function startReceiver(): Promise<Receiver> {
  const deliveries: Delivery[] = [];
  const server = createServer((req, res) => {
    void readBody(req).then((body) => {
      deliveries.push({
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([h, v]) => [
            h,
            Array.isArray(v) ? v.join(', ') : (v ?? ''),
          ]),
        ),
        body,
        receivedAt: Date.now(),
      });
      // 200 with an empty body: a provider that retries on a non-2xx would
      // otherwise deliver the same event repeatedly and the counts below would
      // be meaningless.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new SdodsError('INTERNAL', 'The callback receiver did not report a port.');
  }
  return { server, url: `http://127.0.0.1:${address.port}`, deliveries };
}

Given('a callback receiver is listening', async ({ apiContext }) => {
  const k = key(apiContext);
  if (receivers.has(k)) return;
  const receiver = await startReceiver();
  receivers.set(k, receiver);
  // Published as a scope value so the scenario writes {{callback.url}} rather
  // than a port it cannot know.
  (apiContext as { vars: { set(k: string, v: unknown): void } }).vars.set('callback', {
    url: receiver.url,
  });
});

When('I stop the callback receiver', async ({ apiContext }) => {
  const k = key(apiContext);
  const r = receivers.get(k);
  if (!r) return;
  await new Promise<void>((resolve) => r.server.close(() => resolve()));
  receivers.delete(k);
});

Then(
  'the callback receiver should receive {int} delivery/deliveries',
  async ({ apiContext }, count: number) => {
    const r = requireReceiver(key(apiContext));
    await expect
      .poll(() => r.deliveries.length, {
        message: `expected ${count} callback delivery/deliveries`,
      })
      .toBe(count);
  },
);

Then('the callback receiver should receive a delivery', async ({ apiContext }) => {
  const r = requireReceiver(key(apiContext));
  await expect
    .poll(() => r.deliveries.length, { message: 'no callback delivery arrived' })
    .toBeGreaterThan(0);
});

Then(
  'the callback receiver should receive a delivery containing {string}',
  async ({ apiContext, env }, text: string) => {
    const r = requireReceiver(key(apiContext));
    const needle = render(
      text,
      (apiContext as { vars: { toObject(): Record<string, unknown> } }).vars.toObject(),
      env.vars,
    );
    await expect
      .poll(() => r.deliveries.some((d) => d.body.includes(needle)), {
        message: `no callback delivery contained "${needle}"`,
      })
      .toBe(true);
  },
);

Then(
  'the last callback delivery should have the header {string} set to {string}',
  async ({ apiContext, env }, header: string, value: string) => {
    const r = requireReceiver(key(apiContext));
    await expect
      .poll(() => r.deliveries.length, { message: 'no callback delivery arrived' })
      .toBeGreaterThan(0);
    const scopes = [
      (apiContext as { vars: { toObject(): Record<string, unknown> } }).vars.toObject(),
      env.vars,
    ];
    const last = r.deliveries[r.deliveries.length - 1]!;
    expect(last.headers[render(header, ...scopes).toLowerCase()]).toBe(render(value, ...scopes));
  },
);

/**
 * Torn down after EVERY scenario, including a failing one — hence a hook rather
 * than a step. A leaked listener silently poisons the next scenario on the same
 * worker, and that is a failure nobody traces back to the scenario that leaked.
 */
AfterScenario(async () => {
  await closeAllReceivers();
});

export async function closeAllReceivers(): Promise<void> {
  for (const [k, r] of receivers) {
    await new Promise<void>((resolve) => r.server.close(() => resolve()));
    receivers.delete(k);
  }
}
