/**
 * In-memory index of the static cucumber envelopes (gherkinDocument, pickle, stepDefinition, hook,
 * testCase) that the dynamic ones (testCaseStarted, testStepFinished, attachment …) refer to.
 */
export interface GherkinStepInfo {
  keyword: string;
  line: number;
}

export interface PickleInfo {
  id: string;
  uri: string;
  name: string;
  tags: string[];
  steps: Array<{
    id: string;
    text: string;
    type?: string;
    astNodeIds: string[];
    argument?: unknown;
  }>;
  astNodeIds: string[];
}

export interface TestCaseInfo {
  id: string;
  pickleId: string;
  testSteps: Array<{
    id: string;
    pickleStepId?: string;
    hookId?: string;
    stepDefinitionIds?: string[];
  }>;
}

export class MessageIndex {
  readonly docs = new Map<string, any>();
  readonly pickles = new Map<string, PickleInfo>();
  readonly testCases = new Map<string, TestCaseInfo>();
  readonly stepDefs = new Map<string, any>();
  readonly hooks = new Map<string, any>();
  /** ast node id → step keyword/line (from gherkin documents) */
  private readonly astSteps = new Map<string, GherkinStepInfo>();
  /** ast node id (examples table row) → { index (1-based), examplesTitle } */
  private readonly astExampleRows = new Map<string, { index: number; line: number }>();
  /** ast node id (scenario) → { name, line } */
  private readonly astScenarios = new Map<string, { name: string; line: number; tags: string[] }>();
  private readonly featureNameByUri = new Map<string, string>();

  addDoc(doc: any) {
    if (!doc?.uri) return;
    this.docs.set(doc.uri, doc);
    const feature = doc.feature;
    if (!feature) return;
    this.featureNameByUri.set(doc.uri, feature.name ?? '');
    const walkChildren = (children: any[] | undefined) => {
      for (const child of children ?? []) {
        if (child.rule) walkChildren(child.rule.children);
        const node = child.background ?? child.scenario;
        if (!node) continue;
        if (child.scenario) {
          this.astScenarios.set(node.id, {
            name: node.name ?? '',
            line: node.location?.line ?? 0,
            tags: (node.tags ?? []).map((t: any) => t.name),
          });
        }
        for (const step of node.steps ?? []) {
          this.astSteps.set(step.id, {
            keyword: String(step.keyword ?? '').trim(),
            line: step.location?.line ?? 0,
          });
        }
        let rowIndex = 0;
        for (const ex of node.examples ?? []) {
          for (const row of ex.tableBody ?? []) {
            rowIndex++;
            this.astExampleRows.set(row.id, { index: rowIndex, line: row.location?.line ?? 0 });
          }
        }
      }
    };
    walkChildren(feature.children);
  }

  addPickle(p: any) {
    if (!p?.id) return;
    this.pickles.set(p.id, {
      id: p.id,
      uri: p.uri,
      name: p.name ?? '',
      tags: (p.tags ?? []).map((t: any) => t.name),
      steps: (p.steps ?? []).map((s: any) => ({
        id: s.id,
        text: s.text ?? '',
        type: s.type,
        astNodeIds: s.astNodeIds ?? [],
        argument: s.argument,
      })),
      astNodeIds: p.astNodeIds ?? [],
    });
  }

  addStepDef(sd: any) {
    if (sd?.id) this.stepDefs.set(sd.id, sd);
  }

  addHook(h: any) {
    if (h?.id) this.hooks.set(h.id, h);
  }

  addTestCase(tc: any) {
    if (!tc?.id) return;
    this.testCases.set(tc.id, { id: tc.id, pickleId: tc.pickleId, testSteps: tc.testSteps ?? [] });
  }

  featureName(uri: string): string | null {
    return this.featureNameByUri.get(uri) ?? null;
  }

  stepKeyword(pickleStep: { astNodeIds: string[] }): string | null {
    for (const id of pickleStep.astNodeIds) {
      const s = this.astSteps.get(id);
      if (s) return s.keyword;
    }
    return null;
  }

  /** 1-based Examples row index for an outline pickle, null for plain scenarios. */
  exampleIndex(pickle: PickleInfo): number | null {
    for (const id of pickle.astNodeIds) {
      const row = this.astExampleRows.get(id);
      if (row) return row.index;
    }
    return null;
  }

  scenarioLine(pickle: PickleInfo): number | null {
    for (const id of pickle.astNodeIds) {
      const sc = this.astScenarios.get(id);
      if (sc) return sc.line;
    }
    return null;
  }

  /** Base scenario name (without example values substituted) */
  scenarioTitle(pickle: PickleInfo): string {
    for (const id of pickle.astNodeIds) {
      const sc = this.astScenarios.get(id);
      if (sc) return sc.name || pickle.name;
    }
    return pickle.name;
  }

  hookType(hookId: string): 'before' | 'after' | null {
    const h = this.hooks.get(hookId);
    if (!h) return null;
    const t = String(h.type ?? h.name ?? '').toLowerCase();
    if (t.includes('after')) return 'after';
    if (t.includes('before')) return 'before';
    return null;
  }

  hookName(hookId: string): string {
    const h = this.hooks.get(hookId);
    return h?.name ?? h?.sourceReference?.uri ?? 'hook';
  }

  definitionLocation(ids: string[] | undefined): string | null {
    for (const id of ids ?? []) {
      const sd = this.stepDefs.get(id);
      const ref = sd?.sourceReference;
      if (ref?.uri) return `${ref.uri}:${ref.location?.line ?? 0}`;
    }
    return null;
  }
}
