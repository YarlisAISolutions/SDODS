import type { RoleClaims } from '../auth.js';
import { metadataToken } from './token.js';

export interface IdentityToolkitOptions {
  project: string;
  fetch?: typeof fetch;
  /** Returns an OAuth access token; defaults to the GCE/Cloud Run metadata server. */
  token?: () => Promise<string>;
}

/**
 * Writes the role as a Firebase Auth custom claim, so it travels in the ID token and both the
 * security rules and this service read it with no extra lookup. It takes effect when the user's
 * token next refreshes (within the hour).
 */
export function identityToolkitRoleClaims(opts: IdentityToolkitOptions): RoleClaims {
  const fetchImpl = opts.fetch ?? fetch;
  const token = opts.token ?? metadataToken(fetchImpl);
  return async (uid, role) => {
    const res = await fetchImpl(
      `https://identitytoolkit.googleapis.com/v1/projects/${opts.project}/accounts:update`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          localId: uid,
          customAttributes: JSON.stringify(role === 'member' ? {} : { role }),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error(`setRole claims: HTTP ${res.status} ${await res.text()}`);
  };
}
