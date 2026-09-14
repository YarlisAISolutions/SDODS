import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect as pw, type Browser, type Page } from '@playwright/test';
import type * as PlaywrightTestModule from '@playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_DEFAULTS, ProjectConfigSchema, type CanvasConfig } from '@sdods/contracts';

/** A failing assertion costs a second and a half, not the default five. */
vi.mock('@playwright/test', async (importOriginal) => {
  const actual = await importOriginal<typeof PlaywrightTestModule>();
  return { ...actual, expect: actual.expect.configure({ timeout: 1500 }) };
});

import { ApiContext } from '../src/fixtures/api-context.js';
import { SdodsError } from '../src/errors.js';
import '../src/steps/canvas.steps.js';

/**
 * The canvas steps run against a real Chromium page holding a small node editor with the DOM React
 * Flow renders: `.react-flow__node[data-id]` wrappers, `.react-flow__handle[data-handleid]` handles
 * and `.react-flow__edge` groups labelled "Edge from A to B".
 *
 * The editor is deliberately as picky as the real libraries, so a step that takes a shortcut fails
 * here rather than in a customer suite:
 *
 * - a node moves only after several pointer moves past a 3 px threshold (d3-drag's click distance),
 *   so a single teleporting move is read as a click;
 * - a connection is made on the handle the LAST pointer move was over, not the one under the
 *   release point, which is how React Flow picks the connection target;
 * - palette blocks are native HTML5 `draggable` elements dropped on the canvas.
 */

type StepFn = (fixtures: Record<string, unknown>, ...args: unknown[]) => Promise<unknown>;

interface RawStepDefinition {
  keyword: string;
  pattern: string | RegExp;
  fn: StepFn;
  matchStepText(text: string): unknown;
}

function rawSteps(): RawStepDefinition[] {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('playwright-bdd');
  const registry = require(entry.replace(/index\.js$/, 'steps/stepRegistry.js')) as {
    stepDefinitions: RawStepDefinition[];
  };
  return registry.stepDefinitions;
}

const STEPS_DIR = fileURLToPath(new URL('../src/steps/', import.meta.url));

async function loadEveryStepLibrary(): Promise<string[]> {
  const files = readdirSync(STEPS_DIR)
    .filter((f) => f.endsWith('.steps.ts'))
    .sort();
  for (const file of files) await import(pathToFileURL(join(STEPS_DIR, file)).href);
  return files;
}

function concreteStepText(pattern: string): string {
  return pattern
    .replace(/\{string\}/g, '"x"')
    .replace(/\{int\}/g, '1')
    .replace(/\(s\)/g, 's');
}

const CANVAS_PATTERNS = [
  'I drag the element with test id {string} onto the element with test id {string}',
  'I drag the element with test id {string} by {int} and {int}',
  'I drag the node {string} by {int} and {int}',
  'I connect the {string} handle of node {string} to the {string} handle of node {string}',
  'I select the node {string}',
  'I set the {string} field of node {string} to {string}',
  'the canvas should contain {int} node(s)',
  'the canvas should contain an edge from {string} to {string}',
  'the canvas should not contain an edge from {string} to {string}',
  'the node {string} should be visible',
  'the node {string} should show the {string} badge',
] as const;

let browser: Browser;
let page: Page;
let apiContext: ApiContext;
let canvas: CanvasConfig;
let steps: Map<string, StepFn>;

const env = { vars: {} as Record<string, unknown> };

function run(pattern: string, ...args: unknown[]): Promise<unknown> {
  const fn = steps.get(pattern);
  if (!fn) throw new Error(`step is not registered: "${pattern}"`);
  const config = { project: { slug: 'test', testIdAttribute: 'data-testid', canvas } };
  return Promise.resolve(fn({ page, apiContext, env, config }, ...args));
}

async function failsWith(pattern: string, args: unknown[], match: RegExp): Promise<Error> {
  let caught: unknown;
  try {
    await run(pattern, ...args);
  } catch (e) {
    caught = e;
  }
  expect(caught, `"${pattern}" passed but should have failed`).toBeDefined();
  const error = caught as Error;
  expect(`${error.message}`, `"${pattern}" failed for the wrong reason: ${error.message}`).toMatch(
    match,
  );
  return error;
}

/**
 * The editor. `nodes` seeds the canvas; everything else is created through the pointer, exactly as
 * a user would.
 */
const EDITOR = String.raw`
<style>
  body { margin: 0; font: 12px sans-serif; }
  .palette { position: absolute; left: 0; top: 0; width: 140px; height: 640px; }
  .palette div { margin: 8px; padding: 8px; border: 1px solid #999; }
  .react-flow { position: absolute; left: 150px; top: 0; width: 1100px; height: 640px; border: 1px solid #ccc; overflow: hidden; }
  .react-flow__edges { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
  .react-flow__node { position: absolute; width: 180px; height: 110px; border: 1px solid #333; background: #fff; box-sizing: border-box; }
  .react-flow__node.selected { outline: 2px solid blue; }
  .react-flow__node .title { height: 24px; padding: 4px; }
  .react-flow__node input, .react-flow__node textarea { width: 120px; margin-left: 8px; }
  .react-flow__handle { position: absolute; width: 12px; height: 12px; border-radius: 6px; background: #555; }
  .react-flow__handle.target { left: -6px; }
  .react-flow__handle.source { right: -6px; }
  .badge { position: absolute; right: 4px; top: 4px; }
</style>
<div class="palette">
  <div draggable="true" data-testid="toolbar-block-agent" data-type="agent">Agent</div>
  <div draggable="true" data-testid="toolbar-block-api" data-type="api">API</div>
</div>
<div class="react-flow" data-testid="canvas">
  <svg class="react-flow__edges"></svg>
</div>
<script>
  const flow = document.querySelector('.react-flow');
  const edgeLayer = flow.querySelector('.react-flow__edges');
  let seq = 0;

  function addNode({ id, type = 'agent', x, y, badge, hidden }) {
    id = id || type + '-' + ++seq;
    const n = document.createElement('div');
    n.className = 'react-flow__node react-flow__node-' + type;
    n.dataset.id = id;
    n.dataset.testid = 'rf__node-' + id;
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    if (hidden) n.style.visibility = 'hidden';
    n.innerHTML =
      '<div class="title">' + type + '</div>' +
      '<div class="react-flow__handle target" data-handleid="in" style="top:40px"></div>' +
      '<div class="react-flow__handle source" data-handleid="out" style="top:40px"></div>' +
      '<div class="react-flow__handle source" data-handleid="error" style="top:80px"></div>' +
      '<input name="prompt" aria-label="prompt" class="nodrag">' +
      '<div data-subblock-id="model"><textarea class="nodrag"></textarea></div>' +
      (badge ? '<span class="badge" data-testid="block-' + badge + '">' + badge + '</span>' : '');
    flow.append(n);
    return n;
  }
  window.addNode = addNode;

  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function addEdge(source, sourceHandle, target, targetHandle) {
    const a = center(source.querySelector('[data-handleid="' + sourceHandle + '"]'));
    const b = center(target.querySelector('[data-handleid="' + targetHandle + '"]'));
    const f = flow.getBoundingClientRect();
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const s = source.dataset.id, t = target.dataset.id;
    g.setAttribute('class', 'react-flow__edge');
    g.setAttribute('data-testid', 'rf__edge-' + s + sourceHandle + '-' + t + targetHandle);
    g.setAttribute('aria-label', 'Edge from ' + s + ' to ' + t);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M' + (a.x - f.left) + ',' + (a.y - f.top) + ' L' + (b.x - f.left) + ',' + (b.y - f.top));
    p.setAttribute('stroke', '#333');
    g.append(p);
    edgeLayer.append(g);
  }
  window.seedEdge = (s, sh, t, th) =>
    addEdge(flow.querySelector('[data-id="' + s + '"]'), sh, flow.querySelector('[data-id="' + t + '"]'), th);

  // ── pointer interactions ──────────────────────────────────────────────
  let drag = null;       // { node, startX, startY, left, top, moves, active }
  let connecting = null; // { node, handle, over }
  window.log = { connectMoves: 0 };

  flow.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.react-flow__handle');
    if (handle) {
      if (!handle.classList.contains('source')) return;
      connecting = { node: handle.closest('.react-flow__node'), handle: handle.dataset.handleid, over: null };
      e.preventDefault();
      return;
    }
    if (e.target.closest('.nodrag')) return;
    const node = e.target.closest('.react-flow__node');
    if (!node) return;
    drag = { node, startX: e.clientX, startY: e.clientY, left: parseFloat(node.style.left), top: parseFloat(node.style.top), moves: 0, active: false };
  });

  window.addEventListener('pointermove', (e) => {
    if (connecting) {
      window.log.connectMoves++;
      const under = document.elementFromPoint(e.clientX, e.clientY);
      connecting.over = under && under.closest('.react-flow__handle.target');
      return;
    }
    if (!drag) return;
    drag.moves++;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    // A single jump is a click; a real drag crosses the threshold over several moves.
    if (!drag.active && drag.moves >= 2 && Math.hypot(dx, dy) > 3) drag.active = true;
    if (drag.active) {
      drag.node.style.left = drag.left + dx + 'px';
      drag.node.style.top = drag.top + dy + 'px';
    }
  });

  window.addEventListener('pointerup', () => {
    if (connecting) {
      const { node, handle, over } = connecting;
      connecting = null;
      if (over) addEdge(node, handle, over.closest('.react-flow__node'), over.dataset.handleid);
      return;
    }
    if (drag) {
      const wasDrag = drag.active;
      const node = drag.node;
      drag = null;
      if (!wasDrag) {
        flow.querySelectorAll('.react-flow__node.selected').forEach((n) => n.classList.remove('selected'));
        node.classList.add('selected');
      }
    }
  });

  // ── palette: native HTML5 drag and drop ───────────────────────────────
  document.querySelectorAll('.palette [draggable]').forEach((item) => {
    item.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-block', item.dataset.type));
  });
  flow.addEventListener('dragover', (e) => e.preventDefault());
  flow.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/x-block');
    if (!type) return;
    const f = flow.getBoundingClientRect();
    addNode({ type, x: e.clientX - f.left - 90, y: e.clientY - f.top - 55 });
  });
</script>`;

async function openEditor(nodes: Array<Record<string, unknown>> = []): Promise<void> {
  // A fresh page each time: `setContent` keeps the same window, so the editor's globals and window
  // listeners from the previous test would still be attached.
  await page?.close();
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(`<!doctype html><html><body>${EDITOR}</body></html>`);
  for (const n of nodes) await page.evaluate((spec) => void (window as any).addNode(spec), n);
  const seeded = await page.locator('.react-flow__node').count();
  if (seeded !== nodes.length) {
    throw new Error(`editor seeded ${seeded} of ${nodes.length} nodes: ${await page.content()}`);
  }
}

const nodeBox = async (id: string) => {
  const box = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`node ${id} has no box`);
  return box;
};

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  steps = new Map(rawSteps().map((s) => [String(s.pattern), s.fn]));
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(() => {
  apiContext = new ApiContext();
  canvas = { ...CANVAS_DEFAULTS };
  env.vars = {};
});

/* ── registration and config ──────────────────────────────────────────── */

describe('canvas.steps registration', () => {
  it('registers every documented pattern exactly once', () => {
    const all = rawSteps().map((s) => String(s.pattern));
    for (const pattern of CANVAS_PATTERNS) {
      expect(all.filter((p) => p === pattern).length, `pattern "${pattern}"`).toBe(1);
    }
  });

  it('leaves no step TEXT ambiguous across the whole shipped library', async () => {
    const files = await loadEveryStepLibrary();
    expect(files).toContain('canvas.steps.ts');
    const all = rawSteps();
    for (const pattern of CANVAS_PATTERNS) {
      const text = concreteStepText(pattern);
      const matched = all
        .filter((d) => Boolean(d.matchStepText(text)))
        .map((d) => String(d.pattern));
      expect(matched, `"${text}" is matched by more than one step definition`).toEqual([pattern]);
    }
  });
});

describe('canvas config', () => {
  it('defaults every selector to the DOM React Flow renders', () => {
    const parsed = ProjectConfigSchema.parse({
      slug: 'p',
      name: 'P',
      layers: ['ui'],
      envs: { default: 'dev', available: ['dev'] },
    });
    expect(parsed.canvas).toEqual(CANVAS_DEFAULTS);
    expect(parsed.canvas.node).toBe('.react-flow__node[data-id="{id}"]');
    expect(parsed.canvas.edge).toBe(
      '.react-flow__edge[aria-label="Edge from {source} to {target}"]',
    );
  });

  it('keeps the other defaults when a project overrides one selector', () => {
    const parsed = ProjectConfigSchema.parse({
      slug: 'p',
      name: 'P',
      layers: ['ui'],
      envs: { default: 'dev', available: ['dev'] },
      canvas: { field: '[data-subblock-id="{field}"]' },
    });
    expect(parsed.canvas.field).toBe('[data-subblock-id="{field}"]');
    expect(parsed.canvas.node).toBe(CANVAS_DEFAULTS.node);
  });

  it('rejects a template that is missing its placeholder or names an unknown one', () => {
    const base = { slug: 'p', name: 'P', layers: ['ui'], envs: { default: 'd', available: ['d'] } };
    const missing = ProjectConfigSchema.safeParse({ ...base, canvas: { node: '[data-nodeid]' } });
    expect(missing.success).toBe(false);
    expect(JSON.stringify(missing.error?.issues)).toContain('{id}');
    const unknown = ProjectConfigSchema.safeParse({
      ...base,
      canvas: { node: '[data-nodeid="{nodeId}"]' },
    });
    expect(unknown.success).toBe(false);
    expect(JSON.stringify(unknown.error?.issues)).toContain('{nodeId}');
    const edge = ProjectConfigSchema.safeParse({
      ...base,
      canvas: { edge: '[data-from="{source}"]' },
    });
    expect(JSON.stringify(edge.error?.issues)).toContain('{target}');
  });
});

/* ── dragging ─────────────────────────────────────────────────────────── */

describe('drag', () => {
  it('drops a palette block onto the canvas through native HTML5 drag and drop', async () => {
    await openEditor();
    await run('the canvas should contain {int} node(s)', 0);
    await run(
      'I drag the element with test id {string} onto the element with test id {string}',
      'toolbar-block-agent',
      'canvas',
    );
    await run('the canvas should contain {int} node(s)', 1);
    await expect.poll(() => page.locator('.react-flow__node-agent').count()).toBe(1);
  }, 60_000);

  it('moves an element by an offset, including a negative one, with a multi-move drag', async () => {
    await openEditor([{ id: 'n1', x: 400, y: 300 }]);
    const before = await nodeBox('n1');
    await run(
      'I drag the element with test id {string} by {int} and {int}',
      'rf__node-n1',
      120,
      -80,
    );
    const after = await nodeBox('n1');
    // A single teleporting move is read as a click by the editor, so the node would not move.
    expect(Math.round(after.x - before.x)).toBe(120);
    expect(Math.round(after.y - before.y)).toBe(-80);
    await pw(page.locator('.react-flow__node[data-id="n1"]')).not.toHaveClass(/selected/);
  }, 60_000);

  it('moves a node addressed by its id', async () => {
    await openEditor([{ id: 'n1', x: 200, y: 200 }]);
    const before = await nodeBox('n1');
    await run('I drag the node {string} by {int} and {int}', 'n1', -50, 60);
    const after = await nodeBox('n1');
    expect(Math.round(after.x - before.x)).toBe(-50);
    expect(Math.round(after.y - before.y)).toBe(60);
  }, 60_000);

  it('refuses a zero offset, which is a click and not a drag', async () => {
    await openEditor([{ id: 'n1', x: 200, y: 200 }]);
    const error = await failsWith(
      'I drag the node {string} by {int} and {int}',
      ['n1', 0, 0],
      /not a drag/i,
    );
    expect(error).toBeInstanceOf(SdodsError);
  }, 60_000);

  it('refuses a drag that would end outside the viewport instead of dropping short', async () => {
    await openEditor([{ id: 'n1', x: 200, y: 200 }]);
    await failsWith(
      'I drag the node {string} by {int} and {int}',
      ['n1', 5000, 0],
      /outside the viewport/i,
    );
    // The mouse is released even though the step failed, so the next interaction is not a drag.
    await run('I select the node {string}', 'n1');
  }, 60_000);

  it('fails on a missing source or target rather than dragging nothing', async () => {
    await openEditor([{ id: 'n1', x: 200, y: 200 }]);
    await Promise.all([
      failsWith(
        'I drag the element with test id {string} onto the element with test id {string}',
        ['toolbar-block-missing', 'canvas'],
        /toolbar-block-missing/,
      ),
      failsWith('I drag the node {string} by {int} and {int}', ['ghost', 10, 10], /ghost/),
    ]);
  }, 60_000);

  it('renders {{variables}} in test ids and node ids', async () => {
    apiContext.vars.set('block', 'agent');
    apiContext.vars.set('nodeId', 'n1');
    await openEditor([{ id: 'n1', x: 200, y: 200 }]);
    await run(
      'I drag the element with test id {string} onto the element with test id {string}',
      'toolbar-block-{{block}}',
      'canvas',
    );
    await run('the canvas should contain {int} node(s)', 2);
    const before = await nodeBox('n1');
    await run('I drag the node {string} by {int} and {int}', '{{nodeId}}', 30, 30);
    expect(Math.round((await nodeBox('n1')).x - before.x)).toBe(30);
  }, 60_000);
});

/* ── connecting ───────────────────────────────────────────────────────── */

describe('connect', () => {
  it('connects a source handle to a target handle and the edge assertion sees it', async () => {
    await openEditor([
      { id: 'start', x: 100, y: 100 },
      { id: 'agent-1', x: 600, y: 300 },
    ]);
    await run(
      'the canvas should not contain an edge from {string} to {string}',
      'start',
      'agent-1',
    );
    await run(
      'I connect the {string} handle of node {string} to the {string} handle of node {string}',
      'out',
      'start',
      'in',
      'agent-1',
    );
    await run('the canvas should contain an edge from {string} to {string}', 'start', 'agent-1');
    await pw(page.locator('[data-testid="rf__edge-startout-agent-1in"]')).toHaveCount(1);
    // The editor only connects when a pointer move landed on the target handle.
    expect(await page.evaluate(() => (window as any).log.connectMoves)).toBeGreaterThan(2);
  }, 60_000);

  it('the edge assertions fail in the opposite direction', async () => {
    await openEditor([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 600, y: 300 },
    ]);
    await page.evaluate(() => (window as any).seedEdge('a', 'out', 'b', 'in'));
    await Promise.all([
      failsWith(
        'the canvas should contain an edge from {string} to {string}',
        ['b', 'a'],
        /edge from "b" to "a"/,
      ),
      failsWith(
        'the canvas should not contain an edge from {string} to {string}',
        ['a', 'b'],
        /edge from "a" to "b"/,
      ),
    ]);
  }, 60_000);

  it('refuses an absent-edge check on a canvas that rendered no nodes', async () => {
    await openEditor();
    const error = await failsWith(
      'the canvas should not contain an edge from {string} to {string}',
      ['a', 'b'],
      /no nodes/i,
    );
    expect(error).toBeInstanceOf(SdodsError);
  }, 60_000);

  it('fails naming the handle when it does not exist', async () => {
    await openEditor([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 600, y: 300 },
    ]);
    await failsWith(
      'I connect the {string} handle of node {string} to the {string} handle of node {string}',
      ['success', 'a', 'in', 'b'],
      /"success" handle of node "a"/,
    );
    await pw(page.locator('.react-flow__edge')).toHaveCount(0);
  }, 60_000);
});

/* ── selecting and editing ────────────────────────────────────────────── */

describe('select and set field', () => {
  it('selects a node and fails when the click did not select it', async () => {
    await openEditor([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 500, y: 100 },
    ]);
    await run('I select the node {string}', 'b');
    await pw(page.locator('.react-flow__node[data-id="b"]')).toHaveClass(/selected/);
    await pw(page.locator('.react-flow__node[data-id="a"]')).not.toHaveClass(/selected/);

    // An app whose nodes carry a different selected marker: the step must not report success.
    canvas = { ...canvas, selected: '[aria-selected="true"]' };
    await failsWith('I select the node {string}', ['a'], /not selected|aria-selected/i);
  }, 60_000);

  it('sets a field by its default name/label selector and by a project override', async () => {
    apiContext.vars.set('prompt', 'Summarise the ticket');
    await openEditor([{ id: 'agent-1', x: 300, y: 200 }]);
    await run(
      'I set the {string} field of node {string} to {string}',
      'prompt',
      'agent-1',
      '{{prompt}}',
    );
    await pw(page.locator('[data-id="agent-1"] input[name="prompt"]')).toHaveValue(
      'Summarise the ticket',
    );

    // MyBotBox-style sub-blocks: the attribute sits on a wrapper, the editable control inside it.
    canvas = { ...canvas, field: '[data-subblock-id="{field}"]' };
    await run(
      'I set the {string} field of node {string} to {string}',
      'model',
      'agent-1',
      'claude',
    );
    await pw(page.locator('[data-id="agent-1"] [data-subblock-id="model"] textarea')).toHaveValue(
      'claude',
    );
  }, 60_000);

  it('fails naming the field when the node has no such field', async () => {
    await openEditor([{ id: 'agent-1', x: 300, y: 200 }]);
    await failsWith(
      'I set the {string} field of node {string} to {string}',
      ['temperature', 'agent-1', '0.2'],
      /"temperature" field/,
    );
  }, 60_000);
});

/* ── assertions ───────────────────────────────────────────────────────── */

describe('node assertions', () => {
  it('counts nodes exactly, in both directions', async () => {
    await openEditor([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 500, y: 100 },
    ]);
    await run('the canvas should contain {int} node(s)', 2);
    await failsWith('the canvas should contain {int} node(s)', [3], /count|expected/i);
  }, 60_000);

  it('node visibility passes for a shown node and fails for a hidden or missing one', async () => {
    await openEditor([
      { id: 'shown', x: 100, y: 100 },
      { id: 'hidden', x: 500, y: 100, hidden: true },
    ]);
    await run('the node {string} should be visible', 'shown');
    await Promise.all([
      failsWith('the node {string} should be visible', ['hidden'], /visible/i),
      failsWith('the node {string} should be visible', ['missing'], /visible|missing/i),
    ]);
  }, 60_000);

  it('badges are scoped to the node, so another node showing it does not count', async () => {
    canvas = { ...canvas, badge: '[{testIdAttribute}="block-{badge}"]' };
    await openEditor([
      { id: 'ok', x: 100, y: 100, badge: 'success-badge' },
      { id: 'bad', x: 500, y: 100, badge: 'error-badge' },
    ]);
    await run('the node {string} should show the {string} badge', 'ok', 'success-badge');
    await Promise.all([
      failsWith(
        'the node {string} should show the {string} badge',
        ['bad', 'success-badge'],
        /success-badge/,
      ),
      failsWith(
        'the node {string} should show the {string} badge',
        ['nobody', 'error-badge'],
        /nobody/,
      ),
    ]);
  }, 60_000);

  it('escapes quotes in ids, so an id cannot break out of the selector', async () => {
    await openEditor([{ id: 'say "hi"', x: 100, y: 100 }]);
    await run('the node {string} should be visible', 'say "hi"');
  }, 60_000);
});
