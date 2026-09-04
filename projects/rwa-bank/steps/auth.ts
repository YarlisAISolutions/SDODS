import { defineAuth } from '@sdods/core/auth';

/**
 * The application signs in with a plain form, so the `auth.form` selectors in
 * sdods.project.yaml are all the strategy needs. Captured state is reused as storageState,
 * which is why a scenario tagged `@user:standard` starts already signed in.
 */
export const auth = defineAuth({ strategy: 'form' });
