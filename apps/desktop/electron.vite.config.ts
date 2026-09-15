import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// The desktop package declares NO production dependencies: electron-builder's dependency
// collector has no handling for bun's node_modules/.bun symlink layout, so everything is bundled
// by rollup instead of shipped as node_modules. externalizeDepsPlugin keeps `electron` and Node
// builtins external, which is what we want.
//
// That includes electron-updater: it is a devDependency, so the plugin leaves it to rollup, and
// `exclude` pins that down in case someone later "fixes" it into `dependencies`. A packaged app has
// no node_modules to load it from.

/**
 * Whether this build will be Developer ID signed, decided where the signing inputs are.
 *
 * The updater needs it on macOS, where Squirrel.Mac will not install an update into an unsigned
 * app. It cannot be asked at runtime without parsing `codesign` output: scripts/after-pack.mjs
 * ad-hoc signs every macOS build, so "has a valid signature" is true of the unsigned ones too.
 * desktop.yml runs this build and electron-builder in one step with the same environment, and
 * unsets empty secrets first, so CSC_LINK being present here means a certificate was supplied -- and
 * if signing then fails, electron-builder fails the job rather than shipping a mislabelled app.
 * `DESKTOP_SIGNED=1|0` overrides it, for a local build signed from the keychain (CSC_NAME).
 */
function signedBuild(): boolean {
  const explicit = process.env.DESKTOP_SIGNED;
  if (explicit !== undefined && explicit !== '') return explicit === '1' || explicit === 'true';
  return Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-updater'] })],
    define: { __DESKTOP_SIGNED__: JSON.stringify(signedBuild()) },
    build: {
      rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        // .mjs so the ESM preload is loaded as a module; main/index.ts points at index.mjs.
        output: { entryFileNames: '[name].mjs', format: 'es' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    // Relative asset paths: the bootstrap page is loaded with loadFile(), not over HTTP.
    base: './',
    plugins: [react()],
    build: {
      outDir: resolve(import.meta.dirname, 'out/renderer'),
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
      },
    },
  },
});
