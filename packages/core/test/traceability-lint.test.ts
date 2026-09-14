import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectConfigSchema } from '@sdods/contracts';
import { lintProject } from '../src/lint/index.js';

function project(opts: {
  feature: string;
  traceability?: Record<string, unknown>;
  requirements?: { name: string; text: string };
}) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-lint-req-'));
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'features'), { recursive: true });
  writeFileSync(join(proj, 'features', 'a.feature'), opts.feature);
  if (opts.requirements) writeFileSync(join(proj, opts.requirements.name), opts.requirements.text);
  return {
    ...ProjectConfigSchema.parse({
      slug: 'shop',
      name: 'Shop',
      layers: ['ui'],
      browsers: ['chromium'],
      envs: { default: 'staging', available: ['staging'] },
      ...(opts.traceability ? { traceability: opts.traceability } : {}),
    }),
    root: proj,
  };
}

const rules = (res: { errors: Array<{ rule: string }>; warnings: Array<{ rule: string }> }) => [
  ...res.errors.map((e) => e.rule),
  ...res.warnings.map((w) => w.rule),
];

describe('@req:<id> lint', () => {
  it('accepts any id when the project lists no requirements (the id is opaque)', async () => {
    const res = await lintProject({
      project: project({
        feature: `@ui @smoke\nFeature: F\n\n  @req:anything-goes @req:SPEC_4.2.1\n  Scenario: S\n    Given x\n`,
      }),
    });
    expect(rules(res).filter((r) => r.startsWith('tags/'))).toEqual([]);
  });

  it('rejects an id that is not in the requirements file, and accepts one that is', async () => {
    const res = await lintProject({
      project: project({
        feature: `@ui @smoke\nFeature: F\n\n  @req:REQ-1 @req:REQ-404\n  Scenario: S\n    Given x\n`,
        traceability: { requirements: 'requirements.yaml' },
        requirements: { name: 'requirements.yaml', text: '- id: REQ-1\n  title: One\n' },
      }),
    });
    const req = res.errors.filter((e) => e.rule === 'tags/req');
    expect(req).toHaveLength(1);
    expect(req[0]!.message).toBe('@req:REQ-404 is not listed in requirements.yaml.');
    expect(req[0]!.line).toBe(5);
  });

  it('reads a CSV requirements file', async () => {
    const res = await lintProject({
      project: project({
        feature: `@ui @smoke\nFeature: F\n\n  @req:REQ-2\n  Scenario: S\n    Given x\n`,
        traceability: { requirements: 'reqs.csv' },
        requirements: { name: 'reqs.csv', text: 'ID,Title\nREQ-1,"One, first"\nREQ-2,Two\n' },
      }),
    });
    expect(res.errors).toEqual([]);
  });

  it('reports a missing requirements file once instead of failing every tag', async () => {
    const res = await lintProject({
      project: project({
        feature: `@ui @smoke\nFeature: F\n\n  @req:REQ-1\n  Scenario: S\n    Given x\n`,
        traceability: { requirements: 'nope.yaml' },
      }),
    });
    expect(rules(res)).toEqual(['traceability/requirements']);
  });

  it('require: true flags scenarios without @req:', async () => {
    const res = await lintProject({
      project: project({
        feature: `@ui @smoke\nFeature: F\n\n  @req:REQ-1\n  Scenario: Traced\n    Given x\n\n  Scenario: Untraced\n    Given x\n`,
        traceability: { require: true },
      }),
    });
    const missing = res.errors.filter((e) => e.rule === 'tags/req-missing');
    expect(missing.map((e) => e.line)).toEqual([8]);
  });

  it('a Feature-level @req: covers every scenario, and is validated for each', async () => {
    const feature = `@ui @smoke @req:REQ-1\nFeature: F\n\n  Scenario: A\n    Given x\n\n  Rule: R\n    Scenario: B\n      Given x\n`;
    const ok = await lintProject({
      project: project({
        feature,
        traceability: { require: true, requirements: 'r.yaml' },
        requirements: { name: 'r.yaml', text: 'REQ-1: One\n' },
      }),
    });
    expect(ok.errors).toEqual([]);

    const unknown = await lintProject({
      project: project({
        feature,
        traceability: { require: true, requirements: 'r.yaml' },
        requirements: { name: 'r.yaml', text: 'REQ-2: Two\n' },
      }),
    });
    expect(unknown.errors.map((e) => [e.rule, e.line])).toEqual([
      ['tags/req', 4],
      ['tags/req', 8],
    ]);
  });

  it('the link template must carry {id}', () => {
    const base = {
      slug: 'shop',
      name: 'Shop',
      layers: ['ui'],
      envs: { default: 'staging', available: ['staging'] },
    };
    expect(
      ProjectConfigSchema.safeParse({ ...base, traceability: { link: 'https://x/browse/' } })
        .success,
    ).toBe(false);
    expect(
      ProjectConfigSchema.safeParse({ ...base, traceability: { link: 'https://x/browse/{id}' } })
        .success,
    ).toBe(true);
  });
});
