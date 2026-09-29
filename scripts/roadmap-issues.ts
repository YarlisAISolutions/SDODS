/**
 * Files a GitHub issue for every roadmap stop whose month or year has ended undelivered.
 *
 * Run monthly by `.github/workflows/roadmap.yml`. One issue per checkpoint, labelled `roadmap`
 * and carrying a hidden `<!-- roadmap:<id> -->` marker, so a second run finds it instead of
 * filing a duplicate, even after it was closed. When a stop is later marked delivered in
 * `packages/roadmap/src/`, its open issue is closed with a pointer to the proof.
 *
 *   node --import tsx scripts/roadmap-issues.ts --dry-run
 *   ROADMAP_TODAY=2027-03 node --import tsx scripts/roadmap-issues.ts --dry-run
 *
 * Needs `gh` authenticated (GH_TOKEN in CI) unless --dry-run.
 */
import { execFileSync } from 'node:child_process';
import { CHECKPOINTS, TODAY_MONTH, isMonth, overdue, type Checkpoint } from '@sdods/roadmap';

const LABEL = 'roadmap';
const marker = (id: string) => `<!-- roadmap:${id} -->`;
const ROADMAP_URL = 'https://sdods.com/roadmap/';
const DOCS_URL = 'https://docs.sdods.com/docs/roadmap/';

interface Issue {
  number: number;
  state: 'OPEN' | 'CLOSED';
  body: string;
}

function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
}

export function titleOf(checkpoint: Checkpoint): string {
  return `Roadmap overdue · ${checkpoint.label} — ${checkpoint.title}`;
}

export function bodyOf(checkpoint: Checkpoint, today: string): string {
  const due = isMonth(checkpoint)
    ? `the end of ${checkpoint.label}`
    : `the end of ${checkpoint.when}`;
  return [
    marker(checkpoint.id),
    `This roadmap stop was due by ${due} and is not marked delivered (state: \`${checkpoint.state}\`, checked ${today}).`,
    '',
    `**Goal.** ${checkpoint.goal}`,
    '',
    '**What ships**',
    ...checkpoint.ships.map((item) => `- [ ] ${item}`),
    '',
    `**Proof it landed.** ${checkpoint.proof}`,
    '',
    'To resolve: ship it and mark the stop `delivered` in `packages/roadmap/src/checkpoints.ts` ' +
      '(rewriting `ships` and `proof` to what actually landed), or move it to a later month. ' +
      'The next monthly run closes this issue once the stop is delivered.',
    '',
    `Roadmap: ${ROADMAP_URL} · ${DOCS_URL}#${checkpoint.id}`,
  ].join('\n');
}

function existing(): Map<string, Issue> {
  const raw = gh([
    'issue',
    'list',
    '--label',
    LABEL,
    '--state',
    'all',
    '--limit',
    '1000',
    '--json',
    'number,state,body',
  ]);
  const byId = new Map<string, Issue>();
  for (const issue of JSON.parse(raw) as Issue[]) {
    const id = /<!-- roadmap:([\w-]+) -->/.exec(issue.body)?.[1];
    if (id) byId.set(id, issue);
  }
  return byId;
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const due = overdue();
  console.log(`roadmap-issues — today is ${TODAY_MONTH}; ${due.length} overdue stop(s)`);

  if (dryRun) {
    for (const c of due) console.log(`  would file: ${titleOf(c)}`);
    return;
  }

  const issues = existing();
  // Only touched when there is something to file, so a quiet month needs no write access.
  if (due.some((c) => !issues.has(c.id))) {
    gh([
      'label',
      'create',
      LABEL,
      '--color',
      'B60205',
      '--description',
      'A roadmap stop whose time has passed',
      '--force',
    ]);
  }

  for (const checkpoint of due) {
    const found = issues.get(checkpoint.id);
    if (found) {
      console.log(
        `  #${found.number} already tracks ${checkpoint.id} (${found.state.toLowerCase()})`,
      );
      continue;
    }
    const url = gh(
      ['issue', 'create', '--title', titleOf(checkpoint), '--label', LABEL, '--body-file', '-'],
      bodyOf(checkpoint, TODAY_MONTH),
    ).trim();
    console.log(`  filed ${url}`);
  }

  for (const checkpoint of CHECKPOINTS.filter((c) => c.state === 'delivered')) {
    const found = issues.get(checkpoint.id);
    if (found?.state !== 'OPEN') continue;
    gh([
      'issue',
      'close',
      String(found.number),
      '--reason',
      'completed',
      '--comment',
      `Marked delivered in \`packages/roadmap\`. Proof: ${checkpoint.proof}`,
    ]);
    console.log(`  closed #${found.number}: ${checkpoint.id} is delivered`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
