// Publishes the output of `bun run plugin:build` to the public skills repository as one commit on
// its default branch, through the Git Data API via `gh api`, so no local checkout is needed. The
// commit replaces the whole tree, so files dropped from the build disappear from the repository.
// Run it after each release, so the plugin and skills match the published @sdods/cli:
//   node scripts/push-agent-plugin.mjs dist/sdods-skills siri1410/sdods-skills "sdods 0.6.0"
/* global process, console */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const [dir, repo, message] = process.argv.slice(2);
if (!dir || !repo || !message) throw new Error('usage: <dir> <owner/repo> <message>');

function gh(method, path, body) {
  const args = ['api', '-X', method, `repos/${repo}/${path}`];
  if (body) args.push('--input', '-');
  const out = execFileSync('gh', args, {
    input: body ? JSON.stringify(body) : undefined,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out ? JSON.parse(out) : {};
}

function walk(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dir).sort();
const repoInfo = JSON.parse(execFileSync('gh', ['api', `repos/${repo}`], { encoding: 'utf8' }));
const branch = repoInfo.default_branch;
const parent = gh('GET', `git/ref/heads/${branch}`).object.sha;

const tree = files.map((file) => {
  const blob = gh('POST', 'git/blobs', {
    content: readFileSync(file).toString('base64'),
    encoding: 'base64',
  });
  const mode = file.endsWith('.mjs') ? '100755' : '100644';
  return { path: relative(dir, file), mode, type: 'blob', sha: blob.sha };
});

const newTree = gh('POST', 'git/trees', { tree });
const commit = gh('POST', 'git/commits', {
  message,
  tree: newTree.sha,
  parents: [parent],
  author: { name: 'SDODS', email: 'admin@sdods.com' },
});
gh('PATCH', `git/refs/heads/${branch}`, { sha: commit.sha });
console.log(`pushed ${files.length} files to ${repo}@${branch}: ${commit.sha.slice(0, 7)}`);
