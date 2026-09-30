/**
 * Sign-in for a static site, behind a port so the site does not depend on one identity vendor.
 *
 * A site imports `createIdentity` from `@sdods/site-kit/identity-impl`. Out of the box that module
 * is the no-sign-in implementation in ./none.ts; a deployment points the alias at its own module
 * (Next.js `turbopack.resolveAlias`, see apps/www/next.config.mjs) with the same export.
 */

export type SignInProvider = 'github' | 'google';

/** The signed-in person, as much of them as a page needs. */
export interface SiteUser {
  uid: string;
  /** Display name from the provider; null when it gives none. */
  name: string | null;
  picture: string | null;
}

export interface Identity {
  /** Providers this deployment offers; empty when sign-in is off. */
  readonly providers: readonly SignInProvider[];
  /** Calls back with the signed-in user (or null) now and on every change; returns unsubscribe. */
  watch(cb: (user: SiteUser | null) => void): Promise<() => void>;
  /** Rejects with SignInCancelled when the person closes the popup; other errors are failures. */
  signIn(provider: SignInProvider): Promise<void>;
  signOut(): Promise<void>;
  /** A fresh ID token for the API's `Authorization: Bearer`, or null when nobody is signed in. */
  idToken(): Promise<string | null>;
}

/** Closing the sign-in popup is a choice, not an error worth a message. */
export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
    this.name = 'SignInCancelled';
  }
}
