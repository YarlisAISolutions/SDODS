---
'@sdods/core': patch
---

`sdods auth capture` loads `steps/auth.ts` the same way `sdods run` does.

- A project's `steps/auth.ts` that imports a sibling helper the conventional way (`import './helper.js'` for `helper.ts`) worked under `sdods run`, which goes through Playwright's TypeScript loader, and crashed `sdods auth capture` with `Cannot find module .../helper.js`: capture used a bare `import()`, so the published CLI handed the file to Node's native type stripping, which does not map `.js` to `.ts`. Capture now imports it through tsx, which maps `.js` to `.ts`, transpiles full TypeScript (enums included) and honours the project's module type, like Playwright's loader. The hooks are registered for that import only and removed afterwards. `tsx` is now a dependency of `@sdods/core`.
- A project without `"type": "module"` has its `auth` export read from the CommonJS module too, instead of silently falling back to the yaml strategy.
