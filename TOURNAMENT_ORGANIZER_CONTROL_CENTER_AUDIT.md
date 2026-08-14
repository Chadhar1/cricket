# CricketConnect — Tournament Organizer Control Center
## Phase 1: Codebase Audit & Implementation Plan

*Audit-only deliverable. No code has been changed. Written against the live repo at `legacy-app/` (commit history through the notification-system + Google OAuth fixes).*

---

## 1. Current architecture

CricketConnect is a single-page vanilla JS/HTML/CSS PWA — no framework, no build step, no bundler. Everything lives in a handful of top-level files served as-is:

- `app.js` (~5,000 lines) — all UI: screen rendering, event delegation via `data-action` attributes, a single `render()`/`go(screen)` router now backed by the History API.
- `cloud.js` (~1,190 lines) — the entire Supabase client layer: auth, every table read/write, RPC calls, realtime subscriptions. Nothing else talks to Supabase directly.
- `engine.js` (566 lines) — pure scoring engine (balls, overs, wickets, extras, free hits). No DOM, no network, fully unit-tested (252/252 passing).
- `tournament.js` (348 lines) — pure tournament logic: fixture generation, points table, NRR, knockout bracket. Also no DOM/network.
- `social.js` (406 lines) — mostly legacy: handle validation is live and used; the rest of its header comment describes a **pre-Supabase Firestore data model** (`clubs`, `leagues/roster`, captain locks) that was never built in Postgres and does not exist today. Treat that comment as historical, not current architecture.
- `stats.js`, `avatars.js` — small pure helpers.
- `index.html` / `live.html` / `player.html` / `privacy.html` — the four real pages. `index.html` is the app shell (all screens are `<div id="screen-*">` blocks toggled by `render()`); `live.html` is the no-login spectator view; `player.html` is the no-login public profile.
- `supabase.sql` — the entire schema + RLS, hand-written, idempotent (safe to re-run).
- `supabase/functions/` — two Edge Functions (`send-notification`, `dispatch-scheduled`) for the push-notification pipeline, deployed via Supabase CLI.
- Backend: Supabase (Postgres + Auth + Realtime + RLS + Edge Functions). No custom server. Deployed on Vercel as a static site.

There is no component framework and no per-feature module boundary beyond the files above — `app.js` is genuinely one large file with all screens' logic in it. That is the biggest structural fact for this project: **anything new has to fit into that same single-file pattern or it will look inconsistent with the rest of the app.**

## 2. Existing relevant DB tables

| Table | Shape | Notes |
|---|---|---|
| `admins` | `uid` only | Platform-wide allowlist. Not writable via API — SQL-editor only. This is the **only** role table that exists. |
| `profiles` | one row per user | `is_admin`, `is_organiser` booleans; `handle`, location text fields (`country/region/district/area` — free text, **no lat/lng, no geocoding**); `points`/`streak_*` gamification. |
| `tournaments` | one row per tournament, `user_id`-owned | Scalar columns (`name`, `location`, `ground`, `start_date`, `end_date`, `status`, `is_public`, ...) promoted out of a `data` JSONB blob that still holds the full nested object: `teams: [{id,name}]`, `fixtures: [...]`, `knockout: [...]`. **Teams are `{id, name}` — not linked to any user account.** |
| `teams` | one row per saved team, `user_id`-owned | `data` JSONB holds `{ name, players: [string, ...] }` — roster is a **plain array of name strings**, matched into tournaments by name string, not id or account. |
| `matches` | one row per match, `user_id`-owned | `data` JSONB is the full `engine.js` match object; `cancelled` is the one promoted column (admin moderation). Optional `data.tournamentId` / `data.fixtureId` link a match back to a tournament fixture. |
| `events` | one row per scheduled event, `user_id`-owned | Same shape as the above three. |
| `live_matches` | public-read, owner-write | Live score broadcast row; `location` column added for the "Live Now" feature. |
| `organiser_applications` | one row per application | `pending/approved/rejected`; approval is a `SECURITY DEFINER` function that flips `profiles.is_organiser`. This is the **entire** onboarding flow for becoming an organiser today — a single global flag, not a per-tournament role. |
| `feedback` | user-submitted, admin-reviewed | Unrelated to tournaments, listed for completeness. |
| `notification_templates` / `notifications` / `notification_recipients` / `notification_devices` | full push pipeline | Audience types today: `all / players / organisers / country / city / selected / user` — all resolved from real `profiles` columns. **No `team` or `tournament` audience type exists**, because there is no table that links a real user to a specific team or tournament (see §9). |
| `connections` | friend graph | Two-member array, `pending/accepted/declined`, has its own `respond_to_connection()` RPC. Real and in use. |

Tables named in `social.js`'s header comment (`clubs`, `leagues`, `handles`, `chats`, `reports`) **do not exist in Postgres** — only `connections`, `organiser_applications`, and `admins` from that old design actually got built.

## 3. Existing relationships

- `profiles.id` = `auth.users.id` (1:1, Supabase Auth is the identity source).
- `tournaments.user_id` → `auth.users.id`: **single owner, full stop.** No co-owner, no manager, no secondary write access of any kind.
- `tournaments.data.teams[].id` is a **local, tournament-scoped id** — it does not reference `teams.id` or any `profiles.id`. A team inside a tournament is just a name string with a generated id; it may or may not correspond to a saved `teams` row, and even when it does, the link is a case-insensitive **name match** (`rosterFor()` in `app.js`), not a foreign key.
- `teams.data.players` is an array of plain strings (player names). **No row anywhere links a roster entry to a real `profiles.id`.** This is the load-bearing fact for the whole brief: "captain approval," "player accepts squad invite," "verified account linked to roster slot" all require a table that does not exist yet.
- `matches.data.tournamentId` / `.fixtureId` are the only pointers from a match back into a tournament's fixture list; they're plain strings inside JSONB, not FK-enforced.
- `organiser_applications.uid` → `auth.users.id`, and approval mutates `profiles.is_organiser` — a **platform-wide** flag, not scoped to any tournament.

## 4. Existing authentication / authorization

Two-tier, both global, both boolean:

1. **`profiles.is_admin`** — checked via `public.is_admin()` (a `SECURITY DEFINER` SQL function reading the `admins` allowlist table). Used throughout `supabase.sql`'s RLS policies and in every admin-only RPC (`admin_cancel_tournament`, `admin_cancel_match`, `approve_organiser_application`, notification sends, etc.).
2. **`profiles.is_organiser`** — a boolean anyone can be granted (by an admin approving their application). It currently gates almost nothing server-side beyond the notification audience filter (`'organisers'`) — the actual permission to create/edit a tournament is just **"you're signed in, and it's your own `user_id`"**, via the shared `"owner has full access"` RLS policy that `matches/teams/tournaments/events` all share.

There is **no concept of a role scoped to a single tournament.** Nothing like `tournament_owner`, `tournament_manager`, `scorer`, `umpire`, `team_captain` exists in the schema, in RLS, or in the frontend. `app.js`'s `isTourOwner(t)` is a client-side convenience check (local list membership or `ownerId === auth uid`) that mirrors — but does not replace — the RLS boundary; the real enforcement is entirely "does `auth.uid()` equal this row's `user_id`."

Every mutating RLS policy on `tournaments`/`matches`/`teams`/`events` is single-owner: `using (user_id = auth.uid())`. Admins get **read-only** platform-wide access via a separate `"admin can read all rows"` policy — they cannot write into someone else's tournament except through the two narrow `SECURITY DEFINER` moderation functions (`admin_cancel_tournament`, `admin_cancel_match`), which only ever flip a status flag.

## 5. Existing tournament workflow

1. Owner fills in `openNewTournamentModal()` → picks/creates teams (name strings) → `createTournamentFromForm()` builds the object via `tournament.js`'s `createTournament()`, generates round-robin fixtures, saves locally (IndexedDB/localStorage-backed `tournaments` array) and, if signed in, to Supabase (`saveTournament`).
2. Viewing: `openTournamentView(id)` — synchronous if it's the owner's own local copy; otherwise a read-only `fetchTournamentById()` fetch, gated entirely by RLS (`is_public = true`, or owner, or admin).
3. `isTourOwner(t)` decides whether the "manage" affordances (Play, Regenerate, Generate Knockout, Delete, set fixture date) render at all. There is exactly one tier: owner or not-owner. A not-owner sees a fully read-only tournament page (table, fixtures, knockout, teams, rules, organizer card).
4. Playing a fixture: owner taps **Play** on a fixture → `playFixture()` pre-fills the normal match-setup screen with `{teamA, teamB, tournamentId, fixtureId}` → the match is scored through the **exact same single-device scoring flow as any standalone match** — there is no "assign a scorer/umpire" step, no handoff to another account. Whoever owns the tournament (or is physically holding their signed-in device) scores it.
5. On completion, `resultFromMatch()` converts the finished `engine.js` match into a fixture result, and `applyResult(t, f.id, result, m.id)` writes it back into the tournament's `fixtures`/`knockout` array, which is then persisted via `saveTournament(t)`. Standings/NRR/knockout advancement are all derived, pure functions (`computeStandings`, `advanceKnockout`) — no stored aggregate to drift out of sync.
6. Becoming an organiser at all: submit `organiser_applications` → admin approves/rejects from the admin dashboard → `profiles.is_organiser` flips. This is a **platform-wide**, one-time gate, unrelated to any specific tournament.

## 6. Existing live scoring workflow

- A match is a single `matches` row (`data` = the full `engine.js` state machine: innings, overs, balls, wickets, extras, free-hit tracking). Only the `user_id` owner can write to it (owner-only RLS, shared with the other private tables).
- Optional live sharing: `pushLive(match)` / `pushLiveNow` writes a mirrored row into `live_matches` (public-read, owner-write), which `live.html` and the "Live Now" public list subscribe to via Supabase Realtime.
- `engine.js` itself has zero concept of who is allowed to score — that boundary is entirely "whose Supabase session is this," enforced by RLS on the `matches`/`live_matches` tables, one level up in `cloud.js`/`app.js`.
- Match cancellation is the one admin-only write path into another user's match (`admin_cancel_match`, a `SECURITY DEFINER` RPC that also tears down any active `live_matches` row).

**There is no "assign an official scorer" concept anywhere in the current system.** Today, if a tournament owner wants someone else to score a match, that person would have to be handed the owner's own device/session — there's no delegated, audited, per-match scoring permission.

## 7. What can be reused as-is

- **Fixture/points/NRR/knockout engine** (`tournament.js`) — pure, tested, format-agnostic. Nothing about adding roles changes how a league table or bracket is computed; this stays untouched.
- **`engine.js`** — the scoring state machine has no auth logic baked in; a permission layer sits entirely above it. No changes needed to add scorer assignment.
- **Notification pipeline** (templates, `notifications`/`notification_recipients`/`notification_devices`, the two Edge Functions, `resolveAudience()`/`resolve_notification_audience()`) — real, deployed, tested. Adding a `tournament_participants`-style audience type is additive (one more `case` in two places, per the existing pattern already used for `country`/`city`), not a rebuild.
- **Admin dashboard shell** (`renderAdmin()`, the tab-visibility pattern, the `adminLoadError`/retry pattern just hardened for notifications) — the same section/tab structure is the natural home for a Platform Admin's cross-tournament oversight view.
- **`SECURITY DEFINER` moderation-function pattern** (`admin_cancel_tournament`, `admin_cancel_match`, `approve_organiser_application`) — this is exactly the right shape to extend for "assign role," "approve roster," "resolve dispute": a narrow function that re-checks authorization itself and only ever touches the fields it's meant to.
- **`organiser_applications` → admin approval → profile flag** pattern — directly reusable as the template for tournament-scoped role grants, just parameterized by `tournament_id` instead of being platform-wide.
- **History-API router / `go()`** — new organizer screens are just more `screen-*` blocks and `go()` targets, consistent with everything else.
- **`is_public` + owner + admin RLS pattern** on `tournaments` — the right template to extend to a real per-tournament role table (see below), rather than inventing a new authorization mechanism.

## 8. What needs to be added

This is the large part, because **today's schema has no per-tournament role concept at all** — everything the brief asks for sits on top of ground that doesn't exist yet:

1. **A `tournament_roles` (or similarly named) table** — `(tournament_id, user_id, role, status, granted_by, granted_at)` with `role in ('owner','manager','scorer','official')` (captain is arguably roster-scoped, not tournament-scoped — see #2). This is the single foundational piece everything else depends on. RLS on `tournaments`/fixtures/etc. needs to grow from `user_id = auth.uid()` to `exists(select 1 from tournament_roles where tournament_id = … and user_id = auth.uid() and role in (…))`, mirroring the existing `is_admin()` helper-function pattern.
2. **Real, account-linked rosters** — `tournament_teams` (finally building the table `tournament.js`'s own comments have flagged as deliberately deferred since Task 5) plus a `tournament_team_players` join table with `(team_id, user_id, status: invited|accepted|declined, is_captain)`. Without this, "captain approval," "player accepts squad invite," and "team members" as a notification audience are all impossible — they need a real user id per roster slot, not a name string.
3. **Fixtures as rows, not JSONB array entries** — needed the moment a scorer/official is assigned per-fixture (you need something to attach `assigned_scorer_uid` to), and for any cross-tournament fixture browsing. `tournament.js`'s existing `fixture` shape maps over almost 1:1; this is a normalization migration, not a redesign.
4. **A real geo-search capability** for "nearby player discovery by physical distance." `profiles` has no coordinates today, only free-text `country/region/district/area`. This needs new `lat`/`lng` columns (user-permissioned, likely never-required, opt-in given privacy sensitivity), plus either PostGIS or a bounding-box + haversine approach in a Postgres function. This is a genuinely new capability, not an extension of anything existing.
5. **An audit log table** (`tournament_audit_log` or platform-wide `audit_log`) for role changes, score corrections, dispute resolutions, emergency actions — nothing like this exists today (admin actions currently aren't logged anywhere, not even the two existing `admin_cancel_*` RPCs).
6. **A score-correction path with a trail** — right now a match's `data` JSONB can only be overwritten wholesale by its owner; there's no concept of "official corrects a submitted score, with before/after and reason recorded."
7. **Dispute records** — a new table entirely; nothing adjacent exists.
8. **Sponsor records** — a new table entirely (likely just `tournament_sponsors: (tournament_id, name, logo_url, tier, link)`), independent of the role work, low risk.
9. **Tournament-scoped notification audience types** — `team_members`, `tournament_participants`, `officials` — additive once #1/#2 exist (same pattern as the existing `country`/`city` cases in `resolve_notification_audience()` / `resolveAudience()`).
10. **Completion/verification + immutable locking** — a `verified_at`/`locked_at` pair on `tournaments`, plus RLS/RPC changes so a "completed and verified" tournament's fixtures/results become read-only even to the owner (currently `saveTournament()` lets the owner overwrite anything, anytime, forever — there is no concept of a tournament ever becoming immutable).
11. **Organiser reputation / "N verified tournaments" counter** — a derived stat (`count of tournaments where status='completed' and verified=true and organiser=this user`), foundation-only per the brief; needs #10 to mean anything real.
12. **Emergency controls** (pause/lock/cancel) — `admin_cancel_tournament` already proves the pattern for "cancel"; "pause" and "lock" are new status values / new RPCs of the same shape.

## 9. Potential risks of modifying the existing system

- **RLS regression is the single biggest risk.** `matches`/`teams`/`tournaments`/`events` currently share one `do $$ … foreach t in array [...] $$` block that generates identical owner-only policies for all four tables. Introducing a `tournament_roles`-aware policy on `tournaments` alone (without touching `matches`/`teams`/`events`) is safe; **rewriting the shared loop itself is not** — a mistake there silently changes authorization on all four tables at once. The new policies must be added as tournament-specific, not by editing the shared generator.
- **Tournament ownership semantics change under load-bearing code.** `isTourOwner()` in `app.js` is checked in ~10 places (`playFixture`, `saveFixtureDate`, `genKnockout`, `regenFixtures`, `removeTournament`, tab rendering, menu visibility). Widening "owner" to "owner or manager or scorer" needs every one of those call sites reviewed individually — a blanket find/replace would likely over-grant (e.g. letting a scorer delete the whole tournament).
- **`data.teams[].id` is not a stable, portable identifier today.** Any migration that introduces `tournament_teams` as a real table needs a backfill strategy for every existing tournament's JSONB teams array — get the id mapping wrong and historical fixtures (`fixture.teamAId`/`teamBId`, which reference these same local ids) silently break, showing "TBD v TBD" on old tournaments.
- **Free-text roster → real accounts is a breaking UX change, not just a schema change**, unless it's built as strictly additive (existing name-string rosters keep working for tournaments that never opt into account-linked rosters; new tournaments/teams can opt in to the linked flow). Forcing every existing team's plain-string roster to suddenly require real accounts would strand any organiser whose players don't have (or want) app accounts — cricket organisers frequently manage players who will never sign up.
- **Notification volume.** New tournament-scoped audience types (`team_members`, `officials`) sit on the existing FCM pipeline, which already has concurrency capping (25 at a time) — fine — but event-based auto-notifications (fixture reminders, score corrections, dispute updates) firing per-tournament-action for large tournaments could scale notification volume faster than the current admin-manual-send model was designed for. The brief's own `AUTO_CRICKET_NOTIFICATIONS = false` flag (added in the last project) exists for exactly this reason — new automated triggers should default off the same way.
- **Immutable/locked tournament state interacts with the existing "owner has full access" policy.** A locked tournament still needs `is_admin()` to retain override access (for dispute resolution after lock) but must stop the owner's own unconditional write path — this requires the RLS policy itself to check a `locked` flag, which is a behavioral change to a policy every other write already depends on. Needs careful, isolated testing against a tournament that's *not* locked to prove nothing regresses for the common case.
- **Edge Function / cron dependency already fragile in this project.** The two existing Edge Functions required a full manual CLI deployment walkthrough with the user (they weren't live until this session). Any new server-side logic for this feature (e.g., a scheduled "check for stale disputes" job) will have the same deployment gap — it needs to be flagged explicitly as a manual step, the same way `dispatch-scheduled`'s pg_cron block was left commented-out in `supabase.sql` rather than assumed to be running.
- **Scope size versus "don't break anything."** This brief's 46 sections describe what is realistically 8–12 separate schema migrations and a comparable number of new UI surfaces. Attempting it as one large migration raises real risk of an RLS mistake going unnoticed until a live tournament is affected. The phased plan below is written to keep every phase independently testable and revertible.

---

## 10. Implementation plan

Phased to match the brief's own structure, but sequenced so nothing later depends on a phase that hasn't shipped and been verified, and so every phase is a small, isolated, revertible migration rather than one large schema change.

**Phase 2 — Permission architecture (foundation)**
Add `tournament_roles` table + RLS helper function (`public.tournament_role(tournament_id, uid)`, mirroring `is_admin()`). Extend `tournaments` RLS additively (new policies alongside, not replacing, the existing owner policy). No UI yet — this phase is schema + a handful of `cloud.js` functions, fully testable against existing tournaments (every existing tournament's sole owner becomes its sole `'owner'` role row via a one-time backfill).

**Phase 3 — Organizer dashboard (read-first)**
A new screen surfaced only to users with any `tournament_roles` row: list of tournaments they have a role in, role badge, and — for owners only — the existing manage affordances now gated through the new role check instead of `isTourOwner()`. `isTourOwner()` is refactored to consult the role table but keeps its exact current call sites and true/false contract, so nothing downstream needs to change shape.

**Phase 4 — Tournament management extensions**
Manager role gets a defined, narrower permission set than owner (edit details, manage fixtures — not delete tournament, not transfer ownership). Pause/lock/cancel emergency controls added here as new status values + `SECURITY DEFINER` RPCs following the existing `admin_cancel_tournament` pattern.

**Phase 5 — Team & player management**
`tournament_teams` + `tournament_team_players` tables, invite/accept flow, captain flag. Built strictly additive: existing JSONB `teams` array keeps working unchanged for any tournament that doesn't opt in; new tournaments (or teams explicitly converted) get real account-linked rosters. This is the phase most likely to need a follow-up round of user testing given the backfill risk noted in §9.

**Phase 6 — Fixtures as rows**
Migrate `fixtures`/`knockout` out of the tournament's JSONB into a real `fixtures` table (id, tournament_id, teamA/teamB refs, status, result, `assigned_scorer_uid`, `assigned_official_uid`). `tournament.js`'s pure functions (`computeStandings`, `generateKnockout`, `advanceKnockout`, NRR) are reused unchanged — they operate on in-memory arrays regardless of where those arrays are loaded from, so this phase is a data-loading change, not a logic rewrite.

**Phase 7 — Officials & live scoring integration**
Scorer/official assignment per fixture; `matches` RLS widened (additively) so an assigned scorer can write to that specific match without being its `user_id` owner. Score-correction path + audit trail entries here, using the same `SECURITY DEFINER` narrow-function pattern as `admin_cancel_match`.

**Phase 8 — Communication**
New notification audience types (`team_members`, `tournament_participants`, `officials`) added to both `resolve_notification_audience()` and the Edge Function's `resolveAudience()` in lockstep (per the existing "keep both in sync" comment already in the code). Event-based triggers (fixture reminder, result posted, dispute update) added behind an explicit off-by-default flag, matching `AUTO_CRICKET_NOTIFICATIONS`.

**Phase 9 — Statistics & disputes**
Tournament stats reuse `stats.js`/existing aggregation, scoped by the new `fixtures`/`tournament_teams` tables. New `tournament_disputes` table + admin/organizer resolution UI.

**Phase 10 — Completion & verification**
`verified_at`/`locked_at` on tournaments, immutability enforcement in RLS (the highest-risk single change in this project per §9 — gets its own isolated test pass against a live, in-progress tournament before merging). Organiser reputation counter + "10 verified tournaments" eligibility flag as a read-only derived value; no reward logic itself, per the brief's "foundation only."

**Phase 11 — Security audit & regression**
Full pass: every RLS policy diffed against its pre-project version, every existing `isTourOwner()`/admin call site re-verified, full `run-tests.mjs` (currently 252/252) plus new tests for role-based scoring/fixture access, and a written report matching the format of the last two feature reports in this project.

Each phase above ships as its own commit (or small set of commits), is tested against the existing 252-test suite plus new phase-specific tests, and is safe to pause between — a partially-implemented phase never leaves existing single-owner tournaments in a broken state, because every schema change in this plan is additive (new tables, new policies alongside old ones) rather than a rewrite of what's there today.

**Recommended starting point:** Phase 2 only, reviewed and confirmed working (backfill verified, no existing tournament's behavior changed) before Phase 3 begins. Given the size of this project, it makes sense to check in after each phase rather than only at the end.
