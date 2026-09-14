---
'@sdods/core': patch
---

Canvas steps: `the canvas should not contain an edge from … to …` no longer passes on a canvas that has not finished rendering. React Flow keeps unmeasured nodes in the DOM with `visibility: hidden` and draws edges only after measuring them, so right after a reload every edge looked absent. The step now needs at least one visible node, waits until every node is visible and the editor has painted, and only then checks the edge is absent.
