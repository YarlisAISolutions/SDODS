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
  authDomain: 'automax-docs.firebaseapp.com',
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

/** The one account `firestore.rules` accepts as a moderator. */
export const MODERATOR_EMAIL = 'admin@sdods.com';
