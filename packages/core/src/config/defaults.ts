import type { ProjectConfigInput } from '@automax/contracts';

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
    viewport: { width: 1280, height: 720 },
    onlyOnFailure: false,
  },
  heal: { enabled: true, primaryTimeoutMs: 3000, probeTimeoutMs: 1500, minScore: 0.6 },
  timeouts: { test: 60_000, expect: 10_000, action: 15_000, navigation: 30_000, api: 15_000 },
  retries: { ci: 2, local: 0, byTag: {} },
};

/** Environment variables that map onto config paths (process.env layer). */
export const ENV_TO_CONFIG_PATH: Record<string, string> = {
  AUTOMAX_UI_BASE_URL: 'env.ui.baseUrl',
  AUTOMAX_API_BASE_URL: 'env.api.baseUrl',
  AUTOMAX_HEADED: 'runtime.headed',
  AUTOMAX_WORKERS: 'runtime.workers',
  AUTOMAX_SHARD: 'runtime.shard',
  AUTOMAX_RETRIES: 'runtime.retries',
  AUTOMAX_RUN_ID: 'runtime.runId',
  AUTOMAX_ARTIFACTS_DIR: 'runtime.artifactsDir',
  AUTOMAX_SHOT_POLICY: 'project.screenshots.policy.default',
  AUTOMAX_SHOTS_ONLY_ON_FAILURE: 'project.screenshots.onlyOnFailure',
  AUTOMAX_HEAL: 'project.heal.enabled',
  AUTOMAX_HAR_MODE: 'runtime.harMode',
  AUTOMAX_OFFLINE: 'runtime.offline',
  AUTOMAX_UPDATE_SNAPSHOTS: 'runtime.updateSnapshots',
};

export const DEFAULT_ARTIFACTS_DIR = '.automax/runs';
export const DEFAULT_PROJECTS_DIR = 'projects';
export const PROJECT_FILE = 'automax.project.yaml';
