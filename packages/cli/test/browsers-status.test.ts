import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { browserStatuses } from '../src/commands/browsers.js';

/**
 * Edge is a channel, not a Playwright download. Detection used to go through
 * `playwright-core.chromium.executablePath()`, which returns the BUNDLED Chromium path — a file
 * that exists on nearly every machine — so `edge` would have reported itself installed everywhere,
 * and `sdods run -b edge` would then fail deep inside Playwright instead of up front.
 */
describe('browserStatuses', () => {
  it('probes edge by its own binary path, not the bundled engine', async () => {
    const [edge, chromium] = await browserStatuses(['edge', 'chromium']);
    expect(edge?.name).toBe('edge');
    expect(edge?.engine).toBe('chromium');
    expect(edge?.channel).toBe('msedge');
    // The distinguishing assertion: the two must not resolve to the same binary.
    expect(edge?.executable).not.toBe(chromium?.executable);
    expect(edge?.executable ?? '').toMatch(/[Ee]dge/);
    // `installed` is the truth about that path, whichever machine this runs on.
    expect(edge?.installed).toBe(edge?.executable ? existsSync(edge.executable) : false);
  });

  it('reports a downloaded engine with no channel', async () => {
    const [chromium] = await browserStatuses(['chromium']);
    expect(chromium?.channel).toBeNull();
  });

  it('omits channel browsers from the default set', async () => {
    // A bare `sdods browsers list` exits 1 when anything is missing. Including Edge by default
    // would make that a permanently failing command on every machine that does not run Edge.
    const names = (await browserStatuses()).map((s) => s.name);
    expect(names).toContain('chromium');
    expect(names).not.toContain('edge');
  });
});
