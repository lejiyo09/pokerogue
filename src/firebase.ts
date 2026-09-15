import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, GoogleAuthProvider, getAuth, signInWithPopup } from "firebase/auth";

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
 * Narrows the Google account picker to this school's Google Workspace
 * domain. This is a UX convenience only, not the real security boundary -
 * the server independently re-verifies the signed-in account's email
 * against the exact allowed shape, and rejects anything else regardless of
 * what the picker showed.
 */
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ hd: "hanilgo.cnehs.kr" });

/**
 * Opens the Google sign-in popup and returns the resulting Firebase ID
 * token, for exchanging with the server (`/account/login/google`) via
 * {@linkcode PokerogueAccountApi.loginWithGoogle}.
 * @throws Whatever `signInWithPopup` throws - e.g. if the user closes the
 * popup, or it's blocked by the browser.
 */
export async function signInWithGoogle(): Promise<string> {
  const credential = await signInWithPopup(firebaseAuth, googleProvider);
  return await credential.user.getIdToken();
}
