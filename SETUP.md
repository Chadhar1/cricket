# Cricket Connect — Setup Guide

Everything here is free. No credit card, no build step, no framework.

## Your keys are already in

`firebase-config.js` is filled in with your **cricket-connect-d277c** project. You do
not need to edit any file. What's left is switching things on in the Firebase console
(Part 1) and deploying (Part 2).

> **These keys are not secrets.** Firebase web API keys are public by design — they
> identify your project, they don't grant access. Your data is protected by
> `firestore.rules`, not by hiding this file. Safe to commit to a public repo, which is
> why there's no `.env` here.

---

## Checklist

Work top to bottom. Each box is a thing you click in a console, not code you write.

- [ ] Authentication → Sign-in method → enable **Email/Password**
- [ ] Authentication → Sign-in method → enable **Google**
- [ ] Firestore Database → create it (region `asia-south1`)
- [ ] Firestore → Rules → paste `firestore.rules` → Publish
- [ ] Push to GitHub → import to Vercel → deploy
- [ ] Authentication → Settings → Authorized domains → **add your Vercel URL**
- [ ] Open the URL on your phone → Add to Home Screen

The last two are where people get stuck. Don't skip the Authorized domains step.

---

## What's in the folder

| File | Purpose |
|---|---|
| `index.html` | The app shell — every screen |
| `live.html` | Read-only spectator page for share links |
| `app.js` | Navigation, screens, persistence, cloud wiring |
| `engine.js` | Cricket rules: runs, extras, wickets, results |
| `tournament.js` | Fixtures, points table, net run rate, bracket |
| `avatars.js` | 12 bundled SVG avatars |
| `cloud.js` | All Firebase calls |
| `firebase-config.js` | Your Firebase keys — already filled in |
| `firestore.rules` | Paste into the Firebase console |
| `stats.js` | Career records engine |
| `privacy.html` | Privacy policy — Play requires a public one |
| `ANDROID.md`, `twa-manifest.json`, `assetlinks.json` | Play Store packaging |
| `styles.css`, `manifest.json`, `sw.js`, `icon-*.png` | Theme, install, offline |
| `run-tests.mjs` | 105 assertions — run with `node run-tests.mjs` |
| `vercel.json` | Caching headers |

---

# Part 1 — Firebase console (about 10 minutes)

Open your project: <https://console.firebase.google.com/project/cricket-connect-d277c>

### 1. Enable sign-in methods

**Build → Authentication → Get started → Sign-in method**

Enable both:

- **Email/Password** → toggle Enable → Save
  *(leave "Email link / passwordless" off)*
- **Google** → toggle Enable → pick a support email → Save

### 2. Authorise your domain — don't skip this

Still in **Authentication → Settings → Authorized domains → Add domain**

Add your Vercel domain, e.g. `cricket-scorer-xyz.vercel.app`

> **This is the single most common setup failure.** Sign-in dies with
> `auth/unauthorized-domain` if the domain isn't listed. `localhost` is already there by
> default. Add any custom domain you attach later too.

### 3. Create the database

1. **Build → Firestore Database → Create database**
2. **Start in production mode** — the rules you paste next are what matter
3. Location: **`asia-south1` (Mumbai)** is the closest option for Pakistan.
   **This can never be changed**, so choose deliberately
4. **Enable**

### 4. Publish the security rules

**Firestore Database → Rules tab** → delete everything in the editor → paste the whole
of `firestore.rules` → **Publish**.

Those rules say: your matches, teams, tournaments and profile are yours alone; a match
is publicly readable only while you have live sharing switched on for it.

---

# Part 2 — Vercel (about 10 minutes)

### 1. Put the folder on GitHub

**No-terminal way:**

1. <https://github.com/new> → name it `cricket-scorer` → **Create repository**
2. Click **uploading an existing file**
3. Drag in *everything inside* the `cricket-scorer` folder, including the `icons` folder
4. **Commit changes**

> `index.html` must sit at the **top level** of the repo. If GitHub shows a folder
> called `cricket-scorer` wrapping your files, open it and re-upload one level up.

**Terminal way:**

```bash
cd cricket-scorer
git init
git add .
git commit -m "Cricket scorer"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cricket-scorer.git
git push -u origin main
```

### 2. Deploy

1. <https://vercel.com/new> → sign in with GitHub
2. Import `cricket-scorer`
3. Framework Preset: **Other**. Leave **Build Command** and **Output Directory empty** —
   this is a static site, there is nothing to build
4. **Deploy**

You get a URL like `https://cricket-scorer-xyz.vercel.app`. Go back and add that domain
to Firebase Authorized domains (Part 1, step 2) if you haven't.

Every future `git push` redeploys automatically.

### 3. Install on your phone

- **Android / Chrome** — open the URL → ⋮ → **Add to Home screen** → **Install**
- **iPhone / Safari** — open the URL → Share → **Add to Home Screen**

Full screen, own icon, works with no signal.

---

# Using the app

### Signing up

First launch shows the sign-in screen. **Create account** asks for a name, an avatar
(12 to choose from) and email + password. Or use **Continue with Google**. Or tap
**Continue without an account** to stay local-only — you can sign in later from Profile
and your local data stays put.

Change your name or avatar any time in **Profile**.

### Teams

**Teams tab** → add a team and its players. Once saved, player names appear as tappable
chips during match setup, so you stop typing the same names every week.

### Tournaments

**Cups tab → + New**:

1. Name it, pick the format (**League + knockouts** or **League only**)
2. Set overs, choose teams from your saved list or type new ones
3. Optionally make it home-and-away
4. **Create** — every fixture is generated automatically

Inside a tournament:

- **Table** — points and net run rate, updating itself as matches finish. Top four are
  shaded green
- **Fixtures** — set a date and venue per fixture, or hit **Play** to start scoring it
- **Knockout** — semi-finals seeded 1v4 and 2v3 from the final table, then the final.
  Winners advance automatically as each semi finishes
- **Teams** — squad list, and where you delete the tournament

When you finish scoring a tournament match, the result flows straight back into the
table and bracket. Nothing to enter twice.

**Net run rate** follows the ICC rule properly: a side bowled out is charged the full
quota of overs, not the overs it actually used. That's the part that's usually wrong
when people keep tables by hand.

### The Upcoming widget

The home screen lists what's next, merged from two sources: matches you schedule with
**+ Schedule**, and any tournament fixture you've given a date. Today's entries are
highlighted green. **Start** launches the match with teams, overs and venue pre-filled —
and if it came from a fixture, the result is wired back to that fixture automatically.

### Live sharing

Switch **Share live** on when setting up a match (needs sign-in). A panel appears with a
link like `.../live.html?m=k3f9a2xp`. Send it to anyone — they see the score, both
batters, the bowler, the current over and a rolling commentary feed, updating within a
second. **No sign-in or install needed to watch.** Turn the toggle off and the link dies
immediately.

---

## Will it cost anything?

Realistically no. Firebase's free Spark plan gives 20,000 document writes and 50,000
reads per day.

A T20 innings is about 130 balls. Each ball writes twice when live sharing is on (your
private copy plus the public one), so **a full match is roughly 500 writes** — about
2.5% of a day's free allowance. You'd need ~40 matches in one day to run out. Live
writes are throttled to one per 0.7 seconds, so fast tapping won't burn quota.

Vercel's free Hobby tier covers the hosting comfortably.

---

## Troubleshooting

**`auth/unauthorized-domain`**
Your Vercel domain isn't in Firebase → Authentication → Settings → Authorized domains.
Add it exactly as it appears in the address bar — no `https://`, no trailing slash.

**`auth/operation-not-allowed`**
That sign-in method isn't switched on. Authentication → Sign-in method → enable
Email/Password and Google.

**Google popup opens then instantly closes**
Common inside an installed PWA. The app falls back to redirect sign-in automatically. If
it still fails, sign in once in a normal browser tab, then reopen the installed app.

**"Missing or insufficient permissions"**
Rules weren't published. Firestore → Rules → paste `firestore.rules` → **Publish**.

**Live link says "Match not available"**
The toggle is off, or the scorer signed out. The scoring device should show the red
**Live share is on** panel.

**I changed a file but my phone shows the old version**
The service worker is serving cache. Open `sw.js`, bump `const VERSION = 'v2'` to
`'v3'`, push. Next load picks up the change.

**Double-clicking index.html does nothing**
Correct — ES modules can't load over `file://`. Use the Vercel URL, or:
```bash
cd cricket-scorer
python3 -m http.server 8000     # then open http://localhost:8000
```

**I want my data out**
Profile → **Export all data (JSON)** downloads everything: profile, teams, tournaments,
events and every scorecard.

---

## Where to take it next

The code is structured so each of these is a contained change:

- **Wagon wheel / pitch map** — `playBall()` in `engine.js` already receives every
  delivery; add `x,y` to the ball object and store it
- **Player career stats** — every scorecard is already in `users/{uid}/matches`;
  aggregate on read
- **Photo avatars** — swap `avatars.js` for Firebase Storage uploads; the profile only
  stores an id, so the change is localised
- **Multiple scorers on one match** — replace the single `ownerUid` check in
  `firestore.rules` with a `scorers` array
- **Super over** — `finishMatch()` in `engine.js` is where the tie is detected

`engine.js` and `tournament.js` have no DOM and no Firebase in them, so they stay
unit-testable as the app grows.
