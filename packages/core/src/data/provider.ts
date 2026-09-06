import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Faker, en } from '@faker-js/faker';
import type { ResolvedConfig } from '../config/resolve.js';
import { SdodsError } from '../errors.js';
import { Logger } from '../logger.js';
import { loadFileSource } from './loaders.js';
import type { DataProvider, Row } from './types.js';
import type { FactoryMap } from './factories.js';

export interface CompositeDataProviderOptions {
  seed?: string;
  vars?: Record<string, string | undefined>;
}

/** Dispatches datasets by source type, seeds faker per scenario, owns the cleanup registry. */
export class CompositeDataProvider implements DataProvider {
  private readonly log = new Logger('data');
  private readonly cleanups: Array<{ fn: () => Promise<void>; description?: string }> = [];
  private factories?: Promise<FactoryMap>;
  readonly faker: Faker;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly opts: CompositeDataProviderOptions = {},
  ) {
    this.faker = new Faker({ locale: [en] });
    if (opts.seed) this.faker.seed(hashSeed(opts.seed));
  }

  async load<T extends Row = Row>(dataset: string): Promise<T[]> {
    const spec = this.config.project.data.sources[dataset];
    if (!spec) {
      throw new SdodsError(
        'DATASET_NOT_FOUND',
        `Dataset "${dataset}" is not declared for project ${this.config.project.slug}.`,
        {
          hint: `Known datasets: ${Object.keys(this.config.project.data.sources).join(', ') || '(none)'}. Add it under data.sources in sdods.project.yaml.`,
        },
      );
    }
    // `config.vars` is the dotenv layer merged under process.env — the same
    // scope the yaml was interpolated with. Falling back to bare `process.env`
    // here meant a `${VAR}` in a dataset could only ever resolve from the
    // shell, never from the `.env.<env>` file SDODS itself loaded.
    return (await loadFileSource(
      this.config,
      spec,
      this.opts.vars ?? this.config.vars ?? process.env,
    )) as T[];
  }

  async row<T extends Row = Row>(dataset: string, index: number): Promise<T> {
    const rows = await this.load<T>(dataset);
    const r = rows[index];
    if (!r) {
      throw new SdodsError(
        'DATASET_ROW_NOT_FOUND',
        `Dataset "${dataset}" has ${rows.length} row(s); row ${index} does not exist (0-based).`,
      );
    }
    return r;
  }

  async find<T extends Row = Row>(dataset: string, where: Partial<T>): Promise<T | undefined> {
    const rows = await this.load<T>(dataset);
    return rows.find((r) =>
      Object.entries(where).every(([k, v]) => String(r[k as keyof T]) === String(v)),
    );
  }

  async factory<T = Record<string, unknown>>(name: string, overrides: Partial<T> = {}): Promise<T> {
    const factories = await this.loadFactories();
    const fn = factories[name];
    if (!fn) {
      throw new SdodsError('DATASET_NOT_FOUND', `Factory "${name}" not found.`, {
        hint: `Known factories: ${Object.keys(factories).join(', ') || '(none)'}. Define it in ${this.config.project.data.factories ?? 'data/factories.ts'}.`,
      });
    }
    return { ...(fn(this.faker) as T), ...overrides };
  }

  private loadFactories(): Promise<FactoryMap> {
    if (!this.factories) {
      this.factories = (async () => {
        const rel = this.config.project.data.factories;
        if (!rel) return {};
        const file = isAbsolute(rel) ? rel : resolvePath(this.config.project.root, rel);
        if (!existsSync(file)) return {};
        const mod = (await import(pathToFileURL(file).href)) as {
          default?: FactoryMap;
          factories?: FactoryMap;
        };
        return mod.default ?? mod.factories ?? {};
      })();
    }
    return this.factories;
  }

  registerCleanup(fn: () => Promise<void>, description?: string) {
    this.cleanups.push({ fn, description });
  }

  async runCleanups() {
    const errors: Array<{ description?: string; error: string }> = [];
    while (this.cleanups.length) {
      const c = this.cleanups.pop()!;
      try {
        await c.fn();
      } catch (e) {
        errors.push({ description: c.description, error: (e as Error).message });
        this.log.warn(
          `cleanup failed${c.description ? ` (${c.description})` : ''}: ${(e as Error).message}`,
        );
      }
    }
    return errors;
  }
}

function hashSeed(s: string): number {
  return parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16);
}
