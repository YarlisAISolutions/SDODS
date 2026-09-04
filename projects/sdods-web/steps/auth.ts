import { defineAuth } from '@sdods/core/auth';

/** Form login against the SDODS web UI using the `auth.form` selectors from the project yaml. */
export const auth = defineAuth({ strategy: 'form' });
