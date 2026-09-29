/** Everything the community service reads from the environment, resolved once at start-up. */
export interface CommunityConfig {
  port: number;
  host: string;
  /** Firebase project whose sign-in tokens are accepted and whose Firestore holds the posts. */
  firebaseProject: string;
  /** First-pass reviewer: cheap, reviews every post. */
  reviewModel: string;
  /** Second opinion when the first pass is unsure. */
  escalationModel: string;
  /** Verified email addresses that are admins without a custom claim (the site's moderators). */
  adminEmails: string[];
  /** Browser origins allowed to call the API. */
  allowedOrigins: string[];
  /** Firebase Hosting preview channels (`<site>--pr-12-abc.web.app`) of these sites are allowed too. */
  previewSites: string[];
  /** Estimated review spend per UTC day; past it, posts wait for an editor instead of the model. */
  dailyBudgetUsd: number;
  /** Posts (questions + answers) per signed-in user per window. */
  postsPerWindow: number;
  /** Requests per IP per window, across every route. */
  ipRateLimit: number;
  rateLimitWindowMs: number;
  /**
   * Accounts first seen less than this many hours ago always go to the editor queue. 0 disables it:
   * sign-in plus review is the default defence, and a first post that waits a day loses the poster.
   */
  newAccountQueueHours: number;
  /** The published question index, used to suggest duplicates and to title archive threads. */
  searchIndexUrl: string;
  searchIndexRefreshMs: number;
  /** Firestore project for posts; unset keeps everything in memory (tests and local dev). */
  firestoreProject?: string;
  trustProxy: boolean | number;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CommunityConfig {
  const production = env.NODE_ENV === 'production';
  const origins = list(env.COMMUNITY_ALLOWED_ORIGINS);
  const admins = list(env.COMMUNITY_ADMIN_EMAILS);
  const trust = env.COMMUNITY_TRUST_PROXY;
  return {
    port: num(env.PORT, 8080),
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    firebaseProject: env.COMMUNITY_FIREBASE_PROJECT || 'automax-docs',
    reviewModel: env.COMMUNITY_REVIEW_MODEL || 'claude-haiku-4-5',
    escalationModel: env.COMMUNITY_ESCALATION_MODEL || 'claude-sonnet-5',
    // The two addresses firestore.rules already treats as the moderator.
    adminEmails: (admins.length ? admins : ['admin@sdods.com', 'admin@yarlis.com']).map((e) =>
      e.toLowerCase(),
    ),
    allowedOrigins: origins.length
      ? origins
      : [
          'https://sdods.com',
          'https://www.sdods.com',
          ...(production ? [] : ['http://localhost:3100', 'http://localhost:3002']),
        ],
    previewSites: list(env.COMMUNITY_PREVIEW_SITES ?? 'sdods-automax'),
    dailyBudgetUsd: num(env.COMMUNITY_DAILY_BUDGET_USD, 5),
    postsPerWindow: num(env.COMMUNITY_POSTS_PER_WINDOW, 10),
    ipRateLimit: num(env.COMMUNITY_IP_RATE_LIMIT, 60),
    rateLimitWindowMs: num(env.COMMUNITY_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
    newAccountQueueHours: num(env.COMMUNITY_NEW_ACCOUNT_QUEUE_HOURS, 0),
    searchIndexUrl:
      env.COMMUNITY_SEARCH_INDEX_URL || 'https://sdods.com/questions/search-index.json',
    searchIndexRefreshMs: num(env.COMMUNITY_SEARCH_INDEX_REFRESH_MS, 60 * 60 * 1000),
    firestoreProject: env.COMMUNITY_FIRESTORE_PROJECT || undefined,
    // Cloud Run sits behind Google's front end, which sets X-Forwarded-For.
    trustProxy:
      trust === undefined ? production : /^\d+$/.test(trust) ? Number(trust) : trust === 'true',
  };
}
