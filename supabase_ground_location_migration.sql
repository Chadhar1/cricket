-- =============================================================================
-- GROUND LOCATION FOUNDATION
--
-- Turns "venue" from free text retyped per match into a real, reusable Ground
-- entity, plus the plumbing (nullable ground_id links, indexes) that future
-- phases (nearby grounds, embedded maps, discovery) will build on.
--
-- Read this against GROUND-ARCHITECTURE.md in cricket-connect-capacitor/ for
-- the full "why" behind every choice below. Summary of the constraints that
-- shaped this file:
--   - Purely additive. No existing table is dropped, renamed, or has a
--     column removed. Every existing venue/location/ground free-text column
--     is untouched and stays the source of truth for existing display code.
--   - `grounds` is the only new table. tournaments/fixtures/live_matches each
--     get one new nullable `ground_id` column, following the exact pattern
--     already used for `tournaments`' promoted columns (see supabase.sql's
--     "tournament architecture foundation" migration) and for `venue` itself
--     on `fixtures`.
--   - `matches` (standalone/friendly matches) deliberately gets NO schema
--     change — it has zero promoted columns today (saveMatchToCloud calls
--     saveRowIn with no `extra`), and a ground reference there lives inside
--     `data` (`data.groundId`), read the same way `data.tournamentId`
--     already is in fetchTournamentMatches(). An expression index below
--     keeps that queryable without touching the shared saveRowIn contract.
--   - No PostGIS, no map extension. Plain double precision lat/lng + a
--     partial index, per the brief's explicit "don't install machinery you
--     don't have a clear present use for."
--
-- Safe to run again: every statement is `if not exists` / `create or
-- replace` / drop-policy-then-create, the same convention as every other
-- file in this set (supabase.sql, supabase_phase8_10_migration.sql, etc.).
-- Run this whole file in the Supabase SQL Editor -> Run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- grounds
-- -----------------------------------------------------------------------------
create table if not exists public.grounds (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 120),
  -- Generated, not client-supplied: lower-cased, trimmed, internal whitespace
  -- collapsed to one space. "Model Town Ground" / "model town ground" /
  -- "  MODEL   TOWN GROUND  " all produce the same value, which is what
  -- makes search and duplicate detection (GROUND 7 / GROUND 16) possible.
  -- STORED + generated means it can never drift from `name`, even from a
  -- future direct SQL edit that forgets about it.
  normalized_name text generated always as (
    lower(trim(both ' ' from regexp_replace(name, '\s+', ' ', 'g')))
  ) stored,
  latitude        double precision check (latitude  is null or latitude  between -90  and 90),
  longitude       double precision check (longitude is null or longitude between -180 and 180),
  -- A ground with half a coordinate pair is worse than one with none — it
  -- would silently misplace on a map/distance calc instead of just being
  -- absent from one. Both or neither.
  constraint grounds_lat_lng_together check ((latitude is null) = (longitude is null)),
  address         text not null default '' check (char_length(address) <= 200),
  city            text not null default '' check (char_length(city) <= 100),   -- locality / town
  region          text not null default '' check (char_length(region) <= 100), -- state / province / emirate / county — provider-supplied text, same reasoning as profiles.region: no single hierarchy fits every country
  country         text not null default '' check (char_length(country) <= 100),
  country_code    char(2),                    -- ISO 3166-1 alpha-2 ("PK", "AE", "GB", ...) — nullable until geocoded/selected
  postal_code     text,
  timezone        text,                       -- IANA identifier ("Asia/Karachi") — nullable until known; GROUND 15 depends on this being set for correct match-time display
  place_id        text,                       -- geocoding provider's own reference — not populated this phase, reserved for a future refresh/dedupe pass
  image_url       text,                       -- not populated this phase — no Storage bucket is provisioned; reserved, see GROUND-ARCHITECTURE.md
  created_by      uuid references auth.users(id) on delete set null,
  verified        boolean not null default false,  -- admin-confirmed real + correctly located. Never set true by the creator (see insert/update policy below).
  active          boolean not null default true,   -- false = admin-deactivated (duplicate, wrong, abusive pin). Soft delete only — see delete policy.
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.grounds enable row level security;

-- Anyone (including a signed-out visitor, same as "anyone can read a live
-- match" / "public tournaments are readable by anyone" elsewhere in this
-- file set) can read an active ground. A ground's own creator or an admin
-- can also see it while inactive — e.g. right after creating it, or while
-- an admin is reviewing it before/after deactivation.
drop policy if exists "active grounds are readable by anyone" on public.grounds;
create policy "active grounds are readable by anyone"
  on public.grounds for select
  using (active = true or public.is_admin() or created_by = auth.uid());

-- Any signed-in user can add a ground. Cannot create it pre-verified —
-- mirrors the profiles insert policy's "cannot create your own profile
-- already flagged admin/organiser" shape exactly.
drop policy if exists "signed-in users can create a ground" on public.grounds;
create policy "signed-in users can create a ground"
  on public.grounds for insert
  with check (auth.uid() is not null and created_by = auth.uid() and verified = false);

-- The creator can fix their own ground's details (name typo, address,
-- coordinates) but can't verify or reactivate/deactivate it themselves —
-- those stay admin-only moderation levers (GROUND 17). Admins can change
-- anything. Same "compare NEW against a fresh SELECT of the current row"
-- shape already proven in profiles' update policy.
drop policy if exists "creator or admin can update a ground" on public.grounds;
create policy "creator or admin can update a ground"
  on public.grounds for update
  using (created_by = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (
      created_by = auth.uid()
      and verified = (select g2.verified from public.grounds g2 where g2.id = grounds.id)
      and active   = (select g2.active   from public.grounds g2 where g2.id = grounds.id)
    )
  );

-- No general delete policy. tournaments/fixtures/live_matches reference
-- grounds with `on delete set null`, so a hard delete wouldn't corrupt
-- anything, but "deactivate" (active = false, via the update policy above)
-- is the intended way to retire a bad ground — it keeps the id resolvable
-- for anything already pointing at it. Admins retain a real delete escape
-- hatch for genuine junk/spam rows.
drop policy if exists "admin can delete a ground" on public.grounds;
create policy "admin can delete a ground"
  on public.grounds for delete
  using (public.is_admin());

-- Indexes for the query patterns GROUND 7 (search) and GROUND 16 (duplicate
-- detection) actually use. Partial on lat/lng: most rows early on will have
-- no coordinates yet (manual-entry grounds, per GROUND 15 in the brief), and
-- an index has nothing useful to do with a null pair.
create index if not exists grounds_normalized_name_idx on public.grounds (normalized_name);
create index if not exists grounds_city_idx            on public.grounds (city);
create index if not exists grounds_country_code_idx    on public.grounds (country_code);
create index if not exists grounds_lat_lng_idx          on public.grounds (latitude, longitude) where latitude is not null;

-- -----------------------------------------------------------------------------
-- tournaments.ground_id — the tournament's default/primary ground. Distinct
-- from the existing free-text `ground`/`location` columns, which are left
-- exactly as they are for display; this is purely an additional structured
-- link. Nullable, so no existing tournament needs migrating.
-- -----------------------------------------------------------------------------
alter table public.tournaments add column if not exists ground_id uuid references public.grounds(id) on delete set null;
create index if not exists tournaments_ground_id_idx on public.tournaments (ground_id) where ground_id is not null;

-- -----------------------------------------------------------------------------
-- fixtures.ground_id — per-fixture ground, can override the tournament's
-- default. This is the one that matters most for Ground Detail (GROUND 13):
-- fixtures already has a "public tournament, role holder, or admin" read
-- policy, so it's the only match-shaped table a signed-out visitor to a
-- ground's page can actually see anything from — standalone `matches` stays
-- owner-only, correctly, exactly as it always has been.
-- -----------------------------------------------------------------------------
alter table public.fixtures add column if not exists ground_id uuid references public.grounds(id) on delete set null;
create index if not exists fixtures_ground_id_idx on public.fixtures (ground_id) where ground_id is not null;

-- Extends the existing sync_fixtures_from_tournament() trigger (originally
-- added for Phase 6 / venue) to also copy ground_id across from the JSONB.
-- Same shape, same idempotency, same "delete what's no longer in the JSONB"
-- tail — only the two `ground_id` lines are new versus the version in
-- supabase.sql.
create or replace function public.sync_fixtures_from_tournament()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fx jsonb;
  seen_ids text[] := array[]::text[];
  fx_id text;
begin
  for fx in
    select * from jsonb_array_elements(coalesce(new.data->'fixtures', '[]'::jsonb))
    union all
    select * from jsonb_array_elements(coalesce(new.data->'knockout', '[]'::jsonb))
  loop
    fx_id := fx->>'id';
    if fx_id is null then continue; end if;
    seen_ids := array_append(seen_ids, fx_id);
    insert into public.fixtures (
      id, tournament_id, stage, round, team_a_id, team_b_id, fixture_date, venue,
      ground_id, match_id, status, result, depends_on, updated_at
    ) values (
      fx_id, new.id, coalesce(fx->>'stage', 'league'),
      nullif(fx->>'round', '')::int,
      fx->>'teamAId', fx->>'teamBId',
      case when fx->>'date' is not null and fx->>'date' <> '' then (fx->>'date')::timestamptz else null end,
      coalesce(fx->>'venue', ''), nullif(fx->>'groundId', '')::uuid,
      fx->>'matchId', coalesce(fx->>'status', 'scheduled'),
      fx->'result', fx->'dependsOn', now()
    )
    on conflict (id) do update set
      tournament_id = excluded.tournament_id, stage = excluded.stage, round = excluded.round,
      team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id,
      fixture_date = excluded.fixture_date, venue = excluded.venue, ground_id = excluded.ground_id,
      match_id = excluded.match_id, status = excluded.status,
      result = excluded.result, depends_on = excluded.depends_on, updated_at = now();
  end loop;

  delete from public.fixtures
    where tournament_id = new.id
      and not (id = any(seen_ids));

  return new;
end;
$$;

-- One-time backfill so every existing tournament's fixtures pick up the new
-- column shape immediately rather than waiting for their next edit. Same
-- self-assign trick as the original migration: fires the trigger without
-- actually changing updated_at's *meaning* for fetchPublicTournaments()'s
-- ordering (it does bump the stored value, same as it did originally — no
-- new behaviour here, just re-running the established approach).
update public.tournaments set updated_at = updated_at;

-- -----------------------------------------------------------------------------
-- live_matches.ground_id — mirrors `location text`, which is already
-- populated from match.venue when a match goes live. Reserved for future
-- proximity-based "Live Now" / "Cricket Near You" (GROUND 30/31 in the
-- brief — explicitly NOT built this phase). No RLS change needed: RLS is
-- row-level, and the existing "anyone can read a live match" policy already
-- covers every column on the row.
-- -----------------------------------------------------------------------------
alter table public.live_matches add column if not exists ground_id uuid references public.grounds(id) on delete set null;
create index if not exists live_matches_ground_id_idx on public.live_matches (ground_id) where ground_id is not null;

-- -----------------------------------------------------------------------------
-- matches.data->>'groundId' — expression index only, no new column. Standalone
-- matches store groundId inside the JSONB (see createMatch() in engine.js),
-- read back the same way data->>'tournamentId' already is in
-- fetchTournamentMatches(). This index is what keeps that pattern fast
-- without changing saveRowIn's generic {id, user_id, data, ...extra}
-- contract, which every one of matches/teams/tournaments/events shares.
-- -----------------------------------------------------------------------------
create index if not exists matches_ground_id_expr_idx on public.matches ((data->>'groundId'));
