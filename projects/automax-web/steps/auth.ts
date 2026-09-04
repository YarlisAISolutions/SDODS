import { defineAuth } from '@automax/core/auth';

/** Form login against the AutoMax web UI using the `auth.form` selectors from the project yaml. */
export const auth = defineAuth({ strategy: 'form' });
