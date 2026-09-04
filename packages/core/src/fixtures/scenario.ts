import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { TestInfo } from '@playwright/test';
import {
  fingerprint as makeFingerprint,
  parsePwProjectName,
  scenarioFiles,
  type BrowserName,
  type Layer,
  type ScenarioMeta as ScenarioMetaDto,
  type SuiteStatus,
} from '@automax/contracts';
import type { ResolvedConfig } from '../config/resolve.js';
import { suiteOfTags } from '../config/tags.js';
import { moduleForFeature } from '../config/workspace.js';

export interface ScenarioInit {
  config: ResolvedConfig;
  testInfo: TestInfo;
  featureUri: string;
  tags: string[];
  pickleLine?: number;
  automax: { project: string; layer: Layer; browser?: BrowserName };
}

/** Per-scenario identity + on-disk directory. Writes meta.json at start and on finalize. */
export class ScenarioMeta {
  readonly data: ScenarioMetaDto;
  readonly dir: string;
  readonly suiteTag?: string;

  constructor(init: ScenarioInit) {
    const { config, testInfo, tags } = init;
    const featureUri = relative(config.project.root, init.featureUri).replace(/\\/g, '/');
    const parts = parsePwProjectName(testInfo.project.name);
    const layer = (parts?.layer ?? init.automax.layer) as Layer;
    const browser = (parts?.browser ?? init.automax.browser) as BrowserName | undefined;
    const fp = makeFingerprint({
      project: config.project.slug,
      featureUri,
      scenarioName: testInfo.title,
      exampleIndex: null,
      layer,
    });
    this.dir = join(config.runtime.runDir, config.project.slug, fp, `r${testInfo.retry}`);
    this.suiteTag = suiteOfTags(
      tags,
      config.project.tags.suites.map((s) => `@${s}`),
    );
    this.data = {
      runId: config.runtime.runId,
      fingerprint: fp,
      testId: testInfo.testId,
      project: config.project.slug,
      layer,
      browser,
      pwProject: testInfo.project.name,
      featureUri,
      featureName: testInfo.titlePath[1] ?? '',
      scenarioName: testInfo.title,
      pickleLine: init.pickleLine,
      exampleIndex: null,
      tags,
      module: moduleForFeature(config.project, init.featureUri)?.name,
      process: process.env.AUTOMAX_PROCESS || undefined,
      retry: testInfo.retry,
      workerIndex: testInfo.workerIndex,
      parallelIndex: testInfo.parallelIndex,
      startedAt: new Date().toISOString(),
      dir: this.dir,
    };
    mkdirSync(this.dir, { recursive: true });
    this.write();
  }

  get fingerprint() {
    return this.data.fingerprint;
  }

  file(rel: string): string {
    const f = join(this.dir, rel);
    const parent = join(f, '..');
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    return f;
  }

  appendJsonl(rel: string, obj: unknown) {
    appendFileSync(this.file(rel), JSON.stringify(obj) + '\n');
  }

  write() {
    writeFileSync(join(this.dir, scenarioFiles.meta), JSON.stringify(this.data, null, 2));
  }

  finalize(extra: {
    status?: SuiteStatus;
    errorMessage?: string;
    apiCalls?: number;
    heals?: number;
  }) {
    this.data.finishedAt = new Date().toISOString();
    this.data.durationMs = Date.parse(this.data.finishedAt) - Date.parse(this.data.startedAt);
    Object.assign(this.data, extra);
    this.write();
  }
}
