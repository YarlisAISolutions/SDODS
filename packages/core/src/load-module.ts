import { pathToFileURL } from 'node:url';

/**
 * Import a TypeScript module that belongs to a project (`steps/auth.ts` and friends) from outside
 * the Playwright runner.
 *
 * `sdods run` loads project files through Playwright's TS loader, which transpiles full
 * TypeScript, remaps `import './helper.js'` to `helper.ts`, and treats a file as ESM or CommonJS
 * by its package type. A bare `import()` from a CLI command hands the file to Node's native type
 * stripping instead, which does none of the remapping — so a helper imported the conventional way
 * worked under `sdods run` and crashed `sdods auth capture` with "Cannot find module .../helper.js"
 * (#86). In the workspace the gap was invisible, because bin/sdods.js registers tsx globally.
 *
 * tsx gives the same three behaviours as Playwright's loader. Both its ESM and CommonJS hooks are
 * registered — a project without `"type": "module"` loads `.ts` as CommonJS, and a CommonJS
 * `require('./helper.js')` only goes through tsx's CJS hook — and removed again once the import
 * settles, so nothing else in the process is affected. Registrations are reference-counted so
 * overlapping imports do not unregister each other's hooks mid-load.
 */
let active = 0;
let hooks: Promise<() => Promise<void>> | undefined;

async function acquire(): Promise<void> {
  active++;
  hooks ??= (async () => {
    const [esm, cjs] = await Promise.all([import('tsx/esm/api'), import('tsx/cjs/api')]);
    const offEsm = esm.register();
    const offCjs = cjs.register();
    return async () => {
      offCjs();
      await offEsm();
    };
  })();
  try {
    await hooks;
  } catch (e) {
    // Do not leave a rejected registration cached for every later import.
    if (--active === 0) hooks = undefined;
    throw e;
  }
}

async function releaseOne(): Promise<void> {
  if (--active > 0 || !hooks) return;
  const off = hooks;
  hooks = undefined;
  await (
    await off
  )();
}

export async function importProjectModule<T = Record<string, unknown>>(file: string): Promise<T> {
  await acquire();
  try {
    return (await import(pathToFileURL(file).href)) as T;
  } finally {
    await releaseOne();
  }
}

/**
 * A named export from a module loaded by {@link importProjectModule}. A CommonJS-format file (no
 * `"type": "module"` in the project) arrives with its exports under `default`.
 */
export function namedExport<T>(mod: Record<string, unknown>, name: string): T | undefined {
  if (mod[name] !== undefined) return mod[name] as T;
  const def = mod.default as Record<string, unknown> | undefined;
  if (def && typeof def === 'object' && def[name] !== undefined) return def[name] as T;
  return undefined;
}
