import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
};

export const firebaseApp: FirebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth: Auth = getAuth(firebaseApp);

/**
 * Matches the school email shape the server independently re-checks
 * (`allowedSchoolEmail` in rogueserver's `api/account/firebase.go`). Used
 * here only to reject an obviously wrong email before creating a Firebase
 * account for it - the server's check is the real security boundary and is
 * never skipped, regardless of what this returns.
 */
const ALLOWED_SCHOOL_EMAIL = /^2026\d{4}@hanilgo\.cnehs\.kr$/;

export function isAllowedSchoolEmail(email: string): boolean {
  return ALLOWED_SCHOOL_EMAIL.test(email);
}

/**
 * Creates a Firebase email/password account for `email` and returns the
 * resulting ID token, for exchanging with the server
 * (`/account/login/firebase`) via {@linkcode PokerogueAccountApi.loginWithFirebase}.
 * @throws A Firebase `FirebaseError` (e.g. `auth/email-already-in-use`,
 * `auth/weak-password`, `auth/invalid-email`) if registration fails.
 */
export async function registerWithFirebaseEmail(email: string, password: string): Promise<string> {
  const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  return await credential.user.getIdToken();
}

/**
 * Signs into an existing Firebase email/password account and returns the
 * resulting ID token, for exchanging with the server the same way as
 * {@linkcode registerWithFirebaseEmail}.
 * @throws A Firebase `FirebaseError` (e.g. `auth/invalid-credential`,
 * `auth/too-many-requests`) if sign-in fails.
 */
export async function signInWithFirebaseEmail(email: string, password: string): Promise<string> {
  const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
  return await credential.user.getIdToken();
}
