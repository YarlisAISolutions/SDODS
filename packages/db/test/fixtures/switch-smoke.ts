// Manual round-trip check: sqlite → postgres → sqlite via the library API. Usage:
//   PGURL=postgres://automax:automax@localhost:5432/automax node --import tsx packages/db/test/fixtures/switch-smoke.ts <sqlite.db> <envfile>
import { readFileSync } from 'node:fs';
import { createDb } from '../../src/create-db.js';
import { switchDriver } from '../../src/switch/switch.js';
import { countRows } from '../../src/switch/export.js';
const [sqlitePath, envFile] = process.argv.slice(2);
const pg = process.env.PGURL!;
const src = createDb({ driver: 'sqlite', sqlitePath });
const toPg = await switchDriver({ source: src, target: 'postgres', targetUrl: pg, envFile });
console.log(
  'sqlite→postgres ok=%s tables=%d changes=%s',
  toPg.ok,
  toPg.tables.length,
  toPg.envChanges?.join(','),
);
console.log(
  toPg.tables
    .filter((t) => t.source > 0)
    .map((t) => `${t.table}:${t.source}/${t.target}`)
    .join(' '),
);
await src.close();
console.log(readFileSync(envFile, 'utf8').trim().replace(/\n/g, ' | '));
const pgDb = createDb({ driver: 'postgres', databaseUrl: pg });
const back = await switchDriver({
  source: pgDb,
  target: 'sqlite',
  targetPath: `${sqlitePath}.back`,
  envFile,
});
console.log('postgres→sqlite ok=%s', back.ok, back.envChanges?.join(','));
const roundtrip = createDb({ driver: 'sqlite', sqlitePath: `${sqlitePath}.back` });
for (const t of ['runs', 'scenarios', 'processes', 'td_demo_shop_users'])
  console.log(
    `  ${t}: ${await countRows(pgDb, t)} (pg) = ${await countRows(roundtrip, t)} (sqlite back)`,
  );
await pgDb.close();
await roundtrip.close();
console.log(readFileSync(envFile, 'utf8').trim().replace(/\n/g, ' | '));
