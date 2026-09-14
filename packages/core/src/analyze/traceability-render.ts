import type { TraceabilityReport, TraceResult, TraceScenario } from '@sdods/contracts';

export const TRACEABILITY_FORMATS = ['json', 'csv', 'md', 'html'] as const;
export type TraceabilityFormat = (typeof TRACEABILITY_FORMATS)[number];

const SIGN_OFF_FIELDS = [
  ['signedBy', 'Signed by'],
  ['role', 'Role'],
  ['date', 'Date'],
  ['decision', 'Decision'],
  ['notes', 'Notes'],
] as const;

export function renderTraceability(report: TraceabilityReport, format: TraceabilityFormat): string {
  switch (format) {
    case 'json':
      return `${JSON.stringify(report, null, 2)}\n`;
    case 'csv':
      return renderCsv(report);
    case 'md':
      return renderMarkdown(report);
    case 'html':
      return renderHtml(report);
  }
}

const resultLabel = (r: TraceResult) =>
  `${r.runnerProject}${r.exampleIndex != null ? ` #${r.exampleIndex}` : ''}: ${r.status}${r.flaky ? ' (flaky)' : ''}`;

const duration = (ms?: number) => (ms == null ? '' : `${(ms / 1000).toFixed(1)}s`);

function runLines(report: TraceabilityReport): Array<[string, string]> {
  const run = report.run;
  if (!run) return [['Run', 'none (static matrix)']];
  const git = run.git?.sha
    ? `${run.git.sha}${run.git.branch ? ` (${run.git.branch})` : ''}${run.git.dirty ? ', uncommitted changes' : ''}`
    : '';
  return (
    [
      ['Run', run.id],
      ['Environment', run.env ?? ''],
      ['Started', run.startedAt ?? ''],
      ['Finished', run.finishedAt ?? ''],
      ['Exit code', run.exitCode == null ? '' : String(run.exitCode)],
      ['Git', git],
      ['SDODS version', run.sdodsVersion ?? ''],
      ['Tags', run.tagsExpr ?? ''],
      ['CI', run.ci?.url ?? ''],
      ['Results from', run.resultsSource],
    ] as Array<[string, string]>
  ).filter(([, v]) => v !== '');
}

function summaryLines(report: TraceabilityReport): Array<[string, string]> {
  const s = report.summary;
  return [
    ['Requirements', String(s.requirements)],
    ['Covered', String(s.covered)],
    ['Passed', String(s.passed)],
    ['Failed', String(s.failed)],
    ['Not run', String(s.notRun)],
    ['Not covered', s.notCovered == null ? 'unknown (no requirements file)' : String(s.notCovered)],
    ['Undeclared ids', String(s.undeclared)],
    ['Scenarios', `${s.scenarios} (${s.tracedScenarios} traced, ${s.untracedScenarios} untraced)`],
  ];
}

// ── Markdown ─────────────────────────────────────────────────────────────────

const md = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function mdTable(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(md).join(' | ')} |`),
  ].join('\n');
}

function renderMarkdown(report: TraceabilityReport): string {
  const out: string[] = [];
  out.push(`# Traceability: ${md(report.projectName)} (${report.project})`, '');
  out.push(`Generated ${report.generatedAt}.`, '');
  out.push(mdTable(['Field', 'Value'], runLines(report)), '');
  out.push('## Summary', '', mdTable(['Field', 'Value'], summaryLines(report)), '');
  out.push('## Requirements', '');
  out.push(
    report.requirements.length
      ? mdTable(
          ['Requirement', 'Title', 'Status', 'Scenarios'],
          report.requirements.map((r) => [
            r.url ? `[${r.id}](${r.url})` : r.id,
            `${r.title ?? ''}${r.declared === false ? ' (not in requirements file)' : ''}`,
            r.status,
            String(r.scenarios.length),
          ]),
        )
      : 'No requirements: no scenario carries an `@req:<id>` tag and no requirements file is configured.',
    '',
  );
  for (const r of report.requirements) {
    out.push(`### ${md(r.id)}${r.title ? `: ${md(r.title)}` : ''}`, '');
    out.push(`Status: **${r.status}**`, '');
    if (!r.scenarios.length) {
      out.push('No scenario covers this requirement.', '');
      continue;
    }
    out.push(scenarioTable(r.scenarios), '');
  }
  if (report.untraced.length) {
    out.push('## Scenarios without a requirement', '');
    out.push(
      mdTable(
        ['Scenario', 'Location', 'Status'],
        report.untraced.map((s) => [s.name, `${s.feature}:${s.line}`, s.status]),
      ),
      '',
    );
  }
  out.push('## Notes', '', ...report.notes.map((n) => `- ${n}`), '');
  out.push('## Sign-off', '');
  out.push('To be completed by a person. SDODS does not fill in this section.', '');
  out.push(
    mdTable(
      ['Field', 'Value'],
      SIGN_OFF_FIELDS.map(([, label]) => [label, '']),
    ),
    '',
  );
  return out.join('\n');
}

function scenarioTable(scenarios: TraceScenario[]): string {
  return mdTable(
    ['Scenario', 'Location', 'Tags', 'Status', 'Results', 'Duration'],
    scenarios.map((s) => [
      s.name,
      `${s.feature}:${s.line}`,
      s.tags.join(' '),
      s.status,
      s.results.map(resultLabel).join('; '),
      duration(s.results.reduce((n, r) => n + (r.durationMs ?? 0), 0) || undefined),
    ]),
  );
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells: unknown[]) => cells.map(csvCell).join(',');

/**
 * One row per requirement × scenario × result, so a spreadsheet can filter and pivot it. The
 * sign-off block follows after an empty line, with its values left blank.
 */
function renderCsv(report: TraceabilityReport): string {
  const run = report.run;
  const head = [
    'requirement_id',
    'requirement_title',
    'requirement_url',
    'declared',
    'requirement_status',
    'feature',
    'line',
    'scenario',
    'tags',
    'scenario_status',
    'runner_project',
    'browser',
    'example',
    'result_status',
    'attempts',
    'flaky',
    'duration_ms',
    'finished_at',
    'run_id',
    'env',
    'git_sha',
    'sdods_version',
  ];
  const runCells = [run?.id, run?.env, run?.git?.sha, run?.sdodsVersion];
  const rows: string[] = [csvRow(head)];
  for (const r of report.requirements) {
    const reqCells = [r.id, r.title, r.url, r.declared == null ? '' : r.declared, r.status];
    if (!r.scenarios.length) {
      rows.push(
        csvRow([...reqCells, '', '', '', '', '', '', '', '', '', '', '', '', '', ...runCells]),
      );
      continue;
    }
    for (const s of r.scenarios) {
      const scCells = [s.feature, s.line, s.name, s.tags.join(' '), s.status];
      if (!s.results.length) {
        rows.push(csvRow([...reqCells, ...scCells, '', '', '', '', '', '', '', '', ...runCells]));
        continue;
      }
      for (const res of s.results) {
        rows.push(
          csvRow([
            ...reqCells,
            ...scCells,
            res.runnerProject,
            res.browser,
            res.exampleIndex,
            res.status,
            res.attempts,
            res.flaky,
            res.durationMs,
            res.finishedAt,
            ...runCells,
          ]),
        );
      }
    }
  }
  rows.push('', csvRow(['sign_off', 'value']));
  for (const [key] of SIGN_OFF_FIELDS) rows.push(csvRow([key, '']));
  return `${rows.join('\n')}\n`;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? esc(url) : '');

const badge = (status: string) => `<span class="st st-${esc(status)}">${esc(status)}</span>`;

function renderHtml(report: TraceabilityReport): string {
  const kv = (rows: Array<[string, string]>) =>
    `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const reqLink = (id: string, url?: string) =>
    url && safeHref(url) ? `<a href="${safeHref(url)}">${esc(id)}</a>` : esc(id);

  const overview = report.requirements
    .map(
      (r) =>
        `<tr><td>${reqLink(r.id, r.url)}</td><td>${esc(r.title)}${r.declared === false ? ' <em>(not in requirements file)</em>' : ''}</td><td>${badge(r.status)}</td><td>${r.scenarios.length}</td></tr>`,
    )
    .join('');

  const details = report.requirements
    .map((r) => {
      const body = r.scenarios.length
        ? `<table><thead><tr><th>Scenario</th><th>Location</th><th>Tags</th><th>Status</th><th>Results</th></tr></thead><tbody>${r.scenarios
            .map(
              (s) =>
                `<tr><td>${esc(s.name)}</td><td><code>${esc(`${s.feature}:${s.line}`)}</code></td><td>${esc(s.tags.join(' '))}</td><td>${badge(s.status)}</td><td>${
                  s.results.length
                    ? s.results
                        .map(
                          (x) =>
                            `${esc(resultLabel(x))}${x.durationMs != null ? ` <span class="dim">${esc(duration(x.durationMs))}</span>` : ''}`,
                        )
                        .join('<br>')
                    : '<span class="dim">no result</span>'
                }</td></tr>`,
            )
            .join('')}</tbody></table>`
        : '<p class="dim">No scenario covers this requirement.</p>';
      return `<section><h3>${reqLink(r.id, r.url)}${r.title ? `: ${esc(r.title)}` : ''} ${badge(r.status)}</h3>${body}</section>`;
    })
    .join('');

  const untraced = report.untraced.length
    ? `<h2>Scenarios without a requirement</h2><table><thead><tr><th>Scenario</th><th>Location</th><th>Status</th></tr></thead><tbody>${report.untraced
        .map(
          (s) =>
            `<tr><td>${esc(s.name)}</td><td><code>${esc(`${s.feature}:${s.line}`)}</code></td><td>${badge(s.status)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '';

  const signOff = SIGN_OFF_FIELDS.map(
    ([, label]) => `<tr><th>${esc(label)}</th><td class="blank"></td></tr>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Traceability: ${esc(report.projectName)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a1a;background:#fff;margin:0;padding:24px 16px;max-width:1100px;margin-inline:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}h3{font-size:15px;margin:20px 0 6px}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #d9d9d9;padding:5px 8px;text-align:left;vertical-align:top}
thead th{background:#f4f4f4}table.kv{width:auto}table.kv th{background:#f8f8f8;font-weight:600}
code{font-size:12px}.dim{color:#6b6b6b}.wrap{overflow-x:auto}
.st{display:inline-block;padding:0 6px;border-radius:3px;font-size:12px;font-weight:600;border:1px solid}
.st-passed{color:#11633a;border-color:#11633a}.st-failed{color:#a1161c;border-color:#a1161c}
.st-not-run,.st-skipped{color:#6b5300;border-color:#6b5300}.st-not-covered{color:#5a2d91;border-color:#5a2d91}
td.blank{height:28px;min-width:320px}
@media print{body{padding:0}section{break-inside:avoid}}
</style>
</head>
<body>
<h1>Traceability: ${esc(report.projectName)} <span class="dim">(${esc(report.project)})</span></h1>
<p class="dim">Generated ${esc(report.generatedAt)}</p>
${kv(runLines(report))}
<h2>Summary</h2>
${kv(summaryLines(report))}
<h2>Requirements</h2>
<div class="wrap"><table><thead><tr><th>Requirement</th><th>Title</th><th>Status</th><th>Scenarios</th></tr></thead><tbody>${overview}</tbody></table></div>
<div class="wrap">${details}</div>
${untraced}
<h2>Notes</h2>
<ul>${report.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
<h2>Sign-off</h2>
<p>To be completed by a person. SDODS does not fill in this section.</p>
<table class="kv">${signOff}</table>
</body>
</html>
`;
}
