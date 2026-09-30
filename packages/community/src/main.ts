import { createOidcVerifier, noSignIn, type Verifier } from './auth.js';
import { createClient } from './client.js';
import { loadConfig } from './config.js';
import { ThreadIndex } from './duplicates.js';
// sdods.com's own adapters. This composition root, and ./firebase/, move to the private
// deployment package; a self-host passes its own store, verifier and role claims instead.
import { FirestoreStore, firebaseIssuer, identityToolkitRoleClaims } from './firebase/index.js';
import { buildCommunityServer } from './server.js';
import { MemoryStore } from './store.js';

const config = loadConfig();
const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ msg, ...extra }));

const store = config.firestoreProject
  ? new FirestoreStore({ project: config.firestoreProject })
  : new MemoryStore();
const index = new ThreadIndex({
  url: config.searchIndexUrl,
  refreshMs: config.searchIndexRefreshMs,
  log,
});
const issuer =
  config.auth ?? (config.firebaseProject ? firebaseIssuer(config.firebaseProject) : undefined);
const verify: Verifier = issuer
  ? createOidcVerifier({ ...issuer, adminEmails: config.adminEmails })
  : noSignIn;
const roleClaims =
  !config.auth && config.firebaseProject
    ? identityToolkitRoleClaims({ project: config.firebaseProject })
    : undefined;

// ANTHROPIC_API_KEY comes from the platform's secret store, or the shell locally.
const app = await buildCommunityServer({
  config,
  client: createClient(),
  verify,
  roleClaims,
  store,
  index,
});
await index.load();
index.start();
if (!config.firestoreProject)
  app.log.warn('COMMUNITY_FIRESTORE_PROJECT unset: posts, reviews and budget stay in memory');
if (!issuer) app.log.warn('No sign-in provider configured (COMMUNITY_AUTH_*): nobody can post');

await app.listen({ port: config.port, host: config.host });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    index.stop();
    void app.close().then(() => process.exit(0));
  });
}
