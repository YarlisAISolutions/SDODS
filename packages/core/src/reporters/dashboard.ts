import { mkdirSync, writeFileSync } from 'node:fs';
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
    // Group failures by error SIGNATURE. Twelve scenarios failing on one broken
    // selector is ONE problem, and a list of twelve reads like twelve. The
    // signature is the first line of the error with volatile parts stripped, so
    // "expected 204, got 403" and "expected 201, got 403" stay distinct while
    // two runs of the same defect collapse.
    const failedRows = rows.filter((r) => r.outcome === 'unexpected');
    const clusters: Record<string, { signature: string; count: number; titles: string[] }> = {};
    for (const r of failedRows) {
      const sig = errorSignature(r.error);
      const c = (clusters[sig] ??= { signature: sig, count: 0, titles: [] });
      c.count++;
      if (c.titles.length < 25) c.titles.push(r.title);
    }

    // Outcome per role tag. A suite where @user:viewer fails and @user:admin
    // passes has a permissions regression, and that is invisible in a total.
    const byRole: Record<string, { total: number; passed: number; failed: number }> = {};
    for (const r of rows) {
      for (const t of r.tags) {
        if (!t.startsWith('@user:')) continue;
        const g = (byRole[t.slice(6)] ??= { total: 0, passed: 0, failed: 0 });
        g.total++;
        if (r.outcome === 'unexpected') g.failed++;
        else if (r.outcome !== 'skipped') g.passed++;
      }
    }

    const metrics = {
      title: this.title,
      generatedAt: new Date().toISOString(),
      summary,
      clusters: Object.values(clusters).sort((a, b) => b.count - a.count),
      byRole,
      slowest: [...rows].sort((a, b) => b.duration - a.duration).slice(0, 15),
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

/**
 * Collapse an error to a stable signature so one root cause reads as one problem.
 * Numbers, ids, timings, quoted literals and paths are the parts that differ
 * between two instances of the SAME defect, so they go; the assertion shape stays.
 */
/** ANSI SGR sequences, built by code point so the source carries no control character. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function errorSignature(error: string | undefined): string {
  if (!error) return 'no error message';
  const firstLine =
    error
      .replace(ANSI, '')
      .split('\n')
      .find((l) => l.trim()) ?? error;
  return firstLine
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\b\d+(?:\.\d+)?\s?ms\b/g, '<time>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/(["'`])(?:[^"'`\\]|\\.)*\1/g, '<str>')
    .replace(/\/[^\s:]+/g, '<path>')
    .trim()
    .slice(0, 200);
}

function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function fmt(ms: number): string {
  return ms < 1000
    ? `${Math.round(ms)}ms`
    : ms < 60_000
      ? `${(ms / 1000).toFixed(1)}s`
      : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

interface Group {
  total: number;
  passed: number;
  failed: number;
  skipped?: number;
  flaky?: number;
}

export interface Metrics {
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
  clusters: { signature: string; count: number; titles: string[] }[];
  byRole: Record<string, Group>;
  slowest: Entry[];
  byProject: Record<string, Group>;
  byLayer: Record<string, Group>;
  byBrowser: Record<string, Group>;
  byTag: Record<string, Group>;
  failed: { fingerprint?: string; title: string; runnerProject: string; error?: string }[];
  flaky: { fingerprint?: string; title: string; runnerProject: string }[];
  tests: Entry[];
}

function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 100) : 0;
}

/**
 * The dashboard is a DECISION surface, not a report.
 *
 * Every run ends with someone asking one of four questions, and the layout answers
 * them in the order they get asked:
 *
 *   1. Can I ship?            -> the verdict line, in words, before any number
 *   2. What do I fix first?   -> failures CLUSTERED by error signature, because
 *                                twelve scenarios failing on one broken selector
 *                                is one problem and a list of twelve reads as twelve
 *   3. Is it real or flaky?   -> flake, retry and heal counts sit beside the verdict,
 *                                not in a footer
 *   4. Do I believe this run? -> skipped and healed are shown as WARNINGS, never
 *                                folded into a pass rate. A suite that skipped a
 *                                third of itself is not 100% green, and a healed
 *                                locator means the application's DOM moved under us
 *
 * The role matrix is the one view a general-purpose reporter never has: when
 * `@user:viewer` fails and `@user:admin` passes, that is a permissions regression,
 * and it is invisible in any total.
 */
export function renderHtml(m: Metrics): string {
  const s = m.summary;
  const executed = s.total - s.skipped;
  const passRate = pct(s.passed + s.flaky, executed);
  const skipRate = pct(s.skipped, s.total);
  const blocking = s.failed + s.timedOut;

  const verdict = blocking
    ? {
        word: 'Failing',
        cls: 'bad',
        line: `${blocking} scenario${blocking === 1 ? '' : 's'} failed across ${m.clusters.length} distinct cause${m.clusters.length === 1 ? '' : 's'}.`,
      }
    : s.total === 0
      ? {
          word: 'Nothing ran',
          cls: 'bad',
          line: 'No scenario was executed. A run that registers nothing exits 0 and looks identical to a green run — it is not.',
        }
      : executed === 0
        ? {
            word: 'Nothing ran',
            cls: 'bad',
            line: `All ${s.total} scenarios were skipped. Skipped is not passed.`,
          }
        : s.flaky
          ? {
              word: 'Passing, with flake',
              cls: 'warn',
              line: `${s.flaky} scenario${s.flaky === 1 ? '' : 's'} only passed on retry. Treat as unproven until the cause is known.`,
            }
          : {
              word: 'Passing',
              cls: 'ok',
              line: `${executed} scenario${executed === 1 ? '' : 's'} executed, all green.`,
            };

  // Warnings are things that make a green run untrustworthy. They are deliberately
  // NOT folded into the pass rate, because averaging them away is how a suite stops
  // measuring anything without anyone noticing.
  const warnings: string[] = [];
  if (skipRate > 5)
    warnings.push(
      `${s.skipped} of ${s.total} scenarios (${skipRate}%) were skipped. A skip is an untested path, not a pass.`,
    );
  if (s.healed)
    warnings.push(
      `${s.healed} scenario${s.healed === 1 ? '' : 's'} needed a healed locator. The application's DOM moved — the test passed, but the selector it was written against no longer matches.`,
    );
  if (s.flaky)
    warnings.push(`${s.flaky} scenario${s.flaky === 1 ? '' : 's'} passed only on retry.`);

  const stat = (label: string, value: string | number, sub = '', cls = '') =>
    `<div class="stat ${cls}"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`;

  const clusterCards = m.clusters
    .map(
      (c, i) => `<details class="cluster"${i === 0 ? ' open' : ''}>
      <summary><span class="count">${c.count}&times;</span><code>${esc(c.signature)}</code></summary>
      <ul>${c.titles.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </details>`,
    )
    .join('');

  const roleRows = Object.entries(m.byRole)
    .sort((a, b) => b[1].failed - a[1].failed || a[0].localeCompare(b[0]))
    .map(
      ([role, g]) => `<tr class="${g.failed ? 'row-bad' : ''}">
        <td><span class="tag">@user:${esc(role)}</span></td>
        <td class="num">${g.total}</td>
        <td class="num ok">${g.passed}</td>
        <td class="num ${g.failed ? 'bad' : 'muted'}">${g.failed}</td>
        <td class="barcell">${bar(g.passed, g.failed, g.total)}</td>
      </tr>`,
    )
    .join('');

  const groupTable = (
    title: string,
    data: Record<
      string,
      { total: number; passed: number; failed: number; skipped?: number; flaky?: number }
    >,
    label: string,
  ) => {
    const rows = Object.entries(data)
      .sort((a, b) => b[1].failed - a[1].failed || b[1].total - a[1].total)
      .slice(0, 40);
    if (!rows.length) return '';
    return `<section><h2>${esc(title)}</h2><table>
      <thead><tr><th>${esc(label)}</th><th class="num">Total</th><th class="num">Passed</th><th class="num">Failed</th><th></th></tr></thead>
      <tbody>${rows
        .map(
          ([k, g]) => `<tr class="${g.failed ? 'row-bad' : ''}">
          <td>${esc(k)}</td><td class="num">${g.total}</td>
          <td class="num ok">${g.passed}</td>
          <td class="num ${g.failed ? 'bad' : 'muted'}">${g.failed}</td>
          <td class="barcell">${bar(g.passed, g.failed, g.total)}</td>
        </tr>`,
        )
        .join('')}</tbody></table></section>`;
  };

  const slowRows = m.slowest
    .filter((t: Entry) => t.duration > 0)
    .map(
      (t: Entry) =>
        `<tr><td>${esc(t.title)}</td><td class="num">${esc(fmt(t.duration))}</td><td>${t.tags
          .map((x: string) => `<span class="tag">${esc(x)}</span>`)
          .join(' ')}</td></tr>`,
    )
    .join('');

  const testRows = m.tests
    .map(
      (t: Entry) => `<tr data-status="${esc(t.outcome)}" data-text="${esc(
        `${t.title} ${t.tags.join(' ')} ${t.projectName}`.toLowerCase(),
      )}">
      <td><span class="pill ${esc(t.outcome)}">${esc(t.outcome)}</span></td>
      <td>${esc(t.title)}</td>
      <td>${t.tags.map((x: string) => `<span class="tag">${esc(x)}</span>`).join(' ')}</td>
      <td class="num">${esc(fmt(t.duration))}</td>
      <td class="num">${t.retries || ''}</td>
      <td class="num">${t.heals || ''}</td>
    </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.title)}</title>
<style>
:root{
  --bg:#fbfbfd; --panel:#fff; --ink:#16181d; --muted:#6b7280; --line:#e6e8ec;
  --ok:#0f9d58; --bad:#d93025; --warn:#e37400; --accent:#3b5bdb;
  --ok-bg:#e8f5ec; --bad-bg:#fdecea; --warn-bg:#fff4e5;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0e1014; --panel:#171a21; --ink:#e8eaed; --muted:#9aa0a6; --line:#2a2f39;
  --ok:#4ade80; --bad:#f87171; --warn:#fbbf24; --accent:#8ea2ff;
  --ok-bg:#12291c; --bad-bg:#2c1618; --warn-bg:#2b2110;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:20px;margin:0 0 2px;font-weight:650}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
  margin:34px 0 10px;font-weight:650}
.sub{color:var(--muted);font-size:13px;margin-bottom:22px}
.verdict{border-radius:14px;padding:20px 22px;margin-bottom:22px;border:1px solid var(--line);background:var(--panel)}
.verdict.ok{background:var(--ok-bg);border-color:var(--ok)}
.verdict.bad{background:var(--bad-bg);border-color:var(--bad)}
.verdict.warn{background:var(--warn-bg);border-color:var(--warn)}
.verdict .word{font-size:26px;font-weight:680;letter-spacing:-.02em}
.verdict.ok .word{color:var(--ok)} .verdict.bad .word{color:var(--bad)} .verdict.warn .word{color:var(--warn)}
.verdict .line{margin-top:4px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;margin-bottom:8px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.stat .v{font-size:24px;font-weight:650;letter-spacing:-.02em}
.stat .l{color:var(--muted);font-size:12px;margin-top:2px}
.stat .s{color:var(--muted);font-size:11px;margin-top:3px}
.stat.bad .v{color:var(--bad)} .stat.ok .v{color:var(--ok)} .stat.warn .v{color:var(--warn)}
.warnings{margin:18px 0 0;padding:0;list-style:none}
.warnings li{background:var(--warn-bg);border:1px solid var(--warn);border-radius:10px;
  padding:10px 14px;margin-bottom:8px;font-size:13.5px}
table{width:100%;border-collapse:collapse;background:var(--panel);
  border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:13.5px}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:650}
tbody tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.ok{color:var(--ok)} td.bad{color:var(--bad);font-weight:650} td.muted{color:var(--muted)}
tr.row-bad td:first-child{box-shadow:inset 3px 0 0 var(--bad)}
.barcell{width:150px}
.bar{display:flex;height:7px;border-radius:4px;overflow:hidden;background:var(--line);min-width:110px}
.bar i{display:block;height:100%}
.bar .p{background:var(--ok)} .bar .f{background:var(--bad)}
.tag{display:inline-block;background:var(--line);color:var(--muted);border-radius:5px;
  padding:1px 6px;font-size:11px;margin:1px 2px 1px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pill{display:inline-block;border-radius:5px;padding:1px 8px;font-size:11px;font-weight:650;text-transform:uppercase}
.pill.expected{background:var(--ok-bg);color:var(--ok)}
.pill.unexpected{background:var(--bad-bg);color:var(--bad)}
.pill.flaky{background:var(--warn-bg);color:var(--warn)}
.pill.skipped{background:var(--line);color:var(--muted)}
.cluster{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--bad);
  border-radius:10px;margin-bottom:10px;padding:12px 16px}
.cluster summary{cursor:pointer;display:flex;gap:10px;align-items:baseline}
.cluster summary::marker{color:var(--muted)}
.cluster .count{color:var(--bad);font-weight:680;white-space:nowrap}
.cluster code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;word-break:break-word}
.cluster ul{margin:10px 0 2px 4px;padding-left:16px;color:var(--muted);font-size:13px}
.cluster li{margin:3px 0}
.controls{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.controls input,.controls select{background:var(--panel);border:1px solid var(--line);color:var(--ink);
  border-radius:8px;padding:7px 11px;font:inherit;font-size:13px}
.controls input{flex:1;min-width:220px}
.controls input:focus-visible,.controls select:focus-visible,.cluster summary:focus-visible{
  outline:2px solid var(--accent);outline-offset:2px}
.empty{color:var(--muted);font-style:italic;padding:14px 0}
footer{margin-top:44px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
</style></head><body><div class="wrap">

<h1>${esc(m.title)}</h1>
<div class="sub">${esc(new Date(m.generatedAt).toUTCString())} &middot; ${esc(fmt(s.durationMs))} wall clock &middot; ${s.workers} worker${s.workers === 1 ? '' : 's'}</div>

<div class="verdict ${verdict.cls}">
  <div class="word">${esc(verdict.word)}</div>
  <div class="line">${esc(verdict.line)}</div>
</div>

<div class="stats">
  ${stat('Pass rate', `${passRate}%`, `${s.passed + s.flaky} of ${executed} executed`, blocking ? 'bad' : 'ok')}
  ${stat('Failed', blocking, blocking ? `${m.clusters.length} distinct cause${m.clusters.length === 1 ? '' : 's'}` : 'none', blocking ? 'bad' : '')}
  ${stat('Skipped', s.skipped, `${skipRate}% of the suite`, skipRate > 5 ? 'warn' : '')}
  ${stat('Flaky', s.flaky, s.flaky ? 'passed only on retry' : 'none', s.flaky ? 'warn' : '')}
  ${stat('Healed', s.healed, s.healed ? 'the DOM moved' : 'none', s.healed ? 'warn' : '')}
  ${stat('Executed', executed, `of ${s.total} registered`)}
</div>

${warnings.length ? `<ul class="warnings">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}

<h2>What to fix first</h2>
${m.clusters.length ? clusterCards : '<div class="empty">Nothing failed.</div>'}

${
  roleRows
    ? `<section><h2>By role &mdash; a role that fails alone is a permissions regression</h2>
<table><thead><tr><th>Role</th><th class="num">Total</th><th class="num">Passed</th><th class="num">Failed</th><th></th></tr></thead>
<tbody>${roleRows}</tbody></table></section>`
    : ''
}

${groupTable('By module tag', m.byTag, 'Tag')}
${groupTable('By layer', m.byLayer, 'Layer')}
${groupTable('By browser', m.byBrowser, 'Browser')}
${groupTable('By runner project', m.byProject, 'Project')}

${
  slowRows
    ? `<section><h2>Slowest scenarios</h2><table>
<thead><tr><th>Scenario</th><th class="num">Duration</th><th>Tags</th></tr></thead>
<tbody>${slowRows}</tbody></table></section>`
    : ''
}

<h2>All scenarios</h2>
<div class="controls">
  <input id="q" type="search" placeholder="Filter by title, tag or project&hellip;" aria-label="Filter scenarios">
  <select id="st" aria-label="Filter by status">
    <option value="">All statuses</option>
    <option value="unexpected">Failed</option>
    <option value="flaky">Flaky</option>
    <option value="expected">Passed</option>
    <option value="skipped">Skipped</option>
  </select>
</div>
<table id="all"><thead><tr><th>Status</th><th>Scenario</th><th>Tags</th><th class="num">Time</th><th class="num">Retries</th><th class="num">Heals</th></tr></thead>
<tbody>${testRows}</tbody></table>
<div class="empty" id="none" hidden>No scenario matches that filter.</div>

<footer>Generated by SDODS &middot; metrics.json sits beside this file for scripting.</footer>
</div>
<script>
(function(){
  var q=document.getElementById('q'),st=document.getElementById('st'),
      rows=[].slice.call(document.querySelectorAll('#all tbody tr')),none=document.getElementById('none');
  function apply(){
    var t=q.value.trim().toLowerCase(), s=st.value, shown=0;
    rows.forEach(function(r){
      var ok=(!t||r.dataset.text.indexOf(t)>-1)&&(!s||r.dataset.status===s);
      r.hidden=!ok; if(ok)shown++;
    });
    none.hidden=shown>0;
  }
  q.addEventListener('input',apply); st.addEventListener('change',apply);
})();
</script>
</body></html>`;
}

function bar(passed: number, failed: number, total: number): string {
  if (!total) return '';
  return `<div class="bar" role="img" aria-label="${passed} passed, ${failed} failed of ${total}"><i class="p" style="width:${pct(passed, total)}%"></i><i class="f" style="width:${pct(failed, total)}%"></i></div>`;
}
