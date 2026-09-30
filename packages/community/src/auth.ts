import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * Sign-in token verification for any OpenID Connect identity provider, without a vendor SDK.
 *
 * The browser signs in with whatever provider the deployment wires up and sends its ID token as a
 * bearer token. Checking the signature against the provider's published keys, the issuer, the
 * audience and the expiry is all this service needs: it never trusts a token for more than the
 * request it arrives with, so it does not need a revocation check either.
 */

export type Role = 'member' | 'editor' | 'admin';

export interface Viewer {
  uid: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  picture: string | null;
  /** `github.com`, `google.com`, … when the provider reports one; empty otherwise. */
  provider: string;
  role: Role;
}

/** Where tokens come from: the three values every OIDC provider publishes. */
export interface IssuerOptions {
  issuer: string;
  audience: string;
  jwksUrl: string;
  /** Reject tokens without an `auth_time` claim (providers that always set it). */
  requireAuthTime?: boolean;
}

export interface OidcVerifierOptions extends IssuerOptions {
  /** Verified emails that are admins without a `role` claim. */
  adminEmails: string[];
  /** Injected in tests; defaults to the issuer's published keys, cached and refreshed by jose. */
  keys?: JWTVerifyGetKey;
}

export type Verifier = (authorization: string | undefined) => Promise<Viewer | null>;

/** A verifier for deployments with no identity provider: nobody is signed in, nobody can post. */
export const noSignIn: Verifier = async () => null;

/**
 * Writes a role into the identity provider (a custom claim), so it arrives in the user's next
 * token as the `role` claim the verifier reads. The store mirrors it onto the public profile.
 */
export type RoleClaims = (uid: string, role: Role) => Promise<void>;

export function createOidcVerifier(opts: OidcVerifierOptions): Verifier {
  const keys = opts.keys ?? createRemoteJWKSet(new URL(opts.jwksUrl));
  const admins = new Set(opts.adminEmails.map((e) => e.toLowerCase()));

  return async (authorization) => {
    const m = /^Bearer (\S+)$/.exec(authorization ?? '');
    if (!m) return null;
    try {
      const { payload } = await jwtVerify(m[1]!, keys, {
        issuer: opts.issuer,
        audience: opts.audience,
        algorithms: ['RS256'],
      });
      const uid = payload.sub;
      if (!uid || uid.length > 128) return null;
      // A token claiming a sign-in in the future is not one the provider issued.
      const authTime = payload.auth_time;
      if (authTime === undefined ? opts.requireAuthTime : typeof authTime !== 'number') return null;
      if (typeof authTime === 'number' && authTime * 1000 > Date.now() + 60_000) return null;

      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
      const emailVerified = payload.email_verified === true;
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
        provider: providerOf(payload),
        role,
      };
    } catch {
      return null;
    }
  };
}

/** The sign-in provider, from the claims the common brokers use. */
function providerOf(payload: Record<string, unknown>): string {
  const nested = payload.firebase as { sign_in_provider?: unknown } | undefined;
  for (const v of [nested?.sign_in_provider, payload.idp, payload.provider])
    if (typeof v === 'string') return v;
  return '';
}

/** A name to show. Never the email address: that stays private. */
function displayName(name: unknown, email: string | null): string {
  if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 100);
  if (email) return email.split('@')[0]!.slice(0, 100);
  return 'SDODS user';
}

export const canModerate = (v: Viewer | null): boolean =>
  v?.role === 'editor' || v?.role === 'admin';
