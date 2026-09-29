import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

/**
 * Firebase web config. These values are public by design — they identify the
 * project to Google, they are not credentials. Anyone can read them out of the
 * bundle, which is expected: `firestore.rules` is the security boundary, and it
 * lets a stranger create nothing but a `pending` document.
 */
const config = {
  projectId: 'automax-docs',
  appId: '1:71482759203:web:69a0c0309f84eac63b7996',
  apiKey: 'AIzaSyCCXO7PN4K17FElJ5pZxBsLr1EAWNzNktg',
  // sdods.com, not automax-docs.firebaseapp.com: the sign-in popup and the GitHub/Google consent
  // screens then show our own domain, and sign-in state is first-party, which browsers that
  // partition third-party storage require. Firebase Hosting serves /__/auth/handler on sdods.com
  // because the site belongs to this project. The GitHub OAuth app's callback and the Google web
  // client's redirect URIs must include https://sdods.com/__/auth/handler before this ships.
  authDomain: 'sdods.com',
  storageBucket: 'automax-docs.firebasestorage.app',
  messagingSenderId: '71482759203',
};

/** Initialised on first use, in the browser only — the site is a static export. */
export function app(): FirebaseApp {
  return getApps()[0] ?? initializeApp(config);
}

export function db(): Firestore {
  return getFirestore(app());
}
