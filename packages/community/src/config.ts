/** Everything the community service reads from the environment, resolved once at start-up. */
export interface CommunityConfig {
  port: number;
  host: string;
  /** The OpenID Connect provider whose ID tokens sign people in; unset, nobody can post. */
  auth?: { issuer: string; audience: string; jwksUrl: string };
  /**
   * Firebase project whose ID tokens are accepted and whose Auth holds role claims — sdods.com's
   * own deployment. Ignored when `auth` is set. Moves to the private deployment package.
   */
  firebaseProject?: string;
  /** First-pass reviewer: cheap, reviews every post. */
  reviewModel: string;
  /** Second opinion when the first pass is unsure. */
  escalationModel: string;
  /** Verified email addresses that are admins without a custom claim (the site's moderators). */
  adminEmails: string[];
  /** Browser origins allowed to call the API. */
  allowedOrigins: string[];
  /** Origin patterns allowed too, for preview hosts: `*` matches one run of [a-z0-9-], never a dot. */
  allowedOriginPatterns: string[];
  /** Estimated review spend per UTC day; past it, posts wait for an editor instead of the model. */
  dailyBudgetUsd: number;
  /** Posts (questions + answers) per signed-in user per window. */
  postsPerWindow: number;
  /** Requests per IP per window, across every route. */
  ipRateLimit: number;
  /** Public reads (question lists, profiles, revisions) per IP per window. */
  readRateLimit: number;
  /** Anonymous feedback submissions per IP per window. */
  feedbackPerWindow: number;
  /** Shared-cache lifetime of the public read routes, in seconds. */
  readCacheSeconds: number;
  rateLimitWindowMs: number;
  /**
   * Accounts first seen less than this many hours ago always go to the editor queue. 0 disables it:
   * sign-in plus review is the default defence, and a first post that waits a day loses the poster.
   */
  newAccountQueueHours: number;
  /** Reputation needed to vote up / down (Stack Overflow: 15 / 125). Editors and admins are exempt. */
  upvoteRep: number;
  downvoteRep: number;
  /** Reputation to edit other people's posts directly (Stack Overflow: 2000); below it, suggest. */
  editRep: number;
  /** Votes per user per UTC day (Stack Overflow: 40). */
  votesPerDay: number;
  /** The published question index, used to suggest duplicates and to title archive threads. */
  searchIndexUrl: string;
  searchIndexRefreshMs: number;
  /**
   * Firestore project for posts; unset keeps everything in memory (tests and local dev). Moves to
   * the private deployment package with the rest of ./firebase/.
   */
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
    auth:
      env.COMMUNITY_AUTH_ISSUER && env.COMMUNITY_AUTH_AUDIENCE && env.COMMUNITY_AUTH_JWKS_URL
        ? {
            issuer: env.COMMUNITY_AUTH_ISSUER,
            audience: env.COMMUNITY_AUTH_AUDIENCE,
            jwksUrl: env.COMMUNITY_AUTH_JWKS_URL,
          }
        : undefined,
    firebaseProject: env.COMMUNITY_FIREBASE_PROJECT || undefined,
    reviewModel: env.COMMUNITY_REVIEW_MODEL || 'claude-haiku-4-5',
    escalationModel: env.COMMUNITY_ESCALATION_MODEL || 'claude-sonnet-5',
    // The site's two moderator addresses (the deployment's security rules name the same two).
    adminEmails: (admins.length ? admins : ['admin@sdods.com', 'admin@yarlis.com']).map((e) =>
      e.toLowerCase(),
    ),
    allowedOrigins: origins.length
      ? origins
      : [
          'https://sdods.com',
          'https://www.sdods.com',
          // The docs site sends "was this page helpful?" clicks to /feedback.
          'https://docs.sdods.com',
          ...(production ? [] : ['http://localhost:3100', 'http://localhost:3002']),
        ],
    // Commas or spaces: spaces survive `gcloud --set-env-vars`, which splits on commas.
    allowedOriginPatterns: (env.COMMUNITY_ALLOWED_ORIGIN_PATTERNS ?? '')
      .split(/[\s,]+/)
      .filter(Boolean),
    dailyBudgetUsd: num(env.COMMUNITY_DAILY_BUDGET_USD, 5),
    postsPerWindow: num(env.COMMUNITY_POSTS_PER_WINDOW, 10),
    ipRateLimit: num(env.COMMUNITY_IP_RATE_LIMIT, 60),
    readRateLimit: num(env.COMMUNITY_READ_RATE_LIMIT, 1200),
    feedbackPerWindow: num(env.COMMUNITY_FEEDBACK_PER_WINDOW, 10),
    readCacheSeconds: num(env.COMMUNITY_READ_CACHE_SECONDS, 60),
    rateLimitWindowMs: num(env.COMMUNITY_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
    newAccountQueueHours: num(env.COMMUNITY_NEW_ACCOUNT_QUEUE_HOURS, 0),
    upvoteRep: num(env.COMMUNITY_UPVOTE_REP, 15),
    downvoteRep: num(env.COMMUNITY_DOWNVOTE_REP, 125),
    votesPerDay: num(env.COMMUNITY_VOTES_PER_DAY, 40),
    editRep: num(env.COMMUNITY_EDIT_REP, 2000),
    searchIndexUrl:
      env.COMMUNITY_SEARCH_INDEX_URL || 'https://sdods.com/questions/search-index.json',
    searchIndexRefreshMs: num(env.COMMUNITY_SEARCH_INDEX_REFRESH_MS, 60 * 60 * 1000),
    firestoreProject: env.COMMUNITY_FIRESTORE_PROJECT || undefined,
    // Behind a load balancer or platform front end that sets X-Forwarded-For.
    trustProxy:
      trust === undefined ? production : /^\d+$/.test(trust) ? Number(trust) : trust === 'true',
  };
}
