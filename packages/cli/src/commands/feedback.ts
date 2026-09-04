import { execa } from 'execa';
import type { Command } from 'commander';
import pc from 'picocolors';
import { VERSION } from '@sdods/core';
import { json, out } from '../ui.js';

const REPO = 'https://github.com/siri1410/SDODS';
const DISCUSSIONS = `${REPO}/discussions/categories/ideas`;

/**
 * `sdods feedback` — open a prefilled GitHub issue (feature request or bug report).
 * No backend: the URL carries the fields; bug reports embed the doctor summary.
 */
export function register(program: Command) {
  program
    .command('feedback')
    .description(
      'Request a feature or report a bug (prefilled GitHub issue; opens in your browser)',
    )
    .option('--feature', 'feature request (default)')
    .option('--bug', 'bug report with environment details from `sdods doctor`')
    .option('--discuss', 'print the Discussions (ideas) URL instead')
    .option('-t, --title <text>', 'issue title')
    .option('-m, --message <text>', 'problem statement or observed behaviour')
    .option('--open', 'open the URL in the default browser')
    .action(async (opts, cmd) => {
      const root = cmd.parent ?? cmd;
      const asJson = Boolean(root.opts().json);
      let url: string;
      if (opts.discuss) {
        url = DISCUSSIONS;
      } else if (opts.bug) {
        const params = new URLSearchParams({
          template: 'bug_report.yml',
          title: opts.title ? `[Bug] ${opts.title}` : '[Bug] ',
          labels: 'bug,triage',
          'sdods-version': VERSION,
          os: osLabel(),
        });
        const doctor = await doctorSummary();
        if (doctor) params.set('doctor', doctor);
        if (opts.message) params.set('actual', opts.message);
        url = `${REPO}/issues/new?${params.toString()}`;
      } else {
        const params = new URLSearchParams({
          template: 'feature_request.yml',
          title: opts.title ? `[Feature] ${opts.title}` : '[Feature] ',
          labels: 'enhancement,triage',
          'sdods-version': VERSION,
        });
        if (opts.message) params.set('problem', opts.message);
        url = `${REPO}/issues/new?${params.toString()}`;
      }
      if (asJson) return json({ url });
      out(url);
      if (opts.open) {
        const opener =
          process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32'
              ? 'start'
              : 'xdg-open';
        await execa(opener, [url], { shell: process.platform === 'win32' }).catch(() =>
          out(pc.dim('Could not open a browser; copy the URL above.')),
        );
      } else {
        out(pc.dim('Add --open to launch it in your browser.'));
      }
    });
}

function osLabel(): string {
  return process.platform === 'darwin'
    ? 'macOS'
    : process.platform === 'linux'
      ? 'Linux'
      : process.platform === 'win32'
        ? 'Windows'
        : 'Other';
}

/** Compact doctor output for the bug form; never includes secret values. */
async function doctorSummary(): Promise<string | undefined> {
  try {
    const { stdout } = await execa(
      process.execPath,
      ['--import', 'tsx', new URL('../bin.ts', import.meta.url).pathname, '--json', 'doctor'],
      {
        timeout: 60_000,
        reject: false,
      },
    );
    const start = stdout.indexOf('[');
    if (start < 0) return undefined;
    const rows = JSON.parse(stdout.slice(start)) as Array<{
      name: string;
      ok: boolean;
      detail: string;
    }>;
    return JSON.stringify(
      rows.map((r) => ({ name: r.name, ok: r.ok, detail: r.detail })),
      null,
      0,
    ).slice(0, 3000);
  } catch {
    return undefined;
  }
}
