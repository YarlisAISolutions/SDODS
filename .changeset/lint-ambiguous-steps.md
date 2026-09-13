---
'@sdods/core': patch
---

`sdods lint` reports ambiguous step definitions instead of passing a suite bddgen cannot generate.

- New `steps/ambiguous` error: a feature step matched by more than one definition, which makes bddgen fail with "Multiple definitions matched scenario step". Lint reads the definitions from the same files the runner loads (the core step libraries minus `steps.core.exclude`, plus the project's `steps/` and `pages/`, decorator steps included) and matches them against the scenario step text with the same Cucumber expression engine and rules as bddgen: keywords ignored, tag-scoped steps filtered, `@skip`/`@fixme` scenarios left out. Findings are grouped by where the definitions live, so 67 collisions with one library come back as one error. Each names both `file:line`s and, when a core library is involved, the `steps.core.exclude: [<library>]` that removes it. The check runs in `sdods lint` and in the lint step before `sdods run`.
- New `steps/duplicate` warning: the same phrasing defined twice with a project file involved, before any feature uses it.
- An unknown name in `steps.core.exclude` is a `steps/core-exclude` lint error instead of a crash at run time.
- `sdods lint --undefined-steps` no longer reports "no findings" when bddgen fails for a reason other than a missing step. An ambiguity bddgen reports is surfaced as `steps/ambiguous`; any other generation failure is `steps/bddgen`, with the end of its output.
