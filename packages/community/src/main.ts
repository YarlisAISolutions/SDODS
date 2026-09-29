import { createVerifier } from './auth.js';
import { createClient } from './client.js';
import { loadConfig } from './config.js';
import { ThreadIndex } from './duplicates.js';
import { buildCommunityServer } from './server.js';
import { FirestoreStore, MemoryStore } from './store.js';

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
const verify = createVerifier({ project: config.firebaseProject, adminEmails: config.adminEmails });

// ANTHROPIC_API_KEY comes from Secret Manager on Cloud Run, or the shell locally.
const app = await buildCommunityServer({ config, client: createClient(), verify, store, index });
await index.load();
index.start();
if (!config.firestoreProject)
  app.log.warn('COMMUNITY_FIRESTORE_PROJECT unset: posts, reviews and budget stay in memory');

await app.listen({ port: config.port, host: config.host });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    index.stop();
    void app.close().then(() => process.exit(0));
  });
}
