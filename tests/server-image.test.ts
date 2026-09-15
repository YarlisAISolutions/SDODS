import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The server image is published for linux/amd64 and linux/arm64. Docker does not emulate a missing
 * architecture -- it refuses the pull -- so an arm64 leg that quietly drops out of release.yml is
 * an image that stops running on Apple silicon, and nothing else in CI would notice.
 */
const repoRoot = join(import.meta.dirname, '..');
const release = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');

/** The text of one top-level job, from its key to the next job key. */
function job(name: string): string {
  const start = release.indexOf(`\n  ${name}:\n`);
  expect(start, `release.yml has no job ${name}`).toBeGreaterThan(-1);
  const rest = release.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[\w-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('server image (release.yml)', () => {
  const docker = job('docker');

  it('builds each architecture on a native runner', () => {
    expect(docker).toMatch(/- arch: amd64\n\s+runner: ubuntu-latest\n/);
    expect(docker).toMatch(/- arch: arm64\n\s+runner: ubuntu-24\.04-arm\n/);
    expect(docker).toContain('runs-on: ${{ matrix.runner }}');
    expect(docker).toContain('platforms: linux/${{ matrix.arch }}');
  });

  it('runs every smoke check before anything is pushed', () => {
    const firstPush = docker.indexOf("if: env.PUSH == 'true'");
    expect(firstPush).toBeGreaterThan(-1);
    for (const check of [
      'Smoke · image metadata',
      'Smoke · sdods --version',
      'Smoke · native modules load (better-sqlite3, argon2)',
      'Smoke · serve answers /api/health',
      'Smoke · a UI run inside the container',
    ]) {
      const at = docker.indexOf(check);
      expect(at, `no smoke step "${check}"`).toBeGreaterThan(-1);
      expect(at, `"${check}" runs after the push`).toBeLessThan(firstPush);
    }
  });

  it('can be proven without publishing: push: false skips login, push and the manifest', () => {
    expect(release).toMatch(/\n {6}push:\n[\s\S]*?type: boolean\n\s+default: true\n/);
    // A push event has no inputs; only a dispatch may opt out of pushing.
    expect(docker).toContain(
      "PUSH: ${{ github.event_name != 'workflow_dispatch' || inputs.push }}",
    );
    const gated = (uses: string) =>
      new RegExp(`- uses: ${uses}\\n\\s+if: env\\.PUSH == 'true'`).test(docker);
    expect(gated('docker/login-action@v\\d+')).toBe(true);
    expect(gated('actions/upload-artifact@v\\d+')).toBe(true);
    expect(docker).toMatch(/name: Push by digest\n\s+id: push\n\s+if: env\.PUSH == 'true'/);
    expect(job('docker-manifest')).toContain(
      "(github.event_name != 'workflow_dispatch' || inputs.push)",
    );
  });

  it('publishes one index carrying both platforms', () => {
    const manifest = job('docker-manifest');
    expect(manifest).toContain('docker buildx imagetools create');
    expect(manifest).toMatch(/grep -q 'linux\/amd64'.*grep -q 'linux\/arm64'/);
  });

  it('keeps one build cache per architecture', () => {
    expect(docker).toContain('cache-to: type=gha,mode=max,scope=sdods-server-${{ matrix.arch }}');
  });
});
