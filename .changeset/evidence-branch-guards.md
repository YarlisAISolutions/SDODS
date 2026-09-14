---
'@sdods/contracts': patch
'@sdods/integrations': patch
---

GitHub evidence host: `evidence prune` can no longer erase a real branch. Uploads, prune and `sdods integrations test` refuse the repository's default branch; prune also refuses a branch SDODS did not create (its root README must be the `# SDODS evidence` one the orphan commit writes); and `integrations.github.evidence.branch` rejects `main`, `master`, `develop`, `development`, `trunk` and `gh-pages`. Before, `evidence.branch: main` committed evidence onto main and prune then force-updated main to an orphan commit.
