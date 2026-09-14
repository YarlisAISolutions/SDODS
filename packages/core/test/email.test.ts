import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EnvConfigSchema } from '@sdods/contracts';
import { ApiContext } from '../src/fixtures/api-context.js';
import { isSdodsError } from '../src/errors.js';
import {
  extractLinks,
  findCode,
  findLinkMatching,
  findLinkNamed,
  htmlToText,
  MailpitInbox,
} from '../src/mail/index.js';
import '../src/steps/email.steps.js';

/**
 * The adapter and the REAL registered step functions against a fake Mailpit: a node:http server
 * that speaks the slice of `/api/v1` the adapter uses, including Mailpit's substring `to:` search,
 * so the exact-address narrowing is tested against the behaviour that makes it necessary.
 */

const require_ = createRequire(import.meta.url);
const registryPath = require_
  .resolve('playwright-bdd')
  .replace(/index\.js$/, 'steps/stepRegistry.js');
const { stepDefinitions } = require_(registryPath) as {
  stepDefinitions: Array<{ pattern: unknown; fn: (...a: any[]) => unknown }>;
};

const PATTERNS = [
  'I clear the inbox for {string}',
  'the inbox for {string} should receive an email with subject containing {string} within {int} seconds',
  'the latest email to {string} should contain the text {string}',
  'the latest email to {string} should have been sent from {string}',
  'I save the link matching {string} from the latest email to {string} as {string}',
  'I save the code matching {string} from the latest email to {string} as {string}',
  'I open the link {string} from the latest email to {string}',
];

function step(pattern: string): (fx: any, ...args: any[]) => Promise<void> {
  const found = stepDefinitions.filter((d) => String(d.pattern) === pattern);
  expect(found, `definitions registered for "${pattern}"`).toHaveLength(1);
  return found[0]!.fn as (fx: any, ...args: any[]) => Promise<void>;
}

async function caught(promise: Promise<unknown>): Promise<any> {
  let err: unknown;
  await promise.catch((e) => {
    err = e;
  });
  expect(err, 'expected the step to throw').toBeDefined();
  return err;
}

/* ── fake Mailpit ─────────────────────────────────────────────────────── */

interface Fixture {
  ID: string;
  From: { Name: string; Address: string };
  To: Array<{ Name: string; Address: string }>;
  Subject: string;
  Created: string;
  Text: string;
  HTML: string;
}

const messages: Fixture[] = [];
const requests: Array<{ method: string; url: string; auth?: string; body?: string }> = [];
let requireAuth: string | undefined;
let server: Server;
let url: string;
let seq = 0;

function deliver(m: Partial<Fixture> & { to: string; subject: string }, ageMs = 0): Fixture {
  const fixture: Fixture = {
    ID: `msg-${++seq}`,
    From: m.From ?? { Name: 'Acme', Address: 'no-reply@acme.test' },
    To: [{ Name: '', Address: m.to }],
    Subject: m.subject,
    Created: new Date(Date.now() - ageMs).toISOString(),
    Text: m.Text ?? '',
    HTML: m.HTML ?? '',
  };
  messages.push(fixture);
  return fixture;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (requireAuth && req.headers.authorization !== requireAuth) return send(401, {});
      const u = new URL(req.url!, 'http://mailpit');
      if (req.method === 'GET' && u.pathname === '/api/v1/search') {
        // Like Mailpit: `to:` is a SUBSTRING match, results newest first, paginated.
        const needle = /to:"([^"]*)"/.exec(u.searchParams.get('query') ?? '')?.[1] ?? '';
        const start = Number(u.searchParams.get('start') ?? 0);
        const limit = Number(u.searchParams.get('limit') ?? 50);
        const hits = messages
          .filter((m) => m.To.some((t) => t.Address.toLowerCase().includes(needle)))
          .sort((a, b) => b.Created.localeCompare(a.Created));
        return send(200, {
          total: messages.length,
          messages_count: hits.length,
          start,
          messages: hits.slice(start, start + limit).map(({ Text: _t, HTML: _h, ...s }) => s),
        });
      }
      const one = /^\/api\/v1\/message\/([^/]+)$/.exec(u.pathname);
      if (req.method === 'GET' && one) {
        const m = messages.find((x) => x.ID === decodeURIComponent(one[1]!));
        if (!m) return send(404, {});
        // Mailpit's full Message has `Date` and no `Created`; only MessageSummary (search) has `Created`.
        const { Created, ...rest } = m;
        return send(200, { ...rest, Date: Created });
      }
      if (req.method === 'DELETE' && u.pathname === '/api/v1/messages') {
        const ids: string[] = JSON.parse(body || '{}').IDs ?? [];
        for (const id of ids) {
          const i = messages.findIndex((m) => m.ID === id);
          if (i >= 0) messages.splice(i, 1);
        }
        res.writeHead(200);
        return res.end('ok');
      }
      send(404, {});
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as { port: number };
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  messages.length = 0;
  requests.length = 0;
  requireAuth = undefined;
});

function fixtures(
  over: { mail?: Record<string, unknown> | null; vars?: Record<string, unknown> } = {},
) {
  const gotos: string[] = [];
  return {
    apiContext: new ApiContext(),
    env: {
      vars: over.vars ?? {},
      mail:
        over.mail === null
          ? undefined
          : {
              provider: 'mailpit',
              url,
              pollIntervalMs: 25,
              clockSkewMs: 1000,
              timeoutSeconds: 1,
              ...over.mail,
            },
    },
    page: {
      gotos,
      goto: async (to: string) => {
        gotos.push(to);
      },
    },
  } as any;
}

/* ── config ───────────────────────────────────────────────────────────── */

describe('env mail config', () => {
  const base = {
    name: 'staging',
    ui: { baseUrl: 'http://app.test' },
    api: { baseUrl: 'http://api.test' },
  };

  it('defaults provider, poll interval, skew and timeout', () => {
    const env = EnvConfigSchema.parse({ ...base, mail: { url: 'http://localhost:8025' } });
    expect(env.mail).toEqual({
      provider: 'mailpit',
      url: 'http://localhost:8025',
      pollIntervalMs: 1000,
      clockSkewMs: 2000,
      timeoutSeconds: 15,
    });
  });

  it('refuses a provider it has no adapter for', () => {
    expect(() =>
      EnvConfigSchema.parse({ ...base, mail: { provider: 'mailhog', url: 'http://x.test' } }),
    ).toThrow();
  });
});

/* ── adapter ──────────────────────────────────────────────────────────── */

describe('MailpitInbox', () => {
  it('narrows Mailpit’s substring to: search to the exact address, newest first', async () => {
    deliver({ to: 'ba@x.test', subject: 'someone else' });
    const older = deliver({ to: 'a@x.test', subject: 'first' }, 5_000);
    const newer = deliver({ to: 'A@x.test', subject: 'second' });
    const found = await new MailpitInbox({ url }).search({ to: 'a@x.test' });
    expect(found.map((m) => m.id)).toEqual([newer.ID, older.ID]);
    expect(found[0]!.receivedAt).toBeInstanceOf(Date);
  });

  it('filters by subject substring and by since', async () => {
    deliver({ to: 'a@x.test', subject: 'Verify your email' }, 60_000);
    const fresh = deliver({ to: 'a@x.test', subject: 'Verify your email' });
    deliver({ to: 'a@x.test', subject: 'Welcome' });
    const found = await new MailpitInbox({ url }).search({
      to: 'a@x.test',
      subjectContains: 'Verify',
      since: new Date(Date.now() - 10_000),
    });
    expect(found.map((m) => m.id)).toEqual([fresh.ID]);
  });

  it('gets a whole message with text and html', async () => {
    const m = deliver({ to: 'a@x.test', subject: 'Hi', Text: 'plain', HTML: '<p>rich</p>' });
    const got = await new MailpitInbox({ url }).get(m.ID);
    expect(got.receivedAt.toISOString()).toBe(m.Created);
    expect(got).toMatchObject({
      id: m.ID,
      subject: 'Hi',
      text: 'plain',
      html: '<p>rich</p>',
      from: { name: 'Acme', address: 'no-reply@acme.test' },
    });
  });

  it('clears by ID, leaving mail to an address that merely contains this one', async () => {
    deliver({ to: 'a@x.test', subject: 'mine' });
    const other = deliver({ to: 'ba@x.test', subject: 'not mine' });
    await new MailpitInbox({ url }).clear('a@x.test');
    expect(messages.map((m) => m.ID)).toEqual([other.ID]);
    const del = requests.find((r) => r.method === 'DELETE')!;
    expect(del.url).toBe('/api/v1/messages');
  });

  it('pages through a search larger than one page', async () => {
    for (let i = 0; i < 130; i++) deliver({ to: 'bulk@x.test', subject: `n${i}` }, i);
    const found = await new MailpitInbox({ url }).search({ to: 'bulk@x.test' });
    expect(found).toHaveLength(130);
    expect(requests.filter((r) => r.url.startsWith('/api/v1/search'))).toHaveLength(2);
  });

  it('sends basic auth', async () => {
    requireAuth = `Basic ${Buffer.from('qa:s3cret').toString('base64')}`;
    await expect(
      new MailpitInbox({ url, auth: { type: 'basic', username: 'qa', password: 's3cret' } }).search(
        {
          to: 'a@x.test',
        },
      ),
    ).resolves.toEqual([]);
    expect(requests[0]!.auth).toBe(requireAuth);
  });

  it('turns a 401 into MAIL_REQUIRED with an auth hint', async () => {
    requireAuth = 'Basic nope';
    const err = await caught(new MailpitInbox({ url }).search({ to: 'a@x.test' }));
    expect(isSdodsError(err)).toBe(true);
    expect(err.code).toBe('MAIL_REQUIRED');
    expect(err.hint).toContain('mail.auth');
  });

  it('turns an unreachable Mailpit into MAIL_REQUIRED', async () => {
    const err = await caught(
      new MailpitInbox({ url: 'http://127.0.0.1:1' }).search({ to: 'a@x.test' }),
    );
    expect(err.code).toBe('MAIL_REQUIRED');
    expect(err.message).toContain('Could not reach Mailpit');
  });
});

/* ── extraction ───────────────────────────────────────────────────────── */

describe('link and code extraction', () => {
  const html =
    '<html><head><style>a{color:red}</style></head><body>' +
    '<p>Hi Ann,</p><p><a class="btn" href="https://app.test/verify?token=abc&amp;email=ann%40x.test">Verify&nbsp;email</a></p>' +
    "<p><a href='mailto:help@acme.test'>Help</a> <a href=https://acme.test/privacy>Privacy</a></p>" +
    '<p>Your code is <b>482 913</b>.</p></body></html>';

  it('reads hrefs from the HTML part and decodes &amp;', () => {
    expect(extractLinks({ html, text: '' })).toEqual([
      { href: 'https://app.test/verify?token=abc&email=ann%40x.test', text: 'Verify email' },
      { href: 'https://acme.test/privacy', text: 'Privacy' },
    ]);
  });

  it('falls back to URLs in the text part, without trailing punctuation', () => {
    const text = 'Reset here: https://app.test/reset?t=1&u=2. Or (https://app.test/help).';
    expect(extractLinks({ html: '', text }).map((l) => l.href)).toEqual([
      'https://app.test/reset?t=1&u=2',
      'https://app.test/help',
    ]);
  });

  it('matches a link by regex over the href, or literally when the pattern is not a regex', () => {
    expect(findLinkMatching({ html, text: '' }, '/verify\\?token=\\w+')?.href).toContain(
      'token=abc',
    );
    expect(findLinkMatching({ html, text: '' }, 'https://app.test/verify?token=')?.href).toContain(
      'token=abc',
    );
    expect(findLinkMatching({ html, text: '' }, '/nope')).toBeUndefined();
  });

  it('finds a link by its visible name, then by href', () => {
    expect(findLinkNamed({ html, text: '' }, 'verify email')?.href).toContain('/verify');
    expect(findLinkNamed({ html, text: '' }, 'Verify')?.href).toContain('/verify');
    expect(findLinkNamed({ html, text: '' }, 'privacy')?.href).toBe('https://acme.test/privacy');
    expect(findLinkNamed({ html, text: '' }, 'acme.test/privacy')?.href).toBe(
      'https://acme.test/privacy',
    );
  });

  it('saves capture group 1 when there is one, else the whole match, from rendered HTML', () => {
    expect(findCode({ html, text: '' }, 'code is (\\d{3} \\d{3})')).toBe('482 913');
    expect(findCode({ html: '', text: 'OTP: 123456' }, '\\d{6}')).toBe('123456');
    expect(findCode({ html: '', text: 'none' }, '\\d{6}')).toBeUndefined();
  });

  it('renders HTML to text without scripts or styles', () => {
    expect(htmlToText('<style>x{}</style><p>a &amp; b</p><script>alert(1)</script>')).toBe('a & b');
  });
});

/* ── steps ────────────────────────────────────────────────────────────── */

describe('email.steps registration', () => {
  it('declares exactly the patterns the source file defines, each once', async () => {
    const src = readFileSync(new URL('../src/steps/email.steps.ts', import.meta.url), 'utf8');
    const declared = [...src.matchAll(/\b(?:Given|When|Then)\(\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)].map(
      (m) => m[1]!,
    );
    expect([...declared].sort()).toEqual([...PATTERNS].sort());
    for (const p of PATTERNS) step(p);
    await import('../src/steps/index.js');
    const counts = new Map<string, number>();
    for (const d of stepDefinitions)
      counts.set(String(d.pattern), (counts.get(String(d.pattern)) ?? 0) + 1);
    expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });
});

describe('email steps', () => {
  const receive = () => step(PATTERNS[1]!);
  const contains = () => step(PATTERNS[2]!);
  const sentFrom = () => step(PATTERNS[3]!);
  const saveLink = () => step(PATTERNS[4]!);
  const saveCode = () => step(PATTERNS[5]!);
  const openLink = () => step(PATTERNS[6]!);

  it('fails with MAIL_REQUIRED when the env has no mail block', async () => {
    const err = await caught(step(PATTERNS[0]!)(fixtures({ mail: null }), 'a@x.test'));
    expect(err.code).toBe('MAIL_REQUIRED');
    expect(err.hint).toContain('mail:');
  });

  it('waits for an email that arrives after the step starts, rendering {{vars}} in the address', async () => {
    const fx = fixtures({ vars: { email: 'ann+42@x.test' } });
    setTimeout(() => deliver({ to: 'ann+42@x.test', subject: 'Verify your email' }), 150);
    const started = Date.now();
    await receive()(fx, '{{email}}', 'Verify', 2);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('times out naming the subjects that did arrive', async () => {
    const fx = fixtures();
    deliver({ to: 'ann@x.test', subject: 'Welcome aboard' });
    const started = Date.now();
    const err = await caught(receive()(fx, 'ann@x.test', 'Verify', 1));
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    expect(err.code).toBe('MAIL_NOT_RECEIVED');
    expect(err.message).toContain(
      'No email to ann@x.test with subject containing "Verify" arrived within 1 s',
    );
    expect(err.message).toContain('"Welcome aboard" from no-reply@acme.test');
    expect(err.details.seen).toHaveLength(1);
  });

  it('times out saying nothing arrived at all', async () => {
    const err = await caught(receive()(fixtures(), 'nobody@x.test', 'Verify', 1));
    expect(err.message).toContain('No email at all reached that address');
  });

  it('ignores mail that arrived before the scenario started', async () => {
    const fx = fixtures();
    deliver({ to: 'ann@x.test', subject: 'Verify your email' }, 60_000);
    // Touching any step opens the window; the old message is outside it.
    const err = await caught(receive()(fx, 'ann@x.test', 'Verify', 1));
    expect(err.code).toBe('MAIL_NOT_RECEIVED');
  });

  it('the receive step pins its match as "the latest email", even when a newer one arrives', async () => {
    const fx = fixtures();
    deliver({
      to: 'ann@x.test',
      subject: 'Verify your email',
      HTML: '<a href="https://app.test/verify?token=t1&amp;u=ann">Verify email</a>',
      Text: 'Your code: 654321',
    });
    await receive()(fx, 'ann@x.test', 'Verify', 1);
    deliver({
      to: 'ann@x.test',
      subject: 'Welcome',
      HTML: '<a href="https://app.test/welcome">Start</a>',
    });

    await contains()(fx, 'ann@x.test', 'Your code');
    await saveLink()(fx, '/verify\\?token=', 'ann@x.test', 'verifyUrl');
    expect(fx.apiContext.vars.get('verifyUrl')).toBe('https://app.test/verify?token=t1&u=ann');
    await saveCode()(fx, 'code: (\\d{6})', 'ann@x.test', 'otp');
    expect(fx.apiContext.vars.get('otp')).toBe('654321');
    await openLink()(fx, 'Verify email', 'ann@x.test');
    expect(fx.page.gotos).toEqual(['https://app.test/verify?token=t1&u=ann']);
  });

  it('without a pin, "latest" is the newest in the window', async () => {
    const fx = fixtures();
    deliver({ to: 'ann@x.test', subject: 'Old', Text: 'first' }, 500);
    deliver({ to: 'ann@x.test', subject: 'New', Text: 'second' });
    await contains()(fx, 'ann@x.test', 'second');
    await expect(contains()(fx, 'ann@x.test', 'first')).rejects.toThrow(/first/);
  });

  it('clearing deletes the address’s mail and unpins', async () => {
    const fx = fixtures();
    deliver({ to: 'ann@x.test', subject: 'Verify your email' });
    await receive()(fx, 'ann@x.test', 'Verify', 1);
    await step(PATTERNS[0]!)(fx, 'ANN@x.test');
    expect(messages).toHaveLength(0);
    const err = await caught(contains()(fx, 'ann@x.test', 'anything'));
    expect(err.code).toBe('MAIL_NOT_RECEIVED');
  });

  it('checks the sender by address, display name or "Name <address>"', async () => {
    const fx = fixtures();
    deliver({
      to: 'ann@x.test',
      subject: 'Hi',
      From: { Name: 'Acme Support', Address: 'support@acme.test' },
    });
    await sentFrom()(fx, 'ann@x.test', 'support@acme.test');
    await sentFrom()(fx, 'ann@x.test', 'Acme Support');
    await sentFrom()(fx, 'ann@x.test', 'Acme Support <support@acme.test>');
    await expect(sentFrom()(fx, 'ann@x.test', 'billing@acme.test')).rejects.toThrow(
      /support@acme\.test/,
    );
  });

  it('a missing link or code fails listing what the email does have', async () => {
    const fx = fixtures();
    deliver({ to: 'ann@x.test', subject: 'Hi', HTML: '<a href="https://app.test/a">A</a>' });
    const noLink = await caught(saveLink()(fx, '/verify', 'ann@x.test', 'x'));
    expect(noLink.message).toContain('No link matching /verify in "Hi"');
    expect(noLink.hint).toContain('https://app.test/a');
    const noOpen = await caught(openLink()(fx, 'Verify', 'ann@x.test'));
    expect(noOpen.message).toContain('No link named "Verify"');
    const noCode = await caught(saveCode()(fx, '\\d{6}', 'ann@x.test', 'otp'));
    expect(noCode.message).toContain('Nothing in "Hi" matches');
  });

  it('refuses an unresolved {{var}} in the address instead of searching for it', async () => {
    const err = await caught(receive()(fixtures(), '{{email}}', 'Verify', 1));
    expect(err.code).toBe('CONFIG_UNRESOLVED_VAR');
  });
});
