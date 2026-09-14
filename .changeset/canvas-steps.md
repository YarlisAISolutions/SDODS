---
'@sdods/core': minor
'@sdods/contracts': minor
---

Canvas steps for graph and node editors (`canvas.steps.ts`): drag an element onto another or by an offset, drag a node by id, connect a handle of one node to a handle of another, select a node, set a field inside a node, and assert the node count, an edge from one node to another (or its absence), a node's visibility and a badge inside a node.

- Drags are real pointer gestures (press, nudge, multi-step moves, a final move onto the target, release), so React Flow, d3-drag and native HTML5 `draggable` palettes all react. The press lands on a plain part of the element, never on a field or handle inside it.
- New project key `canvas` in `@sdods/contracts`: CSS selector templates for `root`, `nodes`, `node`, `handle`, `edge`, `field`, `badge` and `selected`, defaulting to React Flow's DOM. Templates are validated for their required placeholders (`{id}`, `{handle}`, `{source}`/`{target}`, `{field}`, `{badge}`), and `{testIdAttribute}` expands to the project's attribute.
- A project whose own steps already use these phrasings can keep them with `steps.core.exclude: [canvas]`.
