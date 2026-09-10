# CricketConnect — Nearby Grounds, Maps & Location Discovery

Phase completion report. Everything below was verified against the real, currently-installed code — not assumed from the previous phase's own report.

All changes this phase are in `legacy-app/` only. Nothing in `cricket-connect-capacitor/` or `cricket-connect-android/` (the TWA) was touched: the map is a plain web library (Leaflet, loaded from a CDN) and location capture reuses the exact `navigator.geolocation` call and Android permissions already added in the Ground Location Foundation phase. No new native plugin, no new manifest permission.

---

## A. BEFORE

Ground Location Foundation gave CricketConnect a `grounds` table (name, lat/lng, address/city/country/timezone, verified/active), ground search by typed text, a ground-creation flow with one-shot GPS capture, ground linking on match/tournament creation, a Ground Detail screen (name, meta, upcoming-fixture count, tournament count, Directions/Share buttons — no map), and basic admin ground management (search/verify/deactivate/delete).

Two things existed that this phase had to account for before writing anything:

1. `fetchGroundsNear(lat, lng, radiusKm, limit)` already existed in `cloud.js` — built, correct, but explicitly commented as "deliberately unused by any screen this phase" and never called from `app.js`. This phase's job was largely to wire it up, not invent it.
2. A homepage card was **already titled "Cricket Near You"** (`renderCricketNearYou()` in `app.js`, task #128 from an earlier phase). It has nothing to do with grounds or GPS — it text-matches the signed-in user's profile region/district against public tournaments' free-text location field, and is explicitly documented as "never a browser location prompt." This predates the Ground entity entirely. The new brief's "Create: 🏏 CRICKET NEAR YOU" assumed this name was free — it wasn't, so this is a real naming collision I resolved (see §E).

## B. AFTER

A new **Cricket Near You** screen (`go('nearby')`), reached from a new "Cricket Near You" quick-action button on Home:

- **Location**: tapping "Allow Location" triggers the real one-shot `navigator.geolocation.getCurrentPosition()` (same call, same permission model as the ground picker's existing "Use My Current Location"). Denial/unavailability shows a specific message plus **Try Again** and **Search by City** — the feature never dead-ends.
- **Nearby search**: real ground coordinates via the existing `fetchGroundsNear()` (bounding-box query + Haversine, already indexed), radius pills for 25 km / 50 km, an "Expand to 50 km" empty-state fallback.
- **Map**: Leaflet + OpenStreetMap tiles (see §C), 🏏 markers per ground, 📍 for the user, tap-to-popup with a **View Ground** button, auto-fit to the current result set. Loads lazily — nothing added to the page for anyone who never opens this screen.
- **Text/city/country search**: `searchGrounds()` extended to also match address (it previously missed the one field brief §17 explicitly lists); new country → city filter dropdowns backed by two small distinct-value queries.
- **Sort**: Nearest, Upcoming Matches, A–Z. ("Most active" was deliberately not offered as a 4th, separate option — see §G for why.)
- **Matches Near You**: a real list of upcoming fixtures across the currently-shown grounds, one batched query, sorted by date.
- **Ground Detail**: now shows distance-away when arrived from a nearby search, a real "Upcoming Tournaments" list (name + real upcoming-match count + View Tournament), and each upcoming-match row now names its tournament instead of just a bare date.
- **Admin**: a **Check Duplicates** button per ground in the existing Grounds tab, reusing the exact duplicate-detection function built for ground creation.

## C. MAP PROVIDER

**Chosen: Leaflet.js + OpenStreetMap standard raster tiles. No API key.**

Evaluated against the brief's own criteria:

| | Google Maps JS API | Mapbox GL JS | Leaflet + OSM tiles |
|---|---|---|---|
| API key required | Yes, billing account mandatory from setup | Yes, credit card required from day one (confirmed via current pricing pages) | **No key at all** |
| Free tier (current, checked live) | Smaller free allotment, ~$7/1,000 loads after | 50,000 web map loads/month free, then $5/1,000 up to 200k | Free for normal interactive use — no load-based billing |
| Setup friction | Google Cloud project + billing | Mapbox account + card on file | `<script>`/`<link>` tag, nothing to provision |
| Key-exposure risk | Real — must restrict by domain/package | Real — same | **None — there is no secret to leak or restrict** |
| Licensing fit | General purpose | General purpose | Explicitly permits normal interactive viewport tile loading (checked OSM's current tile usage policy) — prohibits bulk/offline prefetching, which this app never does |

The brief was explicit: *"DO NOT blindly choose Google Maps"* and *"Never expose private API keys."* Both Google and Mapbox require a billing-backed API key that then has to be domain/package-restricted to be safe — real ongoing security surface for a project with no existing map-provider account. Leaflet + OSM eliminates that surface entirely: there is no key to restrict, rotate, or accidentally commit, and no billing account that could see a surprise invoice if usage spikes. At CricketConnect's real current scale (a niche cricket app, not a mapping product), OSM's own tile servers comfortably cover "load a handful of markers when someone taps Cricket Near You" — which is exactly the interactive, viewport-only usage their policy is written to allow.

**Trade-off, stated plainly**: OSM's tile servers are donation-funded and can rate-limit under heavy load, with no SLA. If CricketConnect's traffic grows enough that this becomes a real constraint, the fix is a one-line change — swap the `L.tileLayer()` URL in `ensureNearbyMap()` (`app.js`) for a paid OSM-compatible provider (Mapbox, MapTiler, Stadia Maps all work as drop-in tile URL replacements with Leaflet) — not a rewrite. This is called out again in §K.

**Security config**: none needed — there is no key. If a paid provider is adopted later, that provider's key must be restricted (HTTP referrer for web, package name + SHA-1 for Android) and read from an environment/config value, never hardcoded — the same discipline `supabase-config.js` already follows in this codebase.

Sources checked this session: OpenStreetMap Foundation's tile usage policy (operations.osmfoundation.org/policies/tiles), and current 2026 Mapbox pricing pages.

## D. DATABASE

**No new migration.** Checked the applied Ground Location Foundation schema before writing any query:

- `grounds_lat_lng_idx` (composite, partial `where latitude is not null`) — already covers the nearby bounding-box query.
- `grounds_city_idx`, `grounds_country_code_idx` — already cover city/country lookups.
- `fixtures_ground_id_idx`, `tournaments_ground_id_idx` (both partial, `where ground_id is not null`) — already cover the batched "fixtures/tournaments for these grounds" queries this phase adds.

Every new `cloud.js` query this phase runs against an index that already existed. The brief itself warns against adding database machinery "solely for theoretical future requirements" — there was no real need here, so nothing was added.

**Reminder carried over from last phase, still true**: `supabase_ground_location_migration.sql` has not been confirmed run against the live Supabase project (no DB credentials in this sandbox). Nothing in either phase's ground features — including everything in this report — works until it is.

## E. FILES

All paths under `legacy-app/`:

- **`cloud.js`** — extended `searchGrounds()` and `adminFetchGrounds()` to also match `address`; extended `fetchGroundUpcomingFixtures()` to embed the tournament name (PostgREST embedded resource over the existing `fixtures.tournament_id → tournaments.id` FK, no schema change); added `fetchGroundTournaments`, `fetchGroundCountries`, `fetchGroundCities`, `fetchGroundsByFilter`, `fetchUpcomingFixturesForGrounds`; updated the stale "deliberately unused" comment on `fetchGroundsNear` now that it's wired up.
- **`app.js`** — ~430 new lines: full Cricket Near You screen (state, location flow, search/sort/filter, Leaflet integration, list/matches/map rendering), `fmtDistance()`, Ground Detail extended (distance line, real tournaments list, tournament-named fixture rows), Admin Grounds extended (`adminGroundCheckDuplicates`), new quick-action entry point, ~7 new dispatcher branches, 3 new `bind()` listeners, `'nearby'` added to `SCREENS`/`TAB_OF`.
- **`index.html`** — new `#screen-nearby` static shell (search/filters/radius/sort controls, map container, list containers — static like `#screen-live-now`, not JS-owned innerHTML like `#screen-ground`, because it holds a persistent Leaflet instance); renamed the pre-existing homepage card's visible title from "Cricket Near You" to "Tournaments Near You" (§B/§below).
- **`styles.css`** — ~15 new lines: dark-theme overrides for Leaflet's popup chrome, a reset for the emoji marker icons.

Not touched this phase: `engine.js`, `AndroidManifest.xml`, anything under `cricket-connect-capacitor/native-src/`, any Java overlay file, `recorder.js`, `overlays.js`, `broadcast-events.js`, `tournament.js`, `capacitor.config.json`, `cricket-connect-android/`.

## F. LOCATION

Permission flow matches the brief exactly: screen opens → an in-app card explains *why* ("find nearby grounds") → **Allow Location** button → the real native/browser permission dialog fires only at that point (never on screen load, never pre-emptively) → on grant, coordinates are fetched once (`enableHighAccuracy:true, maximumAge:0`, no `watchPosition`, ever) → nearby search runs.

Denial or unavailability never breaks the screen: a specific message plus **Try Again** and **Search by City** stay available, and every filter/search path works with zero location permission at all.

**Privacy**: coordinates live only in a module-level JS variable (`nearbyCoords`), never written to `localStorage`, `sessionStorage`, or any database table or column. They're kept in memory across screen navigations within the same open tab purely so returning to the screen doesn't re-prompt GPS every visit — closing the tab/app clears them, same as any other in-memory variable, with nothing to explicitly "forget." No other user can ever see this location — it's never sent anywhere except as the two numbers passed straight into the existing `fetchGroundsNear()` call.

**Verified not present, per brief §29**: no live player maps, no player-location sharing, no friend tracking, no background location (`ACCESS_BACKGROUND_LOCATION` was never requested, same as last phase), no location history of any kind.

## G. SEARCH

**Nearby**: real coordinates only — `fetchGroundsNear()` does an indexed lat/lng bounding-box query, then Haversine over that small candidate set, filtered to the requested radius and sorted by distance. Grounds with no coordinates can never satisfy the bounding-box comparison, so they never appear (verified by the query's own logic, not a separate filter — Postgres `gte`/`lte` against a `null` column is never true).

**Text**: `searchGrounds()` now matches name, city, country, *and* address (address was the one field brief §17 asked for that the previous phase's implementation missed — fixed this phase).

**City/Country filter**: separate from text search on purpose — `fetchGroundsByFilter()` does exact `.eq()` matches on the real `country`/`city` columns, because a filter dropdown should show precisely what was picked, not a fuzzy `ilike` match that could pull in an unrelated same-named city elsewhere.

**International**: nothing in any query assumes a country — `fetchGroundCountries()` returns whatever countries actually exist in the table, alphabetically, with no hardcoded list.

**Sort — one honest simplification**: the brief lists Nearest / Most active / Upcoming Matches / Alphabetical as four options. With real data only (brief §21: *"Do not invent 'most popular' unless there is actual data supporting it"*), this app has exactly one genuine activity signal — real upcoming-fixture count — so "Most active" and "Upcoming Matches" would be the identical sort under honest data. Rather than fabricate a second, different-looking metric to fill out four options, this phase ships three: **Nearest, Upcoming Matches, A–Z**. Flagging this explicitly rather than silently dropping a brief item.

**Matches Near You**: shows tournament name + ground + distance + when, not team names. Fixtures store `team_a_id`/`team_b_id` as ids into each tournament's own roster; resolving those to display names across many different tournaments at once (a ground can host fixtures from several) would mean querying every one of those tournaments' rosters — real complexity for a "prepare the architecture, don't rebuild the match system" section of the brief. Tapping a row still reaches the real match via its ground.

## H. PERFORMANCE

No live Supabase connection and no browser/device in this sandbox — so, per the brief's own instruction ("do not claim performance numbers unless actually measured"), no query time, map-load time, or search latency is claimed as measured, because none was.

What can be said from the design itself: the nearby query hits an existing composite index rather than scanning the table; "Matches Near You" and per-ground activity counts share one batched fixtures query across every ground on screen instead of one query per ground (no N+1); the map library and its CSS load only the first time a user actually opens this screen, not on app boot, so nobody who never uses Cricket Near You pays anything for it; Leaflet keeps only the current result set's markers in its layer (cleared and rebuilt each search, not accumulated).

Real measurement — actual milliseconds against the live database and a real device/browser — is still outstanding, exactly like the previous phase's testing gap.

## I. TESTS

No live database connection and no browser/device available in this sandbox. Every item below reflects what was actually possible to verify here — syntax and structural checks, and reasoning from the code's own logic — not a live run. Using this project's established status vocabulary rather than overclaiming PASS.

| # | Test | Status |
|---|---|---|
| 1 | Location permission granted → nearby grounds appear | BUILT — NOT LIVE-DB/DEVICE TESTED. Code path traced end to end; `fetchGroundsNear()` itself is unchanged from the previous phase (already reviewed then). |
| 2 | Location permission denied → manual search remains available | BUILT — NOT DEVICE TESTED. `nearbyLocStatus === 'denied'` renders Try Again + Search by City; search/filter code paths don't touch `nearbyCoords` at all. |
| 3 | No nearby grounds → empty state | BUILT — NOT LIVE-DB TESTED. `renderNearbyList()`'s empty branch verified by reading, not by producing a real empty result set. |
| 4 | Ground marker tapped → Ground Detail opens | BUILT — NOT DEVICE TESTED. Marker popup button wired via Leaflet's `popupopen` event (deliberately not the app's document-level delegation — see the code comment on why that would silently fail) calling the same `openGroundView()` the list rows use. |
| 5 | Directions → external navigation opens | PASS (unchanged). This is the previous phase's `groundDirections()`, not touched this phase. |
| 6 | Search by ground name → correct results | BUILT — NOT LIVE-DB TESTED. `searchGrounds()` logic unchanged except the added `address` clause. |
| 7 | Search by city → correct results | BUILT — NOT LIVE-DB TESTED. New `fetchGroundsByFilter()`/city dropdown path. |
| 8 | International ground → correct country/timezone | PASS (unchanged). Timezone display (`fmtWhen`) and country storage are untouched from the previous phase, which already verified this. |
| 9 | Ground with no coordinates → excluded from nearby results | Verified by query logic (see §G) — not a live-data test, but a structural guarantee of how `.gte()/.lte()` against a null column behaves in Postgres. |
| 10 | Duplicate ground → warning shown | PASS for the existing creation-time flow (unchanged). New this phase: admin's **Check Duplicates** — BUILT — NOT LIVE-DB TESTED. |
| 11 | Many grounds → map stays responsive | Not device-testable here. Design mitigations in place (see §H); no live stress test performed. |
| 12 | No internet → graceful failure | BUILT — NOT DEVICE TESTED. Three independent failure paths, all handled: Supabase call failure (`runNearbySearch`'s try/catch → "Ground discovery is temporarily unavailable"), Leaflet CDN failure (`ensureLeafletLoaded`'s `script.onerror` → map card shows "Map could not be loaded," list still works), geolocation failure (existing `getCurrentPosition` error callback). |
| 13 | Existing match still works | PASS. `engine.js` untouched this phase; `run-tests.mjs` 252/0. |
| 14 | Existing tournament still works | PASS. `tournament.js` untouched; tournament creation/fixture flows untouched. |
| 15 | Live scoring still works | PASS. No scoring file touched. |
| 16 | Native camera still works | Not testable in this sandbox (no device). No camera-related file touched this phase — confirmed by own edit history, not by device test. |
| 17 | Native MP4 recording still works | Same as #16 — untouched, not device-tested. |
| 18 | Overlay/compositor still works | Same as #16 — untouched, not device-tested. |

## J. REGRESSION

`node run-tests.mjs`: **252 passed, 0 failed** — identical to the pre-phase baseline. `node --check` clean on `app.js`, `cloud.js`, `engine.js`. Custom HTML tag-balance check on `index.html`: 0 errors, 0 unclosed tags. `styles.css` brace count balanced (567/567).

Confirmed untouched this phase (by direct review of every edit made, not inference): `engine.js`, `tournament.js`, `AndroidManifest.xml`, everything under `cricket-connect-capacitor/native-src/`, every Java overlay file, `recorder.js`, `overlays.js`, `broadcast-events.js`, `capacitor.config.json`, all of `cricket-connect-android/` (the TWA).

Camera, native MP4 recording, and the overlay compositor could not be regression-tested live (no Android device/emulator in this sandbox) — carried over as an honest gap, same as last phase, mitigated by the fact that no file any of those systems depend on was touched.

## K. NEXT RECOMMENDATION

Two items outstanding from the *previous* phase still block everything, including this one, from actually running:

1. **Run `supabase_ground_location_migration.sql`** against the live Supabase project — still not confirmed done.
2. **Clear the two stale git lock files** (`legacy-app/.git/HEAD.lock`, `legacy-app/.git/index.lock`) on your own machine — still present, still block every commit from this sandbox (confirmed again this phase: `rm -f` fails with the same `Operation not permitted`). All five files this phase touched (`app.js`, `cloud.js`, `index.html`, `styles.css`, plus the still-uncommitted `engine.js` from last phase) are sitting uncommitted. Once the locks are cleared:
   ```
   cd legacy-app
   git add app.js cloud.js engine.js index.html styles.css supabase_ground_location_migration.sql
   git commit -m "feat: cricket ground location foundation + nearby grounds and map discovery"
   ```

For the actual next phase, per the brief's own explicit stop-list (booking, payments, player live location, reviews, ratings, marketplace, monetization, weather, AI recommendations all deliberately out): the most natural next step is **device/live testing of both location phases together** — running the migration, then actually opening Cricket Near You on a real phone with GPS, confirming the Leaflet map renders correctly inside the Capacitor WebView (should work unmodified, since it's plain web content, but "should" isn't "verified"), and checking OSM tile load times on a real mobile connection. That's verification of what's already built, not new scope — a lower-risk next step than starting a new feature area.

If a genuinely new feature phase is wanted after that, **Ground reviews/ratings** (explicitly deferred by this brief, not the one before) is the most natural continuation of what Ground Detail already shows — but that's a call for a future brief, not this one.
