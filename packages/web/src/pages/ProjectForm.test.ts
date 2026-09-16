import { describe, expect, it } from 'vitest';
import { normalizeProject } from '../api/normalize';
import { projectPatch } from './ProjectForm';

describe('projectPatch', () => {
  const initial = normalizeProject({
    slug: 'shop',
    workspace: 'web',
    config: {
      slug: 'shop',
      name: 'Shop',
      description: 'x',
      layers: ['ui'],
      browsers: ['chromium'],
    },
    processes: [{ name: 'pr-check', trigger: 'pr' }],
  });

  it('sends only the keys that changed', () => {
    expect(projectPatch(initial, { ...initial, name: 'Shop 2', layers: ['ui', 'api'] })).toEqual({
      name: 'Shop 2',
      layers: ['ui', 'api'],
    });
  });

  it('leaves inherited processes out unless they were edited, and clears an emptied description', () => {
    expect(projectPatch(initial, { ...initial, description: '' })).toEqual({ description: null });
    expect(projectPatch(initial, initial)).toEqual({});
  });
});
