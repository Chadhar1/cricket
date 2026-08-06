# Cricket Connect

**Connecting cricket. Creating champions.**

Ball-by-ball cricket scoring, teams, tournaments and fixtures. Installs on your phone
like a native app, works with no signal, and can broadcast a live link to spectators.

## Features

**Scoring**
- Full ball-by-ball: runs, wides, no-balls, byes, leg byes, every dismissal type
- Automatic strike rotation, over changes, maidens, innings breaks, targets and results
- Undo any ball; saves after every delivery so you can close the app mid-over

**Tournaments**
- League + knockout or league-only
- Round-robin fixtures generated automatically (single or home-and-away)
- Live points table with **correct ICC net run rate** — a side bowled out is charged the
  full quota of overs
- Semi-finals seeded 1v4 / 2v3 from the table, winners advance automatically
- Finished matches feed straight back into the table and bracket

**Teams & players**
- Saved squads; player names become tappable chips during setup

**Accounts**
- Email/password or Google sign-in, 12 bundled avatars, or use it with no account at all
- Matches, teams and tournaments sync across every device you sign in on

**Social & admin**
- Public usernames, friend requests, and a friends list (`social.js`)
- Players can apply to become an organiser; admins review the queue and approve/reject
- Admin dashboard: pending requests, organiser count, platform overview

**Fixtures**
- Schedule matches with date, time and venue
- Home widget merges scheduled matches and tournament fixtures; one tap to start

**Stats**
- Career records: runs, average, strike rate, HS, 50s/100s; wickets, economy, best figures
- Leaderboards, best individual performances, team win records

**Match centre**
- Tabbed scorecard / commentary / info, player of the match
- Partnerships, fall of wickets, last-five-overs, projected score
- Toss recorded, super over on a tie

**Live sharing**
- Send a link; spectators watch the score, over track and commentary update in real time
  without signing in or installing anything

## Stack

Plain HTML, CSS and ES modules. No framework, no bundler, no build step.
Supabase (Auth + Postgres + Realtime) for sync, Vercel for hosting. Both free tier.

`engine.js` (cricket rules), `tournament.js` (standings, NRR, brackets) and `social.js`
(friends, clubs, organiser applications) have no DOM and no Supabase dependency, so
they are independently unit-testable.

## Tests

The cricket rules and tournament maths are covered by 165 assertions with no
dependencies:

```bash
node run-tests.mjs
```

Run it before you push. If you change scoring or standings logic and this stays
green, you haven't broken anything.

## Setup

See **[SETUP.md](./SETUP.md)**. For the Play Store, see **[ANDROID.md](./ANDROID.md)**.

Short version: run `supabase.sql` in your Supabase project's SQL Editor, paste your
project URL + anon key into `supabase-config.js`, push to GitHub, import to Vercel.
The app also runs fine with no keys at all — local-only mode.

## Layout

```
index.html           app shell, all screens
privacy.html         privacy policy (required by Play)
live.html             spectator view
app.js                navigation, screens, persistence
engine.js             cricket rules        (pure, testable)
tournament.js         fixtures, NRR, table (pure, testable)
social.js             friends, clubs, organiser applications (pure, testable)
avatars.js            12 bundled SVG avatars + brand mark
stats.js              career records      (pure, testable)
cloud.js              Supabase layer (no-ops when unconfigured)
supabase-config.js    <- your project URL + anon key go here
supabase.sql          run in the Supabase SQL Editor: schema + RLS policies
firestore.rules       superseded — old Firebase rules, kept for reference only
sw.js                  offline caching
```
