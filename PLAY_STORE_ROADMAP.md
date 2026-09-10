# CricketConnect — Roadmap to a Play Store Android App

Planning only — nothing below has been built. This is a roadmap to work through when you're ready.

## Phase 0 — Decide the shape of the app (one decision, up front)

You already have the foundation for this: `cricket-connect-android/` is a **Trusted Web Activity (TWA)** — a Play-Store-legitimate Android package that wraps your live website in Chrome, with its own keystore and a working signed build already. Three paths exist from here, in increasing order of effort:

1. **Fix and ship the existing TWA (recommended starting point).** Small, bounded effort. You keep 100% of your web code as the single source of truth — every scoring/feature update you deploy to Vercel updates the Play Store app instantly, with zero re-submission. Limitation: still bound by what a browser can do (which is exactly what caused the camera-permission issue we just diagnosed).
2. **Move to a hybrid wrapper (Capacitor).** Same web code, but swaps the TWA shell for one that can call real native plugins (camera, filesystem, push) when a browser API isn't enough. More setup than a TWA, far less than a rewrite. Worth considering only if Phase 1's permission fix still leaves real gaps (e.g., you want recording to survive the user switching apps, which browsers restrict).
3. **Full native rewrite (Kotlin or Flutter/React Native).** Best native performance and camera access, but genuinely a new app — a multi-month project, not a next phase. Only worth it if CricketConnect outgrows what a wrapped web app can do at all.

This roadmap assumes path 1, since it's a direct continuation of what already exists and what you've approved building on all session. Revisit path 2 later only if a specific limitation actually bites.

## Phase 1 — Fix and harden the TWA

- Add the permissions the app is actually missing: `android.permission.CAMERA` and `android.permission.RECORD_AUDIO` in `cricket-connect-android/app/src/main/AndroidManifest.xml` (this is the root cause of the camera prompt not appearing inside the installed app).
- Rebuild the TWA with Bubblewrap CLI (or Android Studio) using the existing `twa-manifest.json` and keystore.
- Verify Digital Asset Links: `assetlinks.json` must be correctly hosted at `https://<your-domain>/.well-known/assetlinks.json` and match the app's signing certificate, or the app falls back to showing Chrome's address bar instead of looking like a real app.
- Refresh app icons (standard + adaptive + splash) if they haven't been revisited since the initial TWA generation.
- Install the rebuilt AAB/APK on a couple of real Android devices (different OS versions if possible) and walk through the core flows once as an installed app, not a browser tab — auth, live scoring, and now Record Match specifically, since permission and camera behavior can differ between a plain Chrome tab and the TWA shell.

## Phase 2 — Play Store listing and compliance prep

- Google Play Developer account (one-time $25 registration, if you don't already have one).
- Store listing assets: app icon, feature graphic, phone screenshots (and tablet, if you want them), short description, full description.
- Privacy Policy URL — you already have a Privacy Policy screen in the app; it just needs to be a stable public URL Play Console can link to.
- Data Safety form — this is the part most likely to trip people up. You'll need to honestly declare what's collected: account/profile data, location (already used for "Cricket Near You"), and now camera/microphone access for local recording. Since recordings never leave the device or touch Supabase, that's a good, simple story to tell here.
- Content rating questionnaire (short, automated).
- Confirm `targetSdkVersion` in the TWA build meets Play's current minimum requirement (Play enforces a rolling minimum — check this at build time, not from memory, since it changes).

## Phase 3 — Internal testing release

- Build the final signed AAB.
- Upload to Play Console's **Internal Testing** track (near-instant availability, no review wait).
- Install it as a genuine Play-Store-delivered app on a test device (not sideloaded) — some TWA/asset-link/permission behaviors only fully resolve once Play has actually installed and verified the package, so this step catches things Phase 1's manual install can miss.
- Specifically re-verify Record Match end-to-end here: permission prompts, all 5 templates, and the actual "open the saved file outside the app" acceptance test from the original feature spec.

## Phase 4 — Closed or open testing

- Expand to a Closed Testing group (invited testers — friends, other organizers) or Open Testing (public beta, still pre-production).
- Watch Play Console's crash/ANR reports (Vitals) rather than relying only on manual reports.
- Fix whatever surfaces before moving to full production — this is the cheap place to catch problems, production review is not.

## Phase 5 — Production release

- Submit for Google's production review (TWAs do get reviewed like any other app; a functioning, permission-correct, policy-compliant app should clear this without drama, but budget a few days).
- Use a staged rollout (e.g., 20% → 50% → 100%) rather than pushing to everyone at once, so a bad build only reaches a fraction of users before you can halt it.
- Monitor crash-free rate, ANRs, and reviews for the first couple of weeks.

## Ongoing after launch

Because this is a TWA, remember the split: anything you change in the **website** (scoring rules, new features, bug fixes, the recording feature's own future improvements) reaches every installed app user automatically on their next open — no Play Store update needed. You only need a new Play Store submission when the **wrapper itself** changes: new permissions, new app icon, signing changes, or a move to Phase 0's path 2/3 later. Worth keeping in mind so you don't over- or under-estimate how often you'll be back in Play Console.
