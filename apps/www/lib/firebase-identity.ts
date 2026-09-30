import type { Identity, SignInProvider, SiteUser } from '@sdods/site-kit/identity';
import { SignInCancelled } from '@sdods/site-kit/identity';

/**
 * sdods.com's sign-in: Firebase Auth, with GitHub and Google. The build points
 * `@sdods/site-kit/identity-impl` here with SDODS_IDENTITY_MODULE; this file moves to the private
 * deployment package (sdods-fcore).
 *
 * The web config is public by design: it identifies the project, it is not a credential.
 * `firebase/app` and `firebase/auth` load lazily, inside these functions, so a page that only
 * shows the questions list never downloads them.
 */
const config = {
  projectId: 'automax-docs',
  appId: '1:71482759203:web:69a0c0309f84eac63b7996',
  apiKey: 'AIzaSyCCXO7PN4K17FElJ5pZxBsLr1EAWNzNktg',
  // sdods.com, not automax-docs.firebaseapp.com: the sign-in popup and the GitHub/Google consent
  // screens then show our own domain, and sign-in state is first-party, which browsers that
  // partition third-party storage require. Firebase Hosting serves /__/auth/handler on sdods.com
  // because the site belongs to this project. The GitHub OAuth app's callback and the Google web
  // client's redirect URIs must include https://sdods.com/__/auth/handler.
  authDomain: 'sdods.com',
  storageBucket: 'automax-docs.firebasestorage.app',
  messagingSenderId: '71482759203',
};

async function auth() {
  const [{ getApps, initializeApp }, mod] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
  ]);
  const app = getApps()[0] ?? initializeApp(config);
  return { mod, auth: mod.getAuth(app) };
}

export function createIdentity(): Identity {
  return {
    providers: ['github', 'google'],
    async watch(cb) {
      const { mod, auth: a } = await auth();
      return mod.onAuthStateChanged(a, (u) =>
        cb(
          u ? ({ uid: u.uid, name: u.displayName, picture: u.photoURL } satisfies SiteUser) : null,
        ),
      );
    },
    async signIn(provider: SignInProvider) {
      const { mod, auth: a } = await auth();
      // A popup rather than a redirect: redirects break when the browser blocks third-party
      // cookies on a custom domain, which is now the common case.
      const p = provider === 'github' ? new mod.GithubAuthProvider() : new mod.GoogleAuthProvider();
      try {
        await mod.signInWithPopup(a, p);
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (code.includes('popup-closed') || code.includes('cancelled-popup'))
          throw new SignInCancelled();
        throw e;
      }
    },
    async signOut() {
      const { mod, auth: a } = await auth();
      await mod.signOut(a);
    },
    async idToken() {
      const { auth: a } = await auth();
      // On a fresh load the persisted session is restored asynchronously; wait for it.
      await a.authStateReady();
      // getIdToken refreshes an expiring token.
      return (await a.currentUser?.getIdToken()) ?? null;
    },
  };
}
