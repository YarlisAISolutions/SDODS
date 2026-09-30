/** Everything Maxi reads from the environment, resolved once at start-up. */
export interface MaxiConfig {
  port: number;
  host: string;
  /** Claude model id. Sonnet 5 by default; set MAXI_MODEL=claude-opus-5 for stronger scripts. */
  model: string;
  /** Upper bound per reply, thinking included. */
  maxTokens: number;
  /** Where the docs bundle is published. */
  corpusUrl: string;
  /** Optional local copy used when the URL cannot be reached (and in tests and local dev). */
  corpusFile?: string;
  corpusRefreshMs: number;
  /** Step catalog written by `bun run --filter @sdods/maxi steps`. */
  stepsFile: string;
  /** Browser origins allowed to call the API. */
  allowedOrigins: string[];
  /**
   * Origin patterns allowed too, for preview hosts: `*` matches one run of [a-z0-9-], never a dot.
   * Separated by commas or spaces (spaces survive `gcloud --set-env-vars`, commas do not).
   */
  allowedOriginPatterns: string[];
  /** Estimated spend per UTC day after which Maxi stops answering until tomorrow. */
  dailyBudgetUsd: number;
  /** Requests per IP per window on /chat. */
  chatRateLimit: number;
  rateLimitWindowMs: number;
  /**
   * Firestore project for conversation logs and the spend counter; unset keeps both in memory.
   * Moves to the private deployment package with the rest of ./firebase/.
   */
  firestoreProject?: string;
  trustProxy: boolean | number;
  docsSiteUrl: string;
  askUrl: string;
}

const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MaxiConfig {
  const production = env.NODE_ENV === 'production';
  const origins = list(env.MAXI_ALLOWED_ORIGINS);
  const trust = env.MAXI_TRUST_PROXY;
  return {
    port: num(env.PORT, 8080),
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    model: env.MAXI_MODEL || 'claude-sonnet-5',
    maxTokens: num(env.MAXI_MAX_TOKENS, 8000),
    corpusUrl: env.MAXI_CORPUS_URL || 'https://docs.sdods.com/llms-full.txt',
    corpusFile: env.MAXI_CORPUS_FILE || undefined,
    corpusRefreshMs: num(env.MAXI_CORPUS_REFRESH_MS, 60 * 60 * 1000),
    stepsFile: env.MAXI_STEPS_FILE || new URL('../data/steps.json', import.meta.url).pathname,
    allowedOrigins: origins.length
      ? origins
      : [
          'https://sdods.com',
          'https://www.sdods.com',
          'https://docs.sdods.com',
          ...(production ? [] : ['http://localhost:3100', 'http://localhost:3002']),
        ],
    allowedOriginPatterns: (env.MAXI_ALLOWED_ORIGIN_PATTERNS ?? '').split(/[\s,]+/).filter(Boolean),
    dailyBudgetUsd: num(env.MAXI_DAILY_BUDGET_USD, 20),
    chatRateLimit: num(env.MAXI_CHAT_RATE_LIMIT, 30),
    rateLimitWindowMs: num(env.MAXI_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
    firestoreProject: env.MAXI_FIRESTORE_PROJECT || undefined,
    // Behind a load balancer or platform front end that sets X-Forwarded-For.
    trustProxy:
      trust === undefined ? production : /^\d+$/.test(trust) ? Number(trust) : trust === 'true',
    docsSiteUrl: env.MAXI_DOCS_SITE_URL || 'https://docs.sdods.com',
    askUrl: env.MAXI_ASK_URL || 'https://sdods.com/questions/ask/',
  };
}
