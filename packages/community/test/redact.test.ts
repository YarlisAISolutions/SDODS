import { describe, expect, it } from 'vitest';
import { redact } from '../src/redact.js';

describe('redact', () => {
  it('masks keys by shape and says which kinds it found', () => {
    const input = [
      'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'aws AKIAABCDEFGHIJKLMNOP',
    ].join('\n');
    const r = redact(input);
    expect(r.text).not.toContain('sk-ant-api03');
    expect(r.text).not.toContain('ghp_abc');
    expect(r.text).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(r.found).toEqual(
      expect.arrayContaining(['anthropic-key', 'github-token', 'aws-access-key']),
    );
  });

  it('keeps the label of a labelled secret and masks only the value', () => {
    expect(redact('password: hunter2hunter2').text).toBe('password: [redacted]');
    expect(redact('Authorization: Bearer abcdefghijklmnopqrstuvwx').text).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(redact('postgres://sdods:s3cretpass@db:5432/x').text).toBe(
      'postgres://sdods:[redacted]@db:5432/x',
    );
  });

  it('leaves ordinary posts alone', () => {
    const post = 'sdods run -p demo-shop -e staging -l ui fails with TimeoutError after 30000ms';
    expect(redact(post)).toEqual({ text: post, found: [] });
  });
});
