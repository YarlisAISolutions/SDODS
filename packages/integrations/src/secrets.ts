import type { CiInfo, IntegrationSecrets } from './types.js';

/** Read secrets by env var NAME from the given environment; values are never logged. */
export function readSecrets(
  names: { tokenEnv?: string; emailEnv?: string; evidenceTokenEnv?: string },
  env: NodeJS.ProcessEnv = process.env,
): IntegrationSecrets {
  return {
    token: names.tokenEnv ? env[names.tokenEnv] : undefined,
    email: names.emailEnv ? env[names.emailEnv] : undefined,
    ...(names.evidenceTokenEnv ? { evidenceToken: env[names.evidenceTokenEnv] } : {}),
  };
}

export function secretPresence(
  names: { tokenEnv?: string; emailEnv?: string; evidenceTokenEnv?: string },
  env: NodeJS.ProcessEnv = process.env,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (names.tokenEnv) out[names.tokenEnv] = Boolean(env[names.tokenEnv]);
  if (names.emailEnv) out[names.emailEnv] = Boolean(env[names.emailEnv]);
  if (names.evidenceTokenEnv) out[names.evidenceTokenEnv] = Boolean(env[names.evidenceTokenEnv]);
  return out;
}

/** Detect CI context (GitHub Actions and GitLab CI; everything else is "other"). */
export function detectCi(env: NodeJS.ProcessEnv = process.env): CiInfo {
  if (env.GITHUB_ACTIONS === 'true') {
    const ref = env.GITHUB_REF ?? '';
    const prMatch = /^refs\/pull\/(\d+)\//.exec(ref);
    const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
    const repo = env.GITHUB_REPOSITORY;
    const runId = env.GITHUB_RUN_ID;
    return {
      provider: 'github',
      isPullRequest: env.GITHUB_EVENT_NAME === 'pull_request' || Boolean(prMatch),
      prNumber: prMatch ? Number(prMatch[1]) : undefined,
      sha: env.GITHUB_SHA,
      branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME,
      runUrl: repo && runId ? `${server}/${repo}/actions/runs/${runId}` : undefined,
      artifactUrl: repo && runId ? `${server}/${repo}/actions/runs/${runId}#artifacts` : undefined,
      eventName: env.GITHUB_EVENT_NAME,
      repository: repo,
    };
  }
  if (env.GITLAB_CI === 'true') {
    return {
      provider: 'gitlab',
      isPullRequest: Boolean(env.CI_MERGE_REQUEST_IID),
      prNumber: env.CI_MERGE_REQUEST_IID ? Number(env.CI_MERGE_REQUEST_IID) : undefined,
      sha: env.CI_COMMIT_SHA,
      branch: env.CI_COMMIT_REF_NAME,
      runUrl: env.CI_JOB_URL,
      artifactUrl: env.CI_JOB_URL ? `${env.CI_JOB_URL}/artifacts/browse` : undefined,
      repository: env.CI_PROJECT_PATH,
    };
  }
  return { provider: env.CI ? 'other' : undefined, isPullRequest: false };
}
