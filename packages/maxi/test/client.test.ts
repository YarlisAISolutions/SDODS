import { describe, expect, it } from 'vitest';
import { createClient } from '../src/client.js';

describe('createClient', () => {
  it('names the workspace on every request when ANTHROPIC_WORKSPACE_ID is set', async () => {
    const client = createClient({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_WORKSPACE_ID: 'wrkspc_123' });
    const headers = new Headers(
      (client as unknown as { _options: { defaultHeaders?: HeadersInit } })._options.defaultHeaders,
    );
    expect(headers.get('anthropic-workspace-id')).toBe('wrkspc_123');
  });

  it('adds no header for a workspace-scoped key', () => {
    const client = createClient({ ANTHROPIC_API_KEY: 'k' });
    expect(
      (client as unknown as { _options: { defaultHeaders?: unknown } })._options.defaultHeaders,
    ).toBeUndefined();
  });
});
