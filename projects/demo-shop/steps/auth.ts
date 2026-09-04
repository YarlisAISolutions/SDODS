import { defineAuth } from '@automax/core/auth';

/**
 * SauceDemo login strategy. Uses the `auth.form` selectors from automax.project.yaml,
 * producing a storageState that pool users reuse across scenarios.
 */
export const auth = defineAuth({ strategy: 'form' });
