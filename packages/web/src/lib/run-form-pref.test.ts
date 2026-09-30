import { describe, expect, it } from 'vitest';
import { runFormPrefKey, sanitizeSelection, selectionOf } from './run-form-pref';

const project = {
  envs: { default: 'staging', available: ['staging', 'prod'] },
  layers: ['ui', 'api'] as const,
  browsers: ['chromium', 'firefox'] as const,
} as unknown as Parameters<typeof sanitizeSelection>[1];

describe('run form preferences', () => {
  it('keys by workspace and project so the same slug in two workspaces does not collide', () => {
    expect(runFormPrefKey('web', 'shop')).toBe('runForm:web:shop');
    expect(runFormPrefKey('mobile', 'shop')).not.toBe(runFormPrefKey('web', 'shop'));
  });

  it('restores what still exists in the project', () => {
    expect(
      sanitizeSelection(
        {
          env: 'prod',
          tags: '@smoke',
          layers: ['api'],
          browsers: ['firefox'],
          process: 'nightly',
          workers: 3,
          headed: true,
          harMode: 'replay',
        },
        project,
        ['nightly'],
      ),
    ).toEqual({
      env: 'prod',
      tags: '@smoke',
      layers: ['api'],
      browsers: ['firefox'],
      process: 'nightly',
      workers: 3,
      headed: true,
      harMode: 'replay',
    });
  });

  it('drops an environment, browser, layer or process that has since been removed', () => {
    expect(
      sanitizeSelection(
        { env: 'qa', layers: ['hybrid'], browsers: ['webkit'], process: 'gone' } as never,
        project,
        ['nightly'],
      ),
    ).toEqual({});
  });

  it('never remembers the feature or scenario the dialog was opened for', () => {
    const sel = selectionOf({
      project: 'shop',
      env: 'staging',
      feature: 'auth/login.feature',
      scenario: 'ok',
      harMode: 'off',
    });
    expect(sel).not.toHaveProperty('feature');
    expect(sel).not.toHaveProperty('scenario');
    expect(sel.harMode).toBeUndefined();
  });
});
