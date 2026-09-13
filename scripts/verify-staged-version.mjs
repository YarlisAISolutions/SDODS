#!/usr/bin/env node
// Refuse to publish when the staged @sdods/core reports a VERSION other than the one it is about to
// be published under. @sdods/core@0.3.2 shipped `VERSION = '0.2.2'`, so `sdods --version` and every
// run.json's sdodsVersion named the wrong release, and a version on the registry can never be
// corrected in place. Imports the staged dist/ itself, so it checks what npm will receive.
//
//   node scripts/verify-staged-version.mjs <stage-dir>
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const stage = resolve(process.argv[2] ?? '.publish-stage');
const manifest = (pkg) => JSON.parse(readFileSync(join(stage, pkg, 'package.json'), 'utf8'));

const core = manifest('core').version;
const cli = manifest('cli').version;
const { VERSION } = await import(pathToFileURL(join(stage, 'core', 'dist', 'version.js')).href);

const problems = [];
if (VERSION !== core)
  problems.push(`@sdods/core dist reports VERSION ${VERSION} but is staged as ${core}`);
if (VERSION !== cli)
  problems.push(`@sdods/core VERSION ${VERSION} does not match @sdods/cli ${cli}`);

if (problems.length) {
  for (const p of problems) console.error(`  ! ${p}`);
  process.exit(6);
}
console.log(`  VERSION ${VERSION} matches the staged @sdods/core and @sdods/cli`);
