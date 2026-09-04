/**
 * SDODS runner config. Generated from the project registry: one run target per
 * (project × layer × browser). Driven by the SDODS_* environment variables that
 * `sdods run` sets, and always loaded through an explicit `--config` path.
 */
import { defineConfig } from '@playwright/test';
import { ProjectRegistry, buildRunnerConfig, selectionFromEnv } from '@sdods/core/config';

const rootDir = process.env.SDODS_ROOT ?? ProjectRegistry.findRepoRoot(import.meta.dirname);
const registry = ProjectRegistry.discover(rootDir);

export default defineConfig(buildRunnerConfig(registry, selectionFromEnv()));
