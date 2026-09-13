import { describe, expect, it } from 'vitest';
import { isSecretKey, redact } from '../src/logger.js';

/**
 * `sdods config show` and the logger both redact through this. Header-style auth keeps its secret
 * under a key called `value`, and API keys arrive as headers such as X-Api-Key, so a key-name
 * regex that only knew `token` and `apikey` printed them in clear.
 */
describe('redact', () => {
  it('masks header auth values whatever the header is called', () => {
    const out = redact({ api: { auth: { type: 'header', name: 'X-Tenant', value: 's3cr3t' } } });
    expect(out.api.auth).toEqual({ type: 'header', name: 'X-Tenant', value: '***' });
  });

  it('masks bearer, basic and oauth secrets', () => {
    expect(redact({ type: 'bearer', token: 't' }).token).toBe('***');
    expect(redact({ type: 'basic', username: 'u', password: 'p' })).toEqual({
      type: 'basic',
      username: 'u',
      password: '***',
    });
    expect(redact({ clientId: 'id', clientSecret: 'cs' }).clientSecret).toBe('***');
  });

  it('masks credential-looking headers in header maps', () => {
    const out = redact({
      headers: {
        Accept: 'application/json',
        'X-Api-Key': 'k1',
        'Ocp-Apim-Subscription-Key': 'k2',
        Authorization: 'Bearer x',
      },
    });
    expect(out.headers).toEqual({
      Accept: 'application/json',
      'X-Api-Key': '***',
      'Ocp-Apim-Subscription-Key': '***',
      Authorization: '***',
    });
  });

  it('leaves ordinary values alone', () => {
    const cfg = { baseUrl: 'https://x', name: 'qa', testIdAttribute: 'data-test', retries: 2 };
    expect(redact(cfg)).toEqual(cfg);
  });

  it('recognises secret key names', () => {
    for (const k of ['password', 'api-key', 'X-Api-Key', 'client_secret', 'sessionToken'])
      expect(isSecretKey(k), k).toBe(true);
    for (const k of ['name', 'monkey', 'baseUrl', 'keyboard'])
      expect(isSecretKey(k), k).toBe(false);
  });
});
