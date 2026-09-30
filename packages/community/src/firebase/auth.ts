import type { IssuerOptions } from '../auth.js';

/** Firebase Auth ID tokens: signed by Google's `securetoken` service account for one project. */
export function firebaseIssuer(project: string): IssuerOptions {
  return {
    issuer: `https://securetoken.google.com/${project}`,
    audience: project,
    jwksUrl:
      'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
    requireAuthTime: true,
  };
}
