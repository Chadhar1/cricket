/* ===========================================================================
   FIREBASE CONFIG  —  project: cricket-connect-d277c
   ---------------------------------------------------------------------------
   These keys are NOT secrets. Firebase web API keys are public by design —
   they identify the project, they do not grant access. Your data is protected
   by the rules in firestore.rules, not by hiding this file. Safe to commit.

   `measurementId` is only used by Google Analytics, which this app does not
   load. It is kept here purely so the object matches your console exactly.

   If you ever clear these values back to placeholders, the app falls back to
   LOCAL-ONLY mode instead of erroring: scoring, teams and tournaments all keep
   working on the device, just with no sync, accounts or live share.

   Before sign-in will work, in the Firebase console:
     1. Authentication -> Sign-in method -> enable Email/Password AND Google
     2. Authentication -> Settings -> Authorized domains -> add your Vercel URL
     3. Firestore Database -> Rules -> paste firestore.rules -> Publish
   =========================================================================== */

export const firebaseConfig = {
  apiKey: "AIzaSyB2pl0y3JyvOnKpGy9xVCE1boscAwxBdq4",
  authDomain: "cricket-connect-d277c.firebaseapp.com",
  projectId: "cricket-connect-d277c",
  storageBucket: "cricket-connect-d277c.firebasestorage.app",
  messagingSenderId: "129739072853",
  appId: "1:129739072853:web:16e9937be35015beecbbdc",
  measurementId: "G-70KYZS88ZZ"
};

/* Returns false while the placeholders above are still in place, so the app
   knows to stay in local-only mode instead of throwing errors. */
export function isConfigured(){
  return !!firebaseConfig.apiKey &&
         !firebaseConfig.apiKey.startsWith("PASTE_") &&
         !!firebaseConfig.projectId &&
         !firebaseConfig.projectId.startsWith("PASTE_");
}
