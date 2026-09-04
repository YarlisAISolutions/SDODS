/**
 * SDODS root Playwright config. Generated from the project registry:
 * one Playwright project per (project × layer × browser). Driven by SDODS_* env vars,
 * which `sdods run` sets; a bare `npx playwright test` still works for every project.
 */
import { defineConfig } from '@playwright/test';
import { ProjectRegistry, buildPlaywrightConfig, selectionFromEnv } from '@sdods/core/config';

const rootDir = process.env.SDODS_ROOT ?? ProjectRegistry.findRepoRoot(import.meta.dirname);
const registry = ProjectRegistry.discover(rootDir);

export default defineConfig(buildPlaywrightConfig(registry, selectionFromEnv()));
