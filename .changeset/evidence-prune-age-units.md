---
'@sdods/integrations': patch
'@sdods/cli': patch
---

`sdods integrations evidence prune --older-than` accepts `min`, `h`, `d` and `w` (a bare number is days) and refuses `m`, which read as minutes: `--older-than 3m` meant as three months pruned almost every run. The error suggests `min` or `d`.
