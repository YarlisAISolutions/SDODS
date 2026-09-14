---
'@sdods/integrations': patch
---

GitHub evidence host: an empty evidence repository is reported as "is empty: create it with a README" by `sdods integrations test`, uploads and prune. GitHub answers 409, not 404, when reading a branch of a repository without a commit, and that raw 409 was surfaced instead.
