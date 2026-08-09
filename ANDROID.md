# Cricket Connect — Android / Play Store

Your web app is already installable on Android. This guide covers the *extra* step:
wrapping it as a real `.aab` you can upload to the Google Play Store.

## Two ways to get on Android

**Option A — Add to Home Screen (free, works today, no Play account)**
Open `cricket-pied-ten.vercel.app` in Chrome → menu (⋮) → **Add to Home screen**.
You get an icon, full-screen launch, offline support. For a club app this is often
all you need, and there's nothing to maintain.

**Option B — Play Store listing (needs a one-off $25 Google Play developer account)**
Wrap the same site in a *Trusted Web Activity* (TWA). Android runs your real site
inside a native shell with no browser chrome. It IS your website — you keep shipping
updates by pushing to GitHub, and installed apps pick them up. No app resubmission
for content changes.

Everything below is Option B.

---

## What's already prepared for you

| File | Purpose |
|---|---|
| `manifest.json` | Play-ready: `id`, maskable icon, screenshots, shortcuts, categories |
| `assetlinks.json` | Digital Asset Links — proves you own the site |
| `vercel.json` | Rewrites `/.well-known/assetlinks.json` → `/assetlinks.json` |
| `twa-manifest.json` | Bubblewrap config, pre-filled with your domain and colours |
| `shot-scoring.png`, `shot-stats.png` | Play listing screenshots (540×1110) |
| `feature-graphic.png` | Play feature graphic (1024×500) |
| `icon-512.png`, `icon-maskable-512.png` | App icons |

> The `.well-known` rewrite matters. Android insists on finding asset links at
> `/.well-known/assetlinks.json`, but keeping the repo flat avoids the folder-upload
> problem. The rewrite in `vercel.json` gives Android the path it wants while the file
> itself stays at the root.

---

## Step 1 — Install the tools

You need **Node 18+** and a **JDK 17**.

```bash
npm install -g @bubblewrap/cli
```

First run downloads Android build tools automatically — say yes when it offers.

## Step 2 — Initialise from your live manifest

```bash
mkdir cricket-connect-android && cd cricket-connect-android
bubblewrap init --manifest https://cricket-pied-ten.vercel.app/manifest.json
```

Accept the defaults, except:

- **Application ID**: `app.vercel.cricket_pied_ten.twa`
  (must match `package_name` in `assetlinks.json`)
- **Display mode**: `standalone`
- **Status bar colour**: `#0D1B2A` (must match `--bg-0` in `styles.css` and `theme_color` in `manifest.json`, or the native splash/status bar will visibly flash a different shade than the app on launch)

It creates a signing key. **Back that keystore up somewhere safe.** Lose it and you can
never update the app on Play again — you'd have to publish under a new listing and every
user would have to reinstall. This is the single most consequential file in the process.

## Step 3 — Build

```bash
bubblewrap build
```

You get:
- `app-release-bundle.aab` — upload this to Play
- `app-release-signed.apk` — for testing on your own phone

Install the APK to test:
```bash
adb install app-release-signed.apk
```

## Step 4 — Wire up asset links (the step everyone gets wrong)

Get your signing fingerprint:

```bash
keytool -list -v -keystore android.keystore -alias android
```

> The alias name is whatever you entered at the `bubblewrap init` prompt — check
> with `keytool -list -v -keystore android.keystore` (no `-alias`) if unsure.
> For the actual CricketConnect keystore generated during setup, the alias is `android`.

Copy the **SHA256** line — it looks like `A1:B2:C3:...`, 32 pairs.

Open `assetlinks.json` in your repo and replace `REPLACE_WITH_YOUR_SHA256_FINGERPRINT`
with it. Keep the colons. Commit and push.

Verify it's live:
```
https://cricket-pied-ten.vercel.app/.well-known/assetlinks.json
```

If that URL doesn't return your JSON, the app will open with a browser address bar
visible instead of looking native. That's the tell that asset links aren't matching.

> Bubblewrap can also print the exact file for you:
> `bubblewrap fingerprint generateAssetLinks`

## Step 5 — Publish

1. [play.google.com/console](https://play.google.com/console) → pay the one-time $25
2. **Create app** → name **Cricket Connect**, type App, free
3. Upload `app-release-bundle.aab` under **Production → Create new release**
4. Store listing:
   - Short description: *Connecting cricket. Creating champions.*
   - Full description: see the block below
   - Screenshots: `shot-scoring.png`, `shot-stats.png` (add more by screenshotting your phone)
   - Feature graphic: `feature-graphic.png`
   - App icon: `icon-512.png`
5. Fill **Content rating**, **Data safety**, **Privacy policy** (see below)
6. Submit

First review is typically a few days. Later updates are usually quicker.

---

## Play policy — the two things that will block you

**Privacy policy is mandatory.** Play requires a public URL, even for a simple app.
You collect an email address and a display name via Supabase Auth, and store match data
in Postgres. Write a short honest page saying exactly that and host it — a
`privacy.html` in this same repo works, giving you
`https://cricket-pied-ten.vercel.app/privacy.html`.

**Data safety form must match reality.** For this app, declare:

| Question | Answer |
|---|---|
| Collects data? | Yes |
| Email address | Collected, for account management, not shared |
| Name | Collected, for account management, not shared |
| App activity (match data) | Collected, for app functionality, not shared |
| Encrypted in transit? | Yes (HTTPS + Supabase) |
| Can users request deletion? | Yes — describe how (they email you, or you add an in-app delete) |

Declaring "no data collected" when you use Supabase Auth is a common cause of rejection.

---

## Suggested store description

```
Cricket Connect — Connecting cricket. Creating champions.

Score your matches ball by ball, run your own tournaments, and share a live link
so anyone can follow along.

LIVE SCORING
• Ball-by-ball: runs, wides, no-balls, byes, leg byes, every dismissal type
• Automatic strike rotation, over changes, maidens and innings breaks
• Partnerships, fall of wickets, last-five-overs and projected score
• Undo any ball — saves after every delivery, so you can close the app mid-over

TOURNAMENTS
• League, or league plus knockouts
• Fixtures generated automatically
• Points table with correct ICC net run rate
• Semi-finals seeded from the table, winners advance automatically

STATS
• Career records: runs, average, strike rate, wickets, economy, best figures
• Leaderboards and best individual performances
• Team win records

SHARE LIVE
• Send a link — anyone can watch the score and commentary update in real time
• No sign-in or install needed to watch

WORKS ANYWHERE
• Full offline support — score at grounds with no signal
• Syncs to your account when you reconnect
```

---

## Updating the app later

For **content and code changes** — push to GitHub. Vercel redeploys, and the Android app
loads the new version on next launch. **No Play resubmission.** That's the whole appeal
of a TWA.

Remember to bump `VERSION` in `sw.js` or the service worker keeps serving the cached copy.

You only rebuild and resubmit the `.aab` when you change the app **name, icon, package
ID, or permissions**.

---

## Troubleshooting

**App opens with a URL bar showing**
Asset links aren't verified. Check `/.well-known/assetlinks.json` loads, the SHA256
matches your keystore exactly, and the package name matches. Uninstall and reinstall
after fixing — Android caches verification.

**"App not installed" when sideloading**
You already have a version signed with a different key. Uninstall the old one first.

**Play rejects for "broken functionality"**
Usually the reviewer had no network on first launch and hit the sign-in wall. Your app
already handles this — "Continue without an account" works offline — but mention it in
the review notes so they know to try it.

**Splash screen flashes white**
Confirm `backgroundColor` is `#0D1B2A` in `twa-manifest.json` and rebuild.
