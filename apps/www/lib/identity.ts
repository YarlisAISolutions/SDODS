import { createIdentity } from '@sdods/site-kit/identity-impl';

/**
 * The site's sign-in. `@sdods/site-kit/identity-impl` is no sign-in unless the build points it at
 * a real implementation with SDODS_IDENTITY_MODULE (see next.config.mjs).
 */
export const identity = createIdentity();
