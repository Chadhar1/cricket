/* ===========================================================================
   FIREBASE MESSAGING CONFIG — paste your Firebase project's values below.

   This is a DIFFERENT project from the old, unused firebase-config.js in
   this folder (that one was for Firebase Auth, from before the app moved to
   Supabase — it's dead code, nothing imports it, safe to ignore). Push
   notifications specifically need a Firebase project because Firebase
   Cloud Messaging (FCM) is the only widely-supported way to deliver Web
   Push to a browser that isn't open — Supabase doesn't have an equivalent
   service, so this app now depends on two backends: Supabase for
   data/auth, Firebase for nothing but message delivery.

   To fill this in:
     1. https://console.firebase.google.com -> Add project (any name; it
        never needs its own Auth, Firestore, or anything else enabled)
     2. Project settings (gear icon) -> General -> "Your apps" -> Add app ->
        Web (</>) -> register it (no Firebase Hosting needed) -> copy the
        `firebaseConfig` object it shows you into the object below
     3. Project settings -> Cloud Messaging tab -> "Web Push certificates" ->
        Generate key pair -> paste the resulting string into vapidKey below
     4. Project settings -> Service accounts -> Generate new private key ->
        this downloads a JSON file. That file's contents (the WHOLE file) are
        a SERVER secret, never pasted here — see the notification system
        setup notes for where it actually goes
        (supabase secrets set FCM_SERVICE_ACCOUNT_JSON=...).

   Everything in the object below (apiKey included) is a public web
   identifier, the same way supabase-config.js's anon key is — safe to ship
   to the browser and safe to commit. It identifies which Firebase project
   to talk to; it grants no access on its own.

   If you leave the placeholders in place, push notifications simply won't
   be offered (the "Enable notifications" toggle stays hidden) — nothing
   else in the app is affected.
   =========================================================================== */

export const firebaseMessagingConfig = {
  apiKey: "PASTE_YOUR_FIREBASE_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

// Web Push certificate key pair, from Cloud Messaging -> Web Push
// certificates (NOT the same thing as an API key).
export const vapidKey = "PASTE_YOUR_VAPID_KEY";

export function isPushConfigured(){
  return !!firebaseMessagingConfig.apiKey && !firebaseMessagingConfig.apiKey.startsWith("PASTE_")
      && !!vapidKey && !vapidKey.startsWith("PASTE_");
}
