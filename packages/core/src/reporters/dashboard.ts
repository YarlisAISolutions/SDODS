import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { parseRunnerProjectName } from '@sdods/contracts';

interface Entry {
  id: string;
  title: string;
  fullTitle: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  outcome: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  duration: number;
  error?: string;
  retries: number;
  projectName: string;
  layer: string;
  browser: string;
  tags: string[];
  file: string;
  heals: number;
  fingerprint?: string;
}

export interface DashboardOptions {
  outputDir?: string;
  title?: string;
}

/**
 * SDODS dashboard reporter (ported from the reference custom-reporter, fixed):
 * one row per test (keyed by test.id, retries do not inflate counts), escaped HTML,
 * Chart.js inlined so the file works offline, metrics.json for the CLI summary.
 */
export default class DashboardReporter implements Reporter {
  private readonly outputDir: string;
  private readonly title: string;
  private readonly entries = new Map<string, Entry>();
  private startedAt = Date.now();
  private workers = 0;

  constructor(options: DashboardOptions = {}) {
    this.outputDir = options.outputDir ?? 'test-results/sdods-dashboard';
    this.title = options.title ?? 'SDODS run';
  }

  onBegin(config: FullConfig, _suite: Suite) {
    this.startedAt = Date.now();
    this.workers = config.workers;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const parts = parseRunnerProjectName(test.parent.project()?.name ?? '');
    const fingerprint = test.annotations.find((a) => a.type === 'sdods:fingerprint')?.description;
    const heals = test.annotations.filter((a) => a.type === 'sdods:heal').length;
    const outcome = test.outcome();
    this.entries.set(test.id, {
      id: test.id,
      title: test.title,
      fullTitle: test.titlePath().filter(Boolean).join(' › '),
      status: result.status,
      outcome,
      duration: result.duration,
      error: result.error?.message?.slice(0, 1000),
      retries: result.retry,
      projectName: test.parent.project()?.name ?? '',
      layer: parts?.layer ?? '',
      browser: parts?.browser ?? '',
      tags: test.tags,
      file: test.location.file,
      heals,
      fingerprint,
    });
  }

  async onEnd(_result: FullResult) {
    const rows = [...this.entries.values()];
    const summary = {
      total: rows.length,
      passed: rows.filter((r) => r.outcome === 'expected').length,
      failed: rows.filter((r) => r.outcome === 'unexpected').length,
      skipped: rows.filter((r) => r.outcome === 'skipped').length,
      timedOut: rows.filter((r) => r.status === 'timedOut').length,
      flaky: rows.filter((r) => r.outcome === 'flaky').length,
      healed: rows.filter((r) => r.heals > 0).length,
      durationMs: Date.now() - this.startedAt,
      workers: this.workers,
    };
    const group = (key: keyof Entry) => {
      const out: Record<
        string,
        { total: number; passed: number; failed: number; skipped: number; flaky: number }
      > = {};
      for (const r of rows) {
        const k = String(r[key] || '(none)');
        const g = (out[k] ??= { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 });
        g.total++;
        if (r.outcome === 'expected') g.passed++;
        else if (r.outcome === 'unexpected') g.failed++;
        else if (r.outcome === 'skipped') g.skipped++;
        else if (r.outcome === 'flaky') g.flaky++;
      }
      return out;
    };
    const byTag: Record<string, { total: number; passed: number; failed: number }> = {};
    for (const r of rows) {
      for (const t of r.tags) {
        const g = (byTag[t] ??= { total: 0, passed: 0, failed: 0 });
        g.total++;
        if (r.outcome === 'expected' || r.outcome === 'flaky') g.passed++;
        if (r.outcome === 'unexpected') g.failed++;
      }
    }
    const metrics = {
      title: this.title,
      generatedAt: new Date().toISOString(),
      summary,
      byProject: group('projectName'),
      byLayer: group('layer'),
      byBrowser: group('browser'),
      byTag,
      failed: rows
        .filter((r) => r.outcome === 'unexpected')
        .map((r) => ({
          fingerprint: r.fingerprint,
          title: r.fullTitle,
          runnerProject: r.projectName,
          error: r.error,
        })),
      flaky: rows
        .filter((r) => r.outcome === 'flaky')
        .map((r) => ({
          fingerprint: r.fingerprint,
          title: r.fullTitle,
          runnerProject: r.projectName,
        })),
      tests: rows,
    };
    mkdirSync(this.outputDir, { recursive: true });
    writeFileSync(join(this.outputDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
    writeFileSync(join(this.outputDir, 'index.html'), renderHtml(metrics));
  }

  printsToStdio() {
    return false;
  }
}

function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function chartJs(): string {
  try {
    const require = createRequire(import.meta.url);
    const file = require.resolve('chart.js/dist/chart.umd.js');
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

function fmt(ms: number): string {
  return ms < 1000
    ? `${Math.round(ms)}ms`
    : ms < 60_000
      ? `${(ms / 1000).toFixed(1)}s`
      : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function renderHtml(m: Metrics): string {
  const s = m.summary;
  const passRate = s.total ? Math.round(((s.passed + s.flaky) / s.total) * 100) : 0;
  const card = (label: string, value: string | number, cls = '') =>
    `<div class="card ${cls}"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;
  const projectRows = Object.entries(m.byProject)
    .map(
      ([name, g]) =>
        `<tr><td>${esc(name)}</td><td>${g.total}</td><td class="ok">${g.passed}</td><td class="bad">${g.failed}</td><td>${g.skipped}</td><td class="warn">${g.flaky}</td></tr>`,
    )
    .join('');
  const testRows = m.tests
    .map(
      (t) =>
        `<tr class="${esc(t.outcome)}"><td>${esc(t.fullTitle)}</td><td>${esc(t.projectName)}</td><td><span class="pill ${esc(t.outcome)}">${esc(t.outcome === 'expected' ? 'passed' : t.outcome === 'unexpected' ? 'failed' : t.outcome)}</span></td><td>${fmt(t.duration)}</td><td>${t.retries}</td><td>${t.heals}</td><td class="tags">${t.tags.map((x) => `<code>${esc(x)}</code>`).join(' ')}</td></tr>`,
    )
    .join('');
  const failedCards = m.failed
    .map(
      (f) =>
        `<div class="fail"><div class="t">${esc(f.title)} <small>${esc(f.runnerProject)}</small></div><pre>${esc(f.error ?? '')}</pre></div>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.title)} · SDODS dashboard</title>
<style>
:root{--bg:#0f172a;--panel:#1e293b;--text:#e2e8f0;--dim:#94a3b8;--ok:#22c55e;--bad:#ef4444;--warn:#f59e0b;--skip:#64748b;--accent:#6366f1}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Inter,Roboto,sans-serif;background:var(--bg);color:var(--text)}
header{padding:20px 28px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center}
h1{margin:0;font-size:20px}h1 span{color:var(--accent)}header small{color:var(--dim)}
main{padding:24px 28px;display:grid;gap:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.card{background:var(--panel);border-radius:10px;padding:14px 16px}.card .v{font-size:26px;font-weight:700}.card .l{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.card.ok .v{color:var(--ok)}.card.bad .v{color:var(--bad)}.card.warn .v{color:var(--warn)}
.bar{height:10px;background:#334155;border-radius:6px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--ok),#10b981)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}.panel{background:var(--panel);border-radius:10px;padding:16px}.panel h2{margin:0 0 10px;font-size:14px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #334155;vertical-align:top}th{color:var(--dim);font-weight:600}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.pill{padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:#334155}.pill.expected{background:#14532d;color:#86efac}.pill.unexpected{background:#7f1d1d;color:#fecaca}.pill.flaky{background:#78350f;color:#fde68a}.pill.skipped{background:#334155;color:#cbd5e1}
code{background:#0f172a;padding:1px 6px;border-radius:4px;font-size:11px;color:#c7d2fe}.tags{max-width:340px}
.fail{background:#1f1523;border:1px solid #7f1d1d;border-radius:8px;padding:12px;margin-bottom:10px}.fail .t{font-weight:600}.fail small{color:var(--dim);margin-left:6px}.fail pre{white-space:pre-wrap;color:#fecaca;font-size:12px;margin:8px 0 0}
canvas{max-height:260px}
</style></head><body>
<header><h1><span>SDODS</span> · ${esc(m.title)}</h1><small>${esc(m.generatedAt)} · ${s.workers} workers · ${fmt(s.durationMs)}</small></header>
<main>
<div class="cards">${card('Total', s.total)}${card('Passed', s.passed, 'ok')}${card('Failed', s.failed, 'bad')}${card('Flaky', s.flaky, 'warn')}${card('Skipped', s.skipped)}${card('Healed', s.healed, 'warn')}${card('Pass rate', passRate + '%', passRate === 100 ? 'ok' : passRate < 80 ? 'bad' : 'warn')}</div>
<div class="bar"><i style="width:${passRate}%"></i></div>
<div class="grid">
<div class="panel"><h2>Status</h2><canvas id="status"></canvas></div>
<div class="panel"><h2>By project</h2><canvas id="project"></canvas></div>
<div class="panel"><h2>By tag</h2><canvas id="tag"></canvas></div>
<div class="panel"><h2>Duration (top 20)</h2><canvas id="duration"></canvas></div>
</div>
<div class="panel"><h2>Projects</h2><table><thead><tr><th>Project</th><th>Total</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Flaky</th></tr></thead><tbody>${projectRows}</tbody></table></div>
${m.failed.length ? `<div class="panel"><h2>Failures</h2>${failedCards}</div>` : ''}
<div class="panel"><h2>All tests</h2><table><thead><tr><th>Test</th><th>Project</th><th>Status</th><th>Duration</th><th>Retries</th><th>Heals</th><th>Tags</th></tr></thead><tbody>${testRows}</tbody></table></div>
</main>
<script>${chartJs()}</script>
<script>
(function(){if(typeof Chart==='undefined')return;const M=${JSON.stringify({ summary: s, byProject: m.byProject, byTag: m.byTag, durations: m.tests.slice(0, 20).map((t) => ({ t: t.title.slice(0, 40), d: t.duration })) })};
Chart.defaults.color='#94a3b8';
new Chart(document.getElementById('status'),{type:'doughnut',data:{labels:['Passed','Failed','Flaky','Skipped'],datasets:[{data:[M.summary.passed,M.summary.failed,M.summary.flaky,M.summary.skipped],backgroundColor:['#22c55e','#ef4444','#f59e0b','#64748b']}]},options:{plugins:{legend:{position:'bottom'}}}});
const P=Object.keys(M.byProject);new Chart(document.getElementById('project'),{type:'bar',data:{labels:P,datasets:[{label:'Passed',data:P.map(k=>M.byProject[k].passed),backgroundColor:'#22c55e'},{label:'Failed',data:P.map(k=>M.byProject[k].failed),backgroundColor:'#ef4444'},{label:'Flaky',data:P.map(k=>M.byProject[k].flaky),backgroundColor:'#f59e0b'}]},options:{scales:{x:{stacked:true},y:{stacked:true}}}});
const T=Object.keys(M.byTag);new Chart(document.getElementById('tag'),{type:'bar',data:{labels:T,datasets:[{label:'Passed',data:T.map(k=>M.byTag[k].passed),backgroundColor:'#22c55e'},{label:'Failed',data:T.map(k=>M.byTag[k].failed),backgroundColor:'#ef4444'}]},options:{indexAxis:'y',scales:{x:{stacked:true},y:{stacked:true}}}});
new Chart(document.getElementById('duration'),{type:'bar',data:{labels:M.durations.map(x=>x.t),datasets:[{label:'ms',data:M.durations.map(x=>x.d),backgroundColor:'#6366f1'}]},options:{plugins:{legend:{display:false}}}});
})();
</script></body></html>`;
}

interface Group {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}
interface Metrics {
  title: string;
  generatedAt: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    timedOut: number;
    flaky: number;
    healed: number;
    durationMs: number;
    workers: number;
  };
  byProject: Record<string, Group>;
  byLayer: Record<string, Group>;
  byBrowser: Record<string, Group>;
  byTag: Record<string, { total: number; passed: number; failed: number }>;
  failed: Array<{ fingerprint?: string; title: string; runnerProject: string; error?: string }>;
  flaky: Array<{ fingerprint?: string; title: string; runnerProject: string }>;
  tests: Entry[];
}
