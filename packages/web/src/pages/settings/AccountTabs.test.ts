import { describe, expect, it } from 'vitest';
import { describeAgent, passwordStrength, validatePasswordForm } from './AccountTabs';
import { providerBody } from '../Integrations';
import { toScheduleBody } from '../Schedules';
import { streamEntry } from '../Agents';

describe('password form', () => {
  it('needs all three fields, a long enough new password, and a matching confirmation', () => {
    expect(validatePasswordForm({ current: 'a', next: '', confirm: '' }).valid).toBe(false);
    const short = validatePasswordForm({ current: 'old', next: 'short', confirm: 'short' });
    expect(short.valid).toBe(false);
    expect(short.errors.next).toMatch(/At least/);
    const mismatch = validatePasswordForm({
      current: 'old',
      next: 'Correct#Horse1',
      confirm: 'Correct#Horse2',
    });
    expect(mismatch.errors.confirm).toBe('Passwords do not match.');
    const same = validatePasswordForm({
      current: 'Correct#Horse1',
      next: 'Correct#Horse1',
      confirm: 'Correct#Horse1',
    });
    expect(same.errors.next).toMatch(/differ/);
    expect(
      validatePasswordForm({ current: 'old', next: 'Correct#Horse1', confirm: 'Correct#Horse1' })
        .valid,
    ).toBe(true);
  });

  it('rates strength by length and character classes', () => {
    expect(passwordStrength('abc')).toBe(0);
    expect(passwordStrength('abcdefghij')).toBe(1);
    expect(passwordStrength('abcdefghi1')).toBe(2);
    expect(passwordStrength('Abcdefgh#123')).toBe(3);
  });
});

describe('describeAgent', () => {
  it('names browser and OS', () => {
    expect(
      describeAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS');
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/130.0')).toBe(
      'Firefox on Windows',
    );
    expect(describeAgent(null)).toBe('Unknown device');
  });
});

describe('providerBody', () => {
  it('drops view-only keys and puts secret env names back into the block', () => {
    const body = providerBody(
      {
        provider: 'jira',
        enabled: false,
        config: {},
        secretEnv: { email: 'JIRA_EMAIL', token: 'JIRA_API_TOKEN' },
        secretsPresent: {},
        lastSyncAt: null,
      },
      {
        baseUrl: 'https://x.atlassian.net',
        tokenPresent: true,
        emailPresent: false,
        issueType: '',
      },
      true,
    );
    expect(body).toEqual({
      jira: {
        baseUrl: 'https://x.atlassian.net',
        enabled: true,
        tokenEnv: 'JIRA_API_TOKEN',
        emailEnv: 'JIRA_EMAIL',
      },
    });
  });
});

describe('toScheduleBody', () => {
  it('maps the view to the POST body and omits empty optionals', () => {
    expect(
      toScheduleBody({
        id: 's1',
        projectSlug: 'shop',
        name: ' nightly ',
        cron: '0 2 * * *',
        timezone: '',
        tags: '',
        layers: [],
        overlap: 'skip',
        jitterSeconds: 0,
        catchUp: false,
        enabled: true,
        notify: [],
      }),
    ).toEqual({
      project: 'shop',
      name: 'nightly',
      cron: '0 2 * * *',
      timezone: 'UTC',
      overlap: 'skip',
      jitterSeconds: 0,
      catchUp: false,
      enabled: true,
      notify: [],
    });
  });
});

describe('streamEntry', () => {
  it('shows plain lines, structured tool events, and hides the final result', () => {
    expect(streamEntry({ stream: 'out', line: 'planning…' })).toEqual({
      kind: 'text',
      text: 'planning…',
    });
    expect(streamEntry({ stream: 'err', line: 'warn: x' })?.kind).toBe('err');
    expect(
      streamEntry({ stream: 'out', line: '{"type":"tool","name":"step_find","input":{"q":"a"}}' }),
    ).toEqual({ kind: 'tool', text: 'step_find({"q":"a"})' });
    expect(streamEntry({ stream: 'out', line: '{"proposalId":"p1"}' })).toBeNull();
    expect(streamEntry({ stream: 'out', line: '  ' })).toBeNull();
  });
});
