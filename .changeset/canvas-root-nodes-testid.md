---
'@sdods/core': patch
---

Canvas steps: `{testIdAttribute}` in `canvas.root` and `canvas.nodes` is now expanded, as it already was in the other selectors. The schema accepted it, but the node count, the absent-edge check and every lookup scoped to the root used the template as-is and failed with an invalid selector.
