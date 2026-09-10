# CricketConnect — Local Cricket Discovery & Match Network

Phase completion report. Builds on Ground Location Foundation and Nearby Grounds & Maps — verified against the real, currently-installed code, not assumed from either previous report.

**Before touching anything new, this phase found and fixed two real bugs in the previous phase's own delivered code.** Both are covered in full in §A below because they changed what "before" actually meant.

---

## A. BEFORE

What the previous report *said* was built and what was actually reachable turned out to be two different things:

1. **`live_matches.ground_id` was never populated.** The column has existed since Ground Location Foundation, but `writeLive()` — the one function that actually writes a live match to the database — never included it in the row it upserts. Every live match's `ground_id` was silently `null`, forever. Any "live matches at this ground" query, this phase's or a future one's, could never have found anything.
2. **Six functions used throughout the Nearby Grounds screen were never imported.** `fetchGroundsNear`, `fetchGroundCountries`, `fetchGroundCities`, `fetchGroundsByFilter`, `fetchUpcomingFixturesForGrounds`, and `fetchGroundTournaments` are all called from `app.js`, but none of them were in the `import { ... } from './cloud.js'` block. `node --check` — the syntax check this project has relied on for verification when no live database or browser is available — cannot catch this class of bug: an unimported identifier is valid JavaScript syntax, and only throws `ReferenceError` when that exact line actually executes. Practically, this meant the Cricket Near You screen delivered last phase would have failed the instant a user did anything on it — search, location, radius, all of it.

A third, unrelated pre-existing bug from an earlier phase (`grantTournamentRole`, used in tournament role management, also never imported) was caught by the same audit and fixed as a drive-by correction — not part of this phase's scope, but cheap and safe to fix once found.

All three are fixed now (§E). This is the honest reason a systematic "is everything actually imported" pass is now part of how this project verifies JS changes going forward, alongside `node --check` — see §I.

With those fixed, what actually existed going into this phase: a Cricket Near You screen with one-shot GPS, a Leaflet/OSM map, ground search/filter/sort, and a basic "Matches Near You" list — plus the live-scoring system, the tournament system, and the notification system, all working independently of each other and of Cricket Near You.

## B. AFTER

Cricket Near You is now a real discovery feed, sectioned by priority exactly as the brief's own mockup lays out — live, then upcoming, then tournaments, then grounds, then teams:

- **🔴 Live Near You** — real live matches at nearby grounds, reusing the exact same card (`homeLiveCardHTML`) already shown on Home and Live Now: real team names, real scores, real overs, a live realtime subscription so it updates without a manual refresh. Tapping a card opens the same `live.html?m=<id>` page that's always been the sharing/deep-link target for a live match.
- **📅 Upcoming Near You** — unchanged data (tournament + ground + when; see §G for why not team names), now with a Today/Tomorrow/This Week/Weekend date filter.
- **🏆 Tournaments Near You** — real tournament name/status/start date, real team count (from the roster table), real upcoming-match count (from data already fetched, not a second query).
- **🏏 Grounds Near You** — the previous phase's ground list, now annotated with real live/today/this-week activity counts and a 🔥 Active badge (rule: a live match always qualifies, otherwise at least 3 matches in the coming week — see §C).
- **👥 Active Teams Near You** — team names currently playing live nearby.
- **Near Me / 🌍 City / 🔎 Search** mode toggle, replacing the previous phase's implicit mode switching with an explicit one (brief section 4).
- **Distance filter widened** from 25/50 km to 5/10/25/50 km (brief section 6).
- **Sort widened** to Nearest, Live Now, Starting Soon, Most Active, Newest, A–Z — all six now backed by genuinely distinct real data (see §C for why this wasn't possible last phase).
- **Unified search** — typing in the search box now also searches tournament names and team names, not just grounds, shown in their own sections.
- A small **in-screen toast** ("🏏 A live match just started near you") when a new live match appears while the screen is already open — see §H for why this was chosen over automated push notifications.

## C. DATABASE

**No new tables or columns.** One critical *data-population* fix: `writeLive()` (in `cloud.js`) now writes `ground_id: m.groundId || null` into every `live_matches` upsert — the column already existed, nothing was migrated, but it will only start actually holding values going forward (existing already-live matches from before this fix won't retroactively gain a ground_id; that's expected and harmless, they simply won't appear in "Live Near You" until the next time they're scored).

This fix is also what makes "Most Active" a real, distinct sort option for the first time: the previous phase's report explicitly said Most Active and Upcoming Matches would be identical without a second real signal, and deliberately shipped only three honest sort options rather than fake a fourth. Live match presence is that second signal — now that it's real and reliable, this phase ships five real, distinct sort criteria instead of three.

No new indexes needed: `live_matches.ground_id`'s existing partial index (`where ground_id is not null`, added last phase) already covers the new `fetchLiveMatchesForGrounds()` query; `tournament_teams.tournament_id` and `tournaments.ground_id` are both already indexed from earlier phases.

**Still true from both previous reports**: `supabase_ground_location_migration.sql` has not been confirmed run against the live Supabase project. Nothing in any of the three location/discovery phases — including everything in this report — works until it is.

## D. UI

New/changed screens and components, all inside the existing SPA (`go('nearby')` + `renderNearby()`, no new routing system):

- `#screen-nearby` reorganized into six ordered cards (mode/search/filters, map, Live, Upcoming, Tournaments, Grounds, Teams) plus two more for unified-search-mode results (Tournaments/Teams categories).
- `homeLiveCardHTML(r, extra)` — extended with an optional second parameter for a distance note. Every existing call site (Home's Live Matches rail) passes nothing and renders byte-for-byte as before; only the new Live Near You section passes real distance data.
- New CSS: none needed beyond what the previous phase already added for the map/markers — every new element here reuses existing classes (`.card`, `.pill`, `.list-pick`, `.tour-card`, `.live-now-stack`, `.roster-chip`, `.stat-dim`).

## E. SEARCH

Extended from ground-only to three parallel database searches (brief section 22, "no AI, database search first"): `searchGrounds` (existing, unchanged), `searchTournamentsByName` (new — public tournaments, name match), `searchTeamsByName` (new — `tournament_teams` name match, restricted to teams whose tournament is public via a real foreign-key-based embedded filter). All three run in one `Promise.all`, one round trip each.

## F. LOCATION

Unchanged mechanism from last phase (one-shot `getCurrentPosition`, never `watchPosition`, never persisted) — this phase's addition is purely how it's *presented*: an explicit Near Me / City / Search toggle (brief section 4) instead of the previous implicit mode-switching, so a user can deliberately browse another city or country without ever being asked for GPS permission at all (brief section 5 — "a user in London should be able to search 'Lahore cricket'").

## G. TIMEZONE

No changes — `fmtWhen(iso, tz)` from the previous phase already does exactly what brief section 15 asks (venue-local time, with a zone abbreviation only when it differs from the viewer's own), and every new list in this phase (Upcoming, Live via `homeLiveCardHTML`) calls it with the ground's real `timezone`. The optional "and your local time too" second line from the brief's example was left out — the brief itself marks it optional, and adding a second time to every compact list row would work against the same brief's own repeated "don't overload the screen" instruction.

**Team names — investigated properly this time, not just cautiously skipped.** The previous phase's report skipped resolving `fixtures.team_a_id`/`team_b_id` to real names and called it a complexity risk. This phase actually traced the trigger that populates that table (`sync_fixtures_from_tournament()` in `supabase.sql`) and confirmed why: those ids come straight from each tournament's own JSONB `data.fixtures[]`/`data.knockout[]` array, scoped to that tournament's own internal team representation — not `tournament_teams.id`, which is a separate table with its own uuids, only linked via an optional, not-always-populated `local_team_id` pointer. Resolving a name correctly would mean querying every distinct tournament's own roster individually, and would show nothing (or, worse, a mismatched name) for any tournament that never used the optional roster feature. That's a real rebuild of match-data plumbing, which the brief explicitly says not to take on — so the Upcoming section still shows tournament + ground + time, not team names, and that's a confirmed constraint now, not an assumption.

Live matches don't have this problem at all: `live_matches.data.teamA`/`teamB` are plain strings (the live-scoring engine's own match model has always used names directly, never ids), so Live Near You and Active Teams Near You show 100% real, reliable team names with zero resolution risk.

## H. NOTIFICATIONS

Inspected the real, existing system before deciding anything: `notifications`/`notification_recipients`/`notification_devices` tables, a full `cloud.js` service layer, an Edge Function send pipeline, and — critically — `notifyMatchStarted()`/`notifyMatchCompleted()` already exist, already work, and are already wired at real call sites, gated behind a single flag: `const AUTO_CRICKET_NOTIFICATIONS = false;`. The code's own comment explains why: there is no "match followers" or "tournament subscribers" table, so firing either automatically today could only legitimately target `audienceType: 'all'` — a push notification to every user for every casual match anyone scores. That's exactly the anti-spam trap this brief's own section 24 warns about.

Building a *safe* automatic trigger would mean one of: (a) a real audience-resolution mechanism — matching a live match's ground city/country against opted-in users' profile region/district, server-side, plus a new opt-in preference column — or (b) the followers/subscribers table the existing comment already identifies as the real fix. Either is genuine new infrastructure, not "integrating carefully" into what exists — and flipping the flag without first making that audience decision is exactly what the existing code's own comment says not to do.

**What this phase actually built instead**: a small, zero-risk, in-screen-only toast — "🏏 A live match just started near you" — that fires from the realtime subscription already powering Live Near You, only while a user already has that screen open, using data they already legitimately fetched for it. No new table, no new audience resolution, no push, no background delivery, nothing that could ever reach a user who isn't already looking at the screen. This satisfies the brief's underlying intent (surface live nearby activity) without the spam/privacy risk a real push implementation would carry unfinished. Recommended as the next phase's most natural piece of new infrastructure — see §K.

## I. SECURITY

No RLS changes. Every new query reuses an existing, already-reviewed policy: `live_matches` (`using (true)`, same as `live.html`/Live Now), `tournaments` (`is_public = true`, same as `fetchPublicTournaments`), `tournament_teams` (restricted via the real `tournaments!inner(is_public)` embedded filter — a team can only be found through discovery search if its tournament is public). No private match, tournament, or team data is exposed by anything added this phase.

**Process finding, not a schema finding**: the missing-import bugs in §A were a real gap in this project's own verification process — `node --check` alone cannot catch them. A full "every used identifier is actually imported" audit (a small Python script cross-referencing every `export` in `cloud.js` against every call site and every import in `app.js`) is now part of how this phase verified its own new code, and caught both the pre-existing bugs and confirmed zero new ones were introduced this phase.

## J. PERFORMANCE

No live database or device available in this sandbox, so — as both previous reports also disclosed — no query time, realtime-latency, or render time is claimed as measured, because none was. What can be said from the design: the whole discovery feed for a set of nearby grounds costs exactly four queries (fixtures, live matches, tournaments, team counts — all batched by ground/tournament id, no N+1), unified search costs three parallel queries, and the realtime subscription for Live Near You re-fetches only the live-matches query on change, not the whole feed. Real measurement remains outstanding.

## K. TESTS

No live database or device in this sandbox. Reflects what was actually verifiable here.

| # | Test | Status |
|---|---|---|
| 1 | Location allowed → nearby matches appear | BUILT — NOT LIVE-DB TESTED. Code path traced end to end; blocked in practice until now by the ground_id bug in §A, now fixed. |
| 2 | Location denied → city search works | PASS (unchanged mechanism from last phase, still traced correct). |
| 3 | Live match nearby → appears first | PASS by construction — Live Near You is the first card in `#screen-nearby`, rendered before Upcoming/Tournaments/Grounds. |
| 4 | Upcoming match → appears correctly | BUILT — NOT LIVE-DB TESTED. |
| 5 | Tournament nearby → appears | BUILT — NOT LIVE-DB TESTED. New `fetchTournamentsForGrounds` path. |
| 6 | Private match not publicly displayed | PASS by construction — Live Near You reads `live_matches` (`using(true)` was always the intended public-read policy) and Upcoming/Tournaments both filter `is_public`/RLS exactly as `fetchPublicTournaments` already does; nothing new bypasses either. |
| 7 | Different country → discovery works | PASS (unchanged from last phase — no hardcoded country anywhere, re-verified). |
| 8 | Different timezone → official time correct | PASS (unchanged `fmtWhen`, re-verified against the new Upcoming/Live call sites). |
| 9 | No nearby cricket → useful empty state | BUILT — NOT LIVE-DB TESTED. Every new section (Live/Tournaments/Teams) hides itself entirely when empty rather than showing a placeholder; Grounds/Upcoming keep their existing empty-state copy. |
| 10 | Search team → correct results | BUILT — NOT LIVE-DB TESTED. New `searchTeamsByName`. |
| 11 | Search ground → correct results | PASS (unchanged `searchGrounds`). |
| 12 | Search tournament → correct results | BUILT — NOT LIVE-DB TESTED. New `searchTournamentsByName`. |
| 13 | Many matches → pagination/performance OK | Not device-testable here; every new query is limited (30–200 rows) and batched, no unbounded fetch. |
| 14 | Live scoring unaffected | PASS. `engine.js` untouched; `run-tests.mjs` 252/0. |
| 15 | Recording unaffected | Not device-testable; no recording file touched, confirmed by own edit history. |
| 16 | Compositor unaffected | Same as #15 — untouched, not device-tested. |

## L. REGRESSION

`node run-tests.mjs`: **252 passed, 0 failed** — unchanged from both previous phases' baseline. `node --check` clean on `app.js`, `cloud.js`, `engine.js`. HTML tag-balance check on `index.html`: 0 errors. The full used-vs-imported audit described in §A/§I: 0 missing imports remaining, across all 138 of `cloud.js`'s exports.

Confirmed untouched this phase (direct review of every edit made): `engine.js`, `tournament.js`, `AndroidManifest.xml`, everything under `cricket-connect-capacitor/native-src/`, every Java overlay file, `recorder.js`, `overlays.js`, `broadcast-events.js`, `capacitor.config.json`, all of `cricket-connect-android/` (the TWA). Scoring, recording, camera, and compositor could not be regression-tested live (no Android device/emulator here) — same honest gap as both previous phases, mitigated by nothing they depend on having been touched.

## M. NEXT RECOMMENDATION

Same two items block everything from actually running, now carried across three phases:

1. **Run `supabase_ground_location_migration.sql`** against the live Supabase project.
2. **Clear the two stale git lock files** (`legacy-app/.git/HEAD.lock`, `.git/index.lock`) on your own machine — confirmed still present, still `Operation not permitted` from this sandbox. All five files this phase touched, plus the still-uncommitted work from both previous phases, are sitting uncommitted:
   ```
   cd legacy-app
   git add app.js cloud.js engine.js index.html styles.css supabase_ground_location_migration.sql
   git commit -m "feat: cricket ground location foundation + nearby grounds and map discovery + local cricket discovery"
   ```

For the next actual feature phase: **real proximity-based push notifications** is the most natural continuation of what's already built (§H spells out exactly what's needed — a real audience-resolution mechanism, either region-matching or a followers table, plus a genuine opt-in preference — this phase deliberately did not build either). After that, a **"Following"** system (teams/tournaments/grounds) is the next brief's own suggestion (section 26) for prioritizing discovery around what a signed-in user actually cares about, rather than pure proximity.
