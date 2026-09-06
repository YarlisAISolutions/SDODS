import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// The desktop package declares NO production dependencies: electron-builder's dependency
// collector has no handling for bun's node_modules/.bun symlink layout, so everything is bundled
// by rollup instead of shipped as node_modules. externalizeDepsPlugin keeps `electron` and Node
// builtins external, which is what we want.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
