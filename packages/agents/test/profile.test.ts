import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../src/adapter/profile.js';
import { recoverTextToolCall } from '../src/adapter/tool-loop.js';
import { createRegistry, buildToolContext } from '@sdods/mcp';
import { roleTools, rolePrompt, ROLES } from '../src/roles/index.js';

describe('resolveProfile', () => {
  it('picks small for models people run themselves', () => {
    expect(resolveProfile({ provider: 'ollama', model: 'qwen2.5-coder:14b' })).toMatchObject({
      profile: 'small',
      reason: 'a local model',
    });
    expect(
      resolveProfile({
        provider: 'openai-compatible',
        model: 'big',
        baseUrl: 'http://192.168.1.20:1234/v1',
      }).profile,
    ).toBe('small');
    expect(resolveProfile({ provider: 'openai-compatible', model: 'llama3.1:8b' }).profile).toBe(
      'small',
    );
    expect(
      resolveProfile({ provider: 'openai-compatible', model: 'gpt-4.1', contextTokens: 8192 })
        .profile,
    ).toBe('small');
  });

  it('leaves a hosted model alone, and always obeys an explicit choice', () => {
    expect(resolveProfile({ provider: 'claude', model: 'claude-opus-5' }).profile).toBe('full');
    expect(
      resolveProfile({
        provider: 'openai-compatible',
        model: 'gpt-4.1',
        baseUrl: 'https://api.openai.com/v1',
      }).profile,
    ).toBe('full');
    expect(resolveProfile({ configured: 'full', provider: 'ollama', model: 'x:7b' }).profile).toBe(
      'full',
    );
    expect(resolveProfile({ configured: 'small', provider: 'claude', model: 'big' }).profile).toBe(
      'small',
    );
  });

  it('treats a model that cannot call tools as small', () => {
    expect(
      resolveProfile({
        provider: 'openai-compatible',
        model: 'llama2-70b',
        capabilities: ['completion'],
      }),
    ).toMatchObject({ profile: 'small' });
  });

  it('keeps the browser away from a small model, and the vocabulary close', () => {
    const small = resolveProfile({ provider: 'ollama', model: 'x:7b' });
    expect(small.attachBrowser).toBe(false);
    expect(small.maxToolCallsPerTurn).toBe(1);
    expect(small.recoverTextToolCalls).toBe(true);
    expect(small.stepVocabularyLimit).toBeGreaterThan(0);
    const full = resolveProfile({ provider: 'claude', model: 'claude-opus-5' });
    expect(full.attachBrowser).toBe(true);
    expect(full.maxToolCallsPerTurn).toBeUndefined();
  });
});

describe('role tools under a profile', () => {
  it('cuts the menu to the role’s allowlist, and every name is real', () => {
    const registry = createRegistry();
    const ctx = buildToolContext({ caps: 'all' });
    for (const role of Object.keys(ROLES) as Array<keyof typeof ROLES>) {
      const full = roleTools(role, registry, ctx, 'full').map((t) => t.name);
      const small = roleTools(role, registry, ctx, 'small').map((t) => t.name);
      expect(small.length).toBeLessThanOrEqual(6);
      expect(small.length).toBe(ROLES[role].smallTools.length);
      // A renamed tool must not silently empty a profile.
      for (const name of ROLES[role].smallTools) expect(full).toContain(name);
    }
  });

  it('asks a small model for one action, not a sequence', () => {
    const input = { project: 'shop', goal: 'login' };
    expect(rolePrompt('generator', input, 'full')).toMatch(/step_list first/);
    const small = rolePrompt('generator', input, 'small');
    expect(small).toMatch(/Call feature_write now/);
    expect(small).not.toMatch(/step_list/);
  });
});

describe('recoverTextToolCall', () => {
  const known = new Set(['feature_write', 'step_find']);

  it('reads a call the model wrote as prose', () => {
    expect(recoverTextToolCall('step_find({"project":"shop","phrase":"login"})', known)).toEqual({
      name: 'step_find',
      args: { project: 'shop', phrase: 'login' },
    });
  });

  it('reads the fenced JSON form, nested objects and all', () => {
    const text =
      'Here is the call:\n```json\n{"name": "feature_write", "parameters": {"project":"shop","files":{"a":"b"}}}\n```';
    expect(recoverTextToolCall(text, known)).toEqual({
      name: 'feature_write',
      args: { project: 'shop', files: { a: 'b' } },
    });
  });

  it('ignores prose that names no tool it has', () => {
    expect(recoverTextToolCall('I would call run_everything({"now":true})', known)).toBeUndefined();
    expect(recoverTextToolCall('no call here at all', known)).toBeUndefined();
  });
});
