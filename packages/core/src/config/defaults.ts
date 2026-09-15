import type { ProjectConfigInput } from '@sdods/contracts';

/** Framework defaults: only the sections that make sense without a project. */
export const FRAMEWORK_DEFAULTS: Partial<ProjectConfigInput> = {
  browsers: ['chromium'],
  testIdAttribute: 'data-testid',
  screenshots: {
    policy: {
      default: 'on-failure',
      '@smoke': 'scenario',
      '@regression': 'step',
      '@visual': 'visual',
    },
    fullPage: false,
    mask: [],
    maxDiffPixelRatio: 0.01,
    baselines: {},
    viewport: { width: 1280, height: 720 },
    onlyOnFailure: false,
  },
  heal: { enabled: true, primaryTimeoutMs: 3000, probeTimeoutMs: 1500, minScore: 0.6 },
  timeouts: { test: 60_000, expect: 10_000, action: 15_000, navigation: 30_000, api: 15_000 },
  retries: { ci: 2, local: 0, byTag: {} },
};

/** Environment variables that map onto config paths (process.env layer). */
export const ENV_TO_CONFIG_PATH: Record<string, string> = {
  SDODS_UI_BASE_URL: 'env.ui.baseUrl',
  SDODS_API_BASE_URL: 'env.api.baseUrl',
  SDODS_HEADED: 'runtime.headed',
  SDODS_WORKERS: 'runtime.workers',
  SDODS_SHARD: 'runtime.shard',
  SDODS_RETRIES: 'runtime.retries',
  SDODS_RUN_ID: 'runtime.runId',
  SDODS_ARTIFACTS_DIR: 'runtime.artifactsDir',
  SDODS_SHOT_POLICY: 'project.screenshots.policy.default',
  SDODS_SHOTS_ONLY_ON_FAILURE: 'project.screenshots.onlyOnFailure',
  SDODS_HEAL: 'project.heal.enabled',
  SDODS_TRACE: 'project.evidence.trace',
  SDODS_VIDEO: 'project.evidence.video',
  SDODS_HAR_MODE: 'runtime.harMode',
  SDODS_OFFLINE: 'runtime.offline',
  SDODS_UPDATE_SNAPSHOTS: 'runtime.updateSnapshots',
};

export const DEFAULT_ARTIFACTS_DIR = '.sdods/runs';
export const DEFAULT_PROJECTS_DIR = 'projects';
export const PROJECT_FILE = 'sdods.project.yaml';
export const WORKSPACE_FILE = 'sdods.workspace.yaml';
