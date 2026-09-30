import type { Identity } from './types';

/** The default `@sdods/site-kit/identity-impl`: no sign-in. Pages hide what needs an account. */
export function createIdentity(): Identity {
  return {
    providers: [],
    async watch(cb) {
      cb(null);
      return () => {};
    },
    async signIn() {
      throw new Error('Sign-in is not configured for this site.');
    },
    async signOut() {},
    async idToken() {
      return null;
    },
  };
}
