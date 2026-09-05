import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { addDoc, collection, getFirestore, serverTimestamp } from 'firebase/firestore';

/**
 * Firebase web config, shared with the landing site. These values are public by
 * design — they identify the project, they are not credentials. `firestore.rules`
 * is the security boundary: a stranger can create a page-feedback row and read
 * nothing back.
 */
const config = {
  projectId: 'automax-docs',
  appId: '1:71482759203:web:69a0c0309f84eac63b7996',
  apiKey: 'AIzaSyCCXO7PN4K17FElJ5pZxBsLr1EAWNzNktg',
  authDomain: 'automax-docs.firebaseapp.com',
  storageBucket: 'automax-docs.firebasestorage.app',
  messagingSenderId: '71482759203',
};

function app(): FirebaseApp {
  return getApps()[0] ?? initializeApp(config);
}

export type Verdict = 'helpful' | 'not-helpful';

/**
 * Record one "was this page helpful?" click. Stored rather than mailed: a
 * `mailto:` reaches nobody when the reader has no mail client configured, and
 * they never find out it failed.
 */
export async function recordPageFeedback(input: {
  path: string;
  title: string;
  verdict: Verdict;
  note: string;
}): Promise<void> {
  await addDoc(collection(getFirestore(app()), 'pageFeedback'), {
    path: input.path.slice(0, 300),
    title: input.title.slice(0, 200),
    verdict: input.verdict,
    note: input.note.trim().slice(0, 2000),
    status: 'new',
    createdAt: serverTimestamp(),
  });
}
