import type { Faker } from '@faker-js/faker';

export type FactoryFn = (f: Faker) => Record<string, unknown>;
export type FactoryMap = Record<string, FactoryFn>;

/** Type helper for `projects/<slug>/data/factories.ts`. */
export function defineFactories<T extends FactoryMap>(factories: T): T {
  return factories;
}
