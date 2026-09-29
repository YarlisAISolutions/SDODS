import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * Firebase ID token verification without the Admin SDK.
 *
 * A Firebase ID token is a JWT signed by Google's `securetoken` service account. Checking the
 * signature against its published keys, the issuer and audience (both tied to the project), and the
 * expiry is exactly what `admin.auth().verifyIdToken()` does, minus the revocation check — which
 * this service does not need, because it never trusts a token for more than the request it arrives
 * with. See https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 */

export const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export type Role = 'member' | 'editor' | 'admin';

export interface Viewer {
  uid: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  picture: string | null;
  /** `github.com`, `google.com`, … */
  provider: string;
  role: Role;
}

export interface VerifierOptions {
  project: string;
  /** Verified emails that are admins without a custom claim. */
  adminEmails: string[];
  /** Injected in tests; defaults to Google's published keys, cached and refreshed by jose. */
  keys?: JWTVerifyGetKey;
}

export type Verifier = (authorization: string | undefined) => Promise<Viewer | null>;

export function createVerifier(opts: VerifierOptions): Verifier {
  const keys = opts.keys ?? createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  const admins = new Set(opts.adminEmails.map((e) => e.toLowerCase()));

  return async (authorization) => {
    const m = /^Bearer (\S+)$/.exec(authorization ?? '');
    if (!m) return null;
    try {
      const { payload } = await jwtVerify(m[1]!, keys, {
        issuer: `https://securetoken.google.com/${opts.project}`,
        audience: opts.project,
        algorithms: ['RS256'],
      });
      const uid = payload.sub;
      if (!uid || uid.length > 128) return null;
      // Firebase sets auth_time; a token claiming a sign-in in the future is not one it issued.
      if (typeof payload.auth_time !== 'number' || payload.auth_time * 1000 > Date.now() + 60_000)
        return null;

      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
      const emailVerified = payload.email_verified === true;
      const firebase = payload.firebase as { sign_in_provider?: unknown } | undefined;
      const claimed = payload.role;
      // An admin by email needs a verified address: GitHub can return an unverified one.
      const role: Role =
        claimed === 'admin' || (email && emailVerified && admins.has(email))
          ? 'admin'
          : claimed === 'editor'
            ? 'editor'
            : 'member';

      return {
        uid,
        name: displayName(payload.name, email),
        email,
        emailVerified,
        picture: typeof payload.picture === 'string' ? payload.picture : null,
        provider: typeof firebase?.sign_in_provider === 'string' ? firebase.sign_in_provider : '',
        role,
      };
    } catch {
      return null;
    }
  };
}

/** A name to show. Never the email address: that stays private. */
function displayName(name: unknown, email: string | null): string {
  if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 100);
  if (email) return email.split('@')[0]!.slice(0, 100);
  return 'SDODS user';
}

export const canModerate = (v: Viewer | null): boolean =>
  v?.role === 'editor' || v?.role === 'admin';
