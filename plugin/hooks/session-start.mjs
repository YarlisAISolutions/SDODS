#!/usr/bin/env node
/* global process */
// SessionStart hook for the SDODS Claude Code plugin.
//
// Prints a short orientation when the session opens inside an SDODS workspace, so Claude knows the
// projects and the plugin's commands without spending a tool call to find out. It reads the local
// filesystem only: no network, no child processes, and nothing at all outside a workspace.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const WORKSPACE_MARKERS = ['sdods.workspace.yaml', 'sdods.config.ts', 'sdods.config.json'];

function findWorkspace(start) {
  let dir = start;
  for (;;) {
    if (WORKSPACE_MARKERS.some((m) => existsSync(join(dir, m)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function projects(root) {
  const dir = join(root, 'projects');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'sdods.project.yaml')))
    .map((e) => {
      const envDir = join(dir, e.name, 'envs');
      const envs = existsSync(envDir)
        ? readdirSync(envDir)
            .filter((f) => f.endsWith('.yaml'))
            .map((f) => f.slice(0, -5))
        : [];
      return { slug: e.name, envs };
    });
}

try {
  const root = findWorkspace(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (root) {
    const list = projects(root);
    const lines = [
      `SDODS workspace at ${root}.`,
      list.length
        ? `Projects: ${list.map((p) => (p.envs.length ? `${p.slug} (envs: ${p.envs.join(', ')})` : p.slug)).join('; ')}.`
        : 'No projects yet.',
      'SDODS plugin commands: /sdods:setup, /sdods:test, /sdods:plan, /sdods:generate, /sdods:heal, /sdods:review, /sdods:upgrade.',
      'Follow the sdods workspace skill: one layer tag and one suite tag per scenario, reuse steps before adding any, and verify with `sdods lint` then `sdods run`.',
    ];
    process.stdout.write(lines.join('\n') + '\n');
  }
} catch {
  // An orientation hint must never break a session.
}
