---
'@sdods/cli': patch
---

`sdods run` and `sdods watch` run bddgen through Node from the workspace's installed `playwright-bdd` instead of `npx bddgen`. Where npx finds no `node_modules/.bin` shim it recognises (bun installs on Windows), it downloaded the unrelated registry package `bddgen@1.0.5` and every run failed with "bddgen failed to generate specs".
