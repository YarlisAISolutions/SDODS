import { expect, type Locator, type Page } from '@playwright/test';
import { CANVAS_DEFAULTS, type CanvasConfig } from '@sdods/contracts';
import './params.js';
import { Then, When } from '../fixtures/test.js';
import { renderStrict } from '../api/template.js';
import { SdodsError } from '../errors.js';

/**
 * Graph and node-editor steps: drag, connect, select and inspect nodes on a canvas.
 *
 * Before this file a workflow builder was unaddressable past "click the palette item": no step
 * could move a node, draw an edge between two handles, fill a field that lives inside a node or
 * say which edges exist.
 *
 * Nodes, handles, edges, fields and badges are found through the project's `canvas` selector
 * templates, which default to the DOM React Flow renders. Every lookup below a node is scoped
 * INSIDE that node, so "node A shows the error badge" cannot be satisfied by node B showing it.
 *
 * Four conventions hold throughout, all of them load-bearing:
 *
 * 1. EVERY string argument goes through `renderStrict()`, ids included, as in the other libraries.
 *
 * 2. Drags are real pointer gestures: `mouse.down`, a short nudge, a multi-step `mouse.move`, a
 *    final move onto the target, `mouse.up`. Graph editors decide what a gesture means from the
 *    MOVES, not from the press and release: d3-drag (React Flow's node drag) ignores a press that
 *    never crosses its click distance, React Flow picks the connection target from the handle the
 *    last move was over, and dnd-kit waits for an activation distance. `locator.dragTo()` is not
 *    used, not even as a first attempt with a fallback: when it "succeeds" without the editor
 *    reacting there is nothing to observe that would trigger the fallback. Playwright turns the
 *    same mouse gesture into native HTML5 drag events when the source is `draggable`, so palette
 *    drops work through the same path.
 *
 * 3. Nothing here is self-healing. A node id is an identity, not a description: healing onto the
 *    neighbouring node would move, connect or assert against the wrong block and report success.
 *    The drag steps that take a test id are not healed either, for the same reason — dropping the
 *    wrong palette block is a silent wrong graph, not a flaky locator.
 *
 * 4. No step passes vacuously. A missing node, handle or field fails naming it; an absent-edge
 *    check refuses a canvas that rendered no nodes; a zero-offset drag is refused as a click.
 */

type Vars = {
  apiContext: { vars: { toObject(): Record<string, unknown> } };
  env: { vars: Record<string, unknown> };
};

type ConfigLike = { project: { testIdAttribute?: string; canvas?: Partial<CanvasConfig> } };

interface Point {
  x: number;
  y: number;
}

const arg = ({ apiContext, env }: Vars, value: string) =>
  renderStrict(value, apiContext.vars.toObject(), env.vars);

/** Pointer moves between press and release. Enough for every drag threshold we know of. */
const DRAG_STEPS = 12;

/** Size of the first move after the press, which starts a drag in libraries with a threshold. */
const NUDGE_PX = 4;

/** The editable control a field wrapper holds, when the field selector names a wrapper. */
const EDITABLE =
  'input:not([type="hidden"]), textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Places inside a node a press would NOT reach the node through: a drag or click there is eaten. */
const NOT_A_GRAB_POINT = `${EDITABLE}, button, a[href], .nodrag, .react-flow__handle`;

interface Canvas {
  config: CanvasConfig;
  testIdAttribute: string;
}

function canvasOf(config: ConfigLike): Canvas {
  return {
    config: { ...CANVAS_DEFAULTS, ...(config.project.canvas ?? {}) },
    testIdAttribute: config.project.testIdAttribute ?? 'data-testid',
  };
}

/** A value inside a quoted CSS string: backslashes, both quotes and newlines escaped. */
function cssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\a ');
}

/**
 * Fills a selector template. An unknown placeholder throws instead of being left in place: a
 * selector with a literal `{nodeId}` in it matches nothing, which fails a positive step for the
 * wrong reason and passes the negative edge step without testing anything.
 */
export function expandCanvasSelector(
  key: keyof CanvasConfig,
  template: string,
  values: Record<string, string>,
  testIdAttribute: string,
): string {
  return template.replace(/\{(\w+)\}/g, (_whole, name: string) => {
    if (name === 'testIdAttribute') return testIdAttribute;
    const value = values[name];
    if (value === undefined) {
      throw new SdodsError(
        'CONFIG_INVALID',
        `canvas.${key} "${template}" uses {${name}}, which is not a placeholder for this selector.`,
        {
          hint: `canvas.${key} may use ${Object.keys(values)
            .map((v) => `{${v}}`)
            .concat('{testIdAttribute}')
            .join(', ')}.`,
        },
      );
    }
    return cssString(value);
  });
}

function rootOf(page: Page, c: Canvas): Locator {
  return page.locator(c.config.root);
}

function nodeLocator(page: Page, c: Canvas, id: string): Locator {
  return rootOf(page, c).locator(
    expandCanvasSelector('node', c.config.node, { id }, c.testIdAttribute),
  );
}

/** Exactly one node with that id, or a failure that names it. */
async function oneNode(page: Page, c: Canvas, id: string): Promise<Locator> {
  const node = nodeLocator(page, c, id);
  await expect(node, `no single node "${id}" on the canvas (canvas.node)`).toHaveCount(1);
  return node;
}

async function viewport(page: Page): Promise<{ width: number; height: number }> {
  return page.viewportSize() ?? page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
}

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  if (!box || box.width === 0 || box.height === 0) {
    throw new SdodsError('RUN_FAILED', `${what} has no size on screen, so it cannot be dragged.`, {
      hint: 'It is in the DOM but not laid out: hidden, collapsed, or virtualised off the canvas.',
    });
  }
  return box;
}

/** The centre of a drop target or a handle: the point a release or a connection aims at. */
async function centreOf(locator: Locator, what: string): Promise<Point> {
  await expect(locator, `${what} is not visible`).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const box = await boxOf(locator, what);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A point on an element that a press reaches the ELEMENT through — used for every drag source and
 * for selecting. The centre of a real workflow block is usually a text field, and editors
 * deliberately ignore presses there (React Flow's `nodrag`), so a drag or click at the centre does
 * nothing. Tries the centre, then the header strip, then the edges, and takes the first point whose
 * hit target is the element or a plain part of it. A palette item with nothing inside it resolves
 * to its centre.
 */
async function grabPointOf(node: Locator, what: string): Promise<Point> {
  await expect(node, `${what} is not visible`).toBeVisible();
  await node.scrollIntoViewIfNeeded();
  const box = await boxOf(node, what);
  const offset = await node.evaluate((el, skip) => {
    const r = el.getBoundingClientRect();
    const inset = Math.min(8, r.height / 4, r.width / 4);
    const candidates: Array<[number, number]> = [
      [r.width / 2, r.height / 2],
      [r.width / 2, inset],
      [inset * 2, inset],
      [r.width - inset * 2, inset],
      [r.width / 2, r.height - inset],
      [inset, r.height / 2],
      [r.width - inset, r.height / 2],
    ];
    for (const [x, y] of candidates) {
      const hit = document.elementFromPoint(r.left + x, r.top + y);
      if (!hit || !el.contains(hit)) continue;
      const blocker = hit.closest(skip);
      if (blocker && el.contains(blocker)) continue;
      return { x, y, found: true };
    }
    return { x: r.width / 2, y: r.height / 2, found: false };
  }, NOT_A_GRAB_POINT);
  // Scale by the laid-out box, which is in page coordinates even inside a frame.
  return { x: box.x + offset.x, y: box.y + offset.y };
}

/** One real pointer drag. The press is always released, even when a move throws. */
async function pointerDrag(page: Page, from: Point, to: Point, what: string): Promise<void> {
  const { width, height } = await viewport(page);
  for (const [label, p] of [
    ['starts', from],
    ['ends', to],
  ] as const) {
    if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) {
      throw new SdodsError(
        'RUN_FAILED',
        `Dragging ${what} ${label} at (${Math.round(p.x)}, ${Math.round(p.y)}), outside the viewport (${width}x${height}).`,
        {
          hint: 'A pointer cannot be pressed or released off screen, so the drop would land short. Use a smaller offset, scroll or zoom the canvas first, or enlarge the viewport.',
        },
      );
    }
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  try {
    if (distance > NUDGE_PX) {
      await page.mouse.move(
        from.x + (dx / distance) * NUDGE_PX,
        from.y + (dy / distance) * NUDGE_PX,
      );
    }
    await page.mouse.move(to.x, to.y, { steps: DRAG_STEPS });
    // The LAST move is what drop targets read (React Flow's connection target, HTML5 dragover).
    await page.mouse.move(to.x, to.y);
  } finally {
    await page.mouse.up();
  }
}

function assertOffset(dx: number, dy: number, what: string): void {
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || (dx === 0 && dy === 0)) {
    throw new SdodsError('RUN_FAILED', `Moving ${what} by ${dx} and ${dy} is not a drag.`, {
      hint: 'Offsets are whole screen pixels, right/down positive, and at least one must be non-zero: a press and release in place is a click, and editors treat it as one.',
    });
  }
}

/* ── dragging ─────────────────────────────────────────────────────────── */

// Adds a block from a palette, or moves anything onto a drop zone. The source is pressed on a
// plain part of it (see `grabPointOf`) and released at the target's centre.
When(
  'I drag the element with test id {string} onto the element with test id {string}',
  async ({ page, apiContext, env }, sourceId: string, targetId: string) => {
    const s = arg({ apiContext, env }, sourceId);
    const t = arg({ apiContext, env }, targetId);
    const target = page.getByTestId(t);
    const source = page.getByTestId(s);
    // Target first: scrolling the source into view last keeps the press point on screen.
    await centreOf(target, `the element with test id "${t}"`);
    const from = await grabPointOf(source, `the element with test id "${s}"`);
    const to = await centreOf(target, `the element with test id "${t}"`);
    await pointerDrag(page, from, to, `the element with test id "${s}"`);
  },
);

// Moves an element by an offset in screen pixels (right/down positive). On a zoomed canvas the
// node moves by the offset divided by the zoom, in flow coordinates.
When(
  'I drag the element with test id {string} by {int} and {int}',
  async ({ page, apiContext, env }, id: string, dx: number, dy: number) => {
    const testId = arg({ apiContext, env }, id);
    const what = `the element with test id "${testId}"`;
    assertOffset(dx, dy, what);
    const from = await grabPointOf(page.getByTestId(testId), what);
    await pointerDrag(page, from, { x: from.x + dx, y: from.y + dy }, what);
  },
);

// Moves a node addressed by its id rather than a test id — the one a workflow canvas actually has.
// Pressed on a plain part of the node, never on a field inside it (see `grabPointOf`).
When(
  'I drag the node {string} by {int} and {int}',
  async ({ page, config, apiContext, env }, id: string, dx: number, dy: number) => {
    const c = canvasOf(config);
    const nodeId = arg({ apiContext, env }, id);
    const what = `node "${nodeId}"`;
    assertOffset(dx, dy, what);
    const from = await grabPointOf(await oneNode(page, c, nodeId), what);
    await pointerDrag(page, from, { x: from.x + dx, y: from.y + dy }, what);
  },
);

/* ── connecting ───────────────────────────────────────────────────────── */

// Draws an edge the way a user does: press on the source handle, move onto the target handle,
// release. Both handles are looked up inside their own node, so two nodes that both have an "out"
// handle are never confused. Whether the editor ACCEPTED the connection is the next step's job:
// `the canvas should contain an edge from ... to ...`.
When(
  'I connect the {string} handle of node {string} to the {string} handle of node {string}',
  async (
    { page, config, apiContext, env },
    sourceHandle: string,
    sourceNode: string,
    targetHandle: string,
    targetNode: string,
  ) => {
    const c = canvasOf(config);
    const v = { apiContext, env };
    const [sh, sn, th, tn] = [sourceHandle, sourceNode, targetHandle, targetNode].map((s) =>
      arg(v, s),
    ) as [string, string, string, string];
    const handleIn = async (nodeId: string, handle: string): Promise<Locator> => {
      const node = await oneNode(page, c, nodeId);
      const h = node.locator(
        expandCanvasSelector('handle', c.config.handle, { handle }, c.testIdAttribute),
      );
      await expect(
        h,
        `the "${handle}" handle of node "${nodeId}" is not on the canvas (canvas.handle)`,
      ).toHaveCount(1);
      return h;
    };
    const target = await handleIn(tn, th);
    const source = await handleIn(sn, sh);
    await centreOf(target, `the "${th}" handle of node "${tn}"`);
    const from = await centreOf(source, `the "${sh}" handle of node "${sn}"`);
    const to = await centreOf(target, `the "${th}" handle of node "${tn}"`);
    await pointerDrag(page, from, to, `the "${sh}" handle of node "${sn}"`);
  },
);

/* ── selecting and editing ────────────────────────────────────────────── */

// Selects a node by clicking a plain part of it, then waits until it matches `canvas.selected`
// (React Flow's `.selected` class by default), so a click the editor swallowed fails here rather
// than as a confusing failure in whatever the scenario does with the selection next.
When('I select the node {string}', async ({ page, config, apiContext, env }, id: string) => {
  const c = canvasOf(config);
  const nodeId = arg({ apiContext, env }, id);
  const node = await oneNode(page, c, nodeId);
  const at = await grabPointOf(node, `node "${nodeId}"`);
  await page.mouse.click(at.x, at.y);
  const marker = c.config.selected;
  if (!marker) return;
  await expect
    .poll(async () => node.evaluate((el, s) => el.matches(s), marker), {
      message: `node "${nodeId}" is not selected after clicking it: it does not match ${marker} (canvas.selected)`,
    })
    .toBe(true);
});

// Fills a field that lives inside a node. `canvas.field` may name the control itself or a wrapper
// around it; for a wrapper, the first visible input, textarea, select or contenteditable inside it
// is used. A select is set by option value or label.
When(
  'I set the {string} field of node {string} to {string}',
  async ({ page, config, apiContext, env }, field: string, id: string, value: string) => {
    const c = canvasOf(config);
    const v = { apiContext, env };
    const name = arg(v, field);
    const nodeId = arg(v, id);
    const text = arg(v, value);
    const node = await oneNode(page, c, nodeId);
    const match = node
      .locator(expandCanvasSelector('field', c.config.field, { field: name }, c.testIdAttribute))
      .first();
    await expect(match, `node "${nodeId}" has no "${name}" field (canvas.field)`).toBeAttached();
    const isEditable = await match.evaluate((el, sel) => el.matches(sel), EDITABLE);
    const control = isEditable ? match : match.locator(EDITABLE).filter({ visible: true }).first();
    await expect(
      control,
      `the "${name}" field of node "${nodeId}" holds no visible editable control`,
    ).toBeVisible();
    const tag = await control.evaluate((el) => el.tagName);
    if (tag === 'SELECT') await control.selectOption(text);
    else await control.fill(text);
  },
);

/* ── assertions ───────────────────────────────────────────────────────── */

// Counts every node on the canvas (`canvas.nodes`). Exact, so a duplicated drop fails too.
Then('the canvas should contain {int} node(s)', async ({ page, config }, count: number) => {
  if (!Number.isInteger(count) || count < 0) {
    throw new SdodsError('RUN_FAILED', `"${count}" is not a number of nodes.`, {
      hint: 'Node counts are whole numbers, 0 or more.',
    });
  }
  const c = canvasOf(config);
  await expect(rootOf(page, c).locator(c.config.nodes)).toHaveCount(count);
});

// Proves the editor holds an edge from one node to the other, in that direction.
Then(
  'the canvas should contain an edge from {string} to {string}',
  async ({ page, config, apiContext, env }, source: string, target: string) => {
    const c = canvasOf(config);
    const s = arg({ apiContext, env }, source);
    const t = arg({ apiContext, env }, target);
    const edges = rootOf(page, c).locator(
      expandCanvasSelector('edge', c.config.edge, { source: s, target: t }, c.testIdAttribute),
    );
    await expect
      .poll(async () => edges.count(), {
        message: `the canvas has no edge from "${s}" to "${t}" (canvas.edge)`,
      })
      .toBeGreaterThan(0);
  },
);

// Proves an edge is gone, or was never drawn. Refuses a canvas with no nodes: on an editor that
// has not rendered, every edge in existence is absent, which is not an assertion.
Then(
  'the canvas should not contain an edge from {string} to {string}',
  async ({ page, config, apiContext, env }, source: string, target: string) => {
    const c = canvasOf(config);
    const s = arg({ apiContext, env }, source);
    const t = arg({ apiContext, env }, target);
    const root = rootOf(page, c);
    try {
      await expect(root.locator(c.config.nodes).first()).toBeAttached();
    } catch {
      throw new SdodsError('RUN_FAILED', 'The canvas has rendered no nodes at all.', {
        hint: `Asserting there is no edge from "${s}" to "${t}" on an empty or unrendered canvas proves nothing. Check canvas.root and canvas.nodes, or assert a node first.`,
      });
    }
    const edges = root.locator(
      expandCanvasSelector('edge', c.config.edge, { source: s, target: t }, c.testIdAttribute),
    );
    await expect(edges, `the canvas has an edge from "${s}" to "${t}"`).toHaveCount(0);
  },
);

// Proves the node is rendered and shown.
Then(
  'the node {string} should be visible',
  async ({ page, config, apiContext, env }, id: string) => {
    const c = canvasOf(config);
    const nodeId = arg({ apiContext, env }, id);
    await expect(nodeLocator(page, c, nodeId), `node "${nodeId}" is not visible`).toBeVisible();
  },
);

// Proves THIS node shows the badge — a run state (running, success, error) or a validation marker.
Then(
  'the node {string} should show the {string} badge',
  async ({ page, config, apiContext, env }, id: string, badge: string) => {
    const c = canvasOf(config);
    const nodeId = arg({ apiContext, env }, id);
    const b = arg({ apiContext, env }, badge);
    const node = await oneNode(page, c, nodeId);
    const marker = node.locator(
      expandCanvasSelector('badge', c.config.badge, { badge: b }, c.testIdAttribute),
    );
    await expect(
      marker.first(),
      `node "${nodeId}" does not show the "${b}" badge (canvas.badge)`,
    ).toBeVisible();
  },
);
