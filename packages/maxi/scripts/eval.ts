/**
 * Runs Maxi against evals/golden.yaml and prints a pass/fail table with the measured cost.
 * Calls the real API, so it spends money (a few cents a case): run it before launch, after
 * persona or model changes, and when the docs change a lot.
 *
 *   ANTHROPIC_API_KEY=... bun run --filter @sdods/maxi eval
 *   ... eval -- --only install,write-api        run some cases
 *   MAXI_CORPUS_FILE=$PWD/apps/docs/out/llms-full.txt   a local docs build instead of the live site (absolute path)
 *   ANTHROPIC_WORKSPACE_ID=wrkspc_...                  needed when the key is not scoped to a workspace
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { runChat } from '../src/chat.js';
import { createClient } from '../src/client.js';
import { loadConfig } from '../src/config.js';
import { Corpus } from '../src/corpus.js';
import { estimateCostUsd } from '../src/limits.js';
import { systemBlocks } from '../src/prompt.js';
import { loadSteps, StepCatalog, validateFeature } from '../src/tools.js';

interface Case {
  id: string;
  question: string;
  page?: string;
  cite?: string;
  include?: string[];
  exclude?: string[];
  feature?: boolean;
  featureExclude?: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const cases = parse(readFileSync(join(here, '..', 'evals', 'golden.yaml'), 'utf8')) as Case[];
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1]!.split(',')) : undefined;

const config = loadConfig();
// A local docs build (MAXI_CORPUS_FILE) takes precedence, so an eval can check docs before they deploy.
let docs: { text: string; hash: string };
if (config.corpusFile) {
  docs = { text: readFileSync(config.corpusFile, 'utf8'), hash: `file:${config.corpusFile}` };
} else {
  const corpus = new Corpus({ url: config.corpusUrl, refreshMs: 0 });
  await corpus.load();
  if (!corpus.current)
    throw new Error(`Could not load ${config.corpusUrl}; set MAXI_CORPUS_FILE instead`);
  docs = corpus.current;
}
const catalog = new StepCatalog(loadSteps(config.stepsFile));
const client = createClient();
const system = systemBlocks(config, docs.text);

const rows: Array<{
  id: string;
  pass: boolean;
  problems: string[];
  costUsd: number;
  cacheRead: number;
}> = [];
let totalCost = 0;
for (const c of cases) {
  if (only && !only.has(c.id)) continue;
  let answer = '';
  let costUsd = 0;
  let cacheRead = 0;
  let failed: string | undefined;
  for await (const e of runChat(
    {
      client,
      model: config.model,
      maxTokens: config.maxTokens,
      system,
      catalog,
      log: (msg, extra) => console.error(`      ${msg} ${JSON.stringify(extra)}`),
    },
    c.id,
    [{ role: 'user', content: c.question }],
    {
      page: c.page,
      onComplete: (r) => {
        costUsd = estimateCostUsd(config.model, r.usage);
        cacheRead = r.usage.cache_read_input_tokens;
      },
    },
  )) {
    if (e.event === 'text') answer += e.data.text;
    if (e.event === 'error') failed = e.data.message;
  }
  totalCost += costUsd;

  const problems: string[] = [];
  if (failed) problems.push(`error: ${failed}`);
  if (c.cite && !answer.includes(c.cite)) problems.push(`no link to ${c.cite}`);
  for (const re of c.include ?? [])
    if (!new RegExp(re, 'i').test(answer)) problems.push(`missing /${re}/`);
  for (const re of c.exclude ?? [])
    if (new RegExp(re, 'i').test(answer)) problems.push(`contains /${re}/`);
  if (c.feature) {
    const block = /```gherkin\n([\s\S]*?)```/.exec(answer)?.[1];
    if (!block) problems.push('no gherkin block');
    else {
      const report = validateFeature(block, catalog);
      if (!report.valid)
        problems.push(
          `feature invalid: ${[...report.syntaxErrors, ...report.tagProblems].join('; ')}`,
        );
    }
  }
  rows.push({ id: c.id, pass: problems.length === 0, problems, costUsd, cacheRead });
  console.log(
    `${problems.length ? 'FAIL' : 'pass'}  ${c.id.padEnd(24)} $${costUsd.toFixed(4)}  ${problems.join(' | ')}`,
  );
  if (problems.length && process.env.MAXI_EVAL_VERBOSE)
    console.log(`      ${answer.replace(/\n/g, '\n      ')}\n`);
}

const passed = rows.filter((r) => r.pass).length;
console.log(
  `\n${passed}/${rows.length} passed · model ${config.model} · docs ${docs.hash} · $${totalCost.toFixed(2)} total`,
);
const out = join(here, '..', 'evals', 'last-run.json');
writeFileSync(
  out,
  `${JSON.stringify({ model: config.model, corpus: docs.hash, passed, total: rows.length, costUsd: totalCost, rows }, null, 2)}\n`,
);
process.exitCode = passed === rows.length ? 0 : 1;
