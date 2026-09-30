import { createClient } from './client.js';
import { loadConfig } from './config.js';
import { Corpus } from './corpus.js';
// sdods.com's own store. This composition root, and ./firebase/, move to the private deployment
// package; a self-host passes its own MaxiStore instead.
import { FirestoreStore } from './firebase/store.js';
import { buildMaxiServer } from './server.js';
import { MemoryStore } from './store.js';
import { loadSteps, StepCatalog } from './tools.js';

const config = loadConfig();
const catalog = new StepCatalog(loadSteps(config.stepsFile));
const store = config.firestoreProject
  ? new FirestoreStore({ project: config.firestoreProject })
  : new MemoryStore();

const corpus = new Corpus({
  url: config.corpusUrl,
  file: config.corpusFile,
  refreshMs: config.corpusRefreshMs,
  log: (msg, extra) => console.log(JSON.stringify({ msg, ...extra })),
});

// ANTHROPIC_API_KEY comes from the platform's secret store, or the shell locally.
const app = await buildMaxiServer({ config, client: createClient(), corpus, catalog, store });
await corpus.load();
corpus.start();
if (!catalog.steps.length) app.log.warn({ file: config.stepsFile }, 'step catalog is empty');
if (!config.firestoreProject)
  app.log.warn('MAXI_FIRESTORE_PROJECT unset: logs and budget stay in memory');

await app.listen({ port: config.port, host: config.host });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    corpus.stop();
    void app.close().then(() => process.exit(0));
  });
}
