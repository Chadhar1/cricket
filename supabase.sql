-- ============================================================================
-- Cricket Connect — Supabase schema + Row Level Security
--
-- Run in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- The ENTIRE file is safe to paste and run again at any time, on a database
-- that already has some or all of it applied: every CREATE TABLE uses
-- IF NOT EXISTS, every ALTER TABLE ADD COLUMN uses IF NOT EXISTS, every
-- CREATE FUNCTION is CREATE OR REPLACE, every CREATE POLICY is preceded by a
-- matching DROP POLICY IF EXISTS, and the realtime publication line is
-- wrapped to ignore "already a member" errors. If you're ever unsure whether
-- your project has the latest schema, just run the whole file again — that's
-- the recommended way to pick up new migrations, not just the newest block.
--
-- This replaces firestore.rules (kept in the repo for reference only, no
-- longer authoritative once you've run this). Same data model, same access
-- rules, just expressed for Postgres:
--
--   profiles                 public: handle, name, avatar, bio, roles
--   matches / teams /
--   tournaments / events      private, one row per record, owned by user_id
--   connections               friendship between two players
--   organiser_applications    request to organise, awaiting admin review
--   admins                    allowlist — NOT writable via the API, ever;
--                             add yourself with SQL in the dashboard only
--   live_matches              public-read live score, owner-write
--
-- Auth (email/password + Google) is handled by Supabase Auth itself — no
-- schema needed for that part, just enable the providers in
-- Authentication -> Providers.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- admin allowlist — the ONLY way to become an admin. Deliberately no INSERT/
-- UPDATE/DELETE policy exists below, on any role, so this table can only be
-- changed from the Supabase SQL editor (or another service-role context),
-- never through the app or its API. To make yourself admin:
--
--   insert into public.admins (uid) values ('<your-auth-user-id>');
--
-- Find your id in Authentication -> Users once you've signed up. Defined
-- first, before anything that references is_admin() below.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  uid uuid primary key references auth.users(id) on delete cascade
);

alter table public.admins enable row level security;

drop policy if exists "admin list is readable so the app can show the admin tab" on public.admins;
create policy "admin list is readable so the app can show the admin tab"
  on public.admins for select
  using (auth.role() = 'authenticated');

-- Helper used throughout the policies below.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists(select 1 from public.admins where uid = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  -- Nullable: an account exists (display name + avatar) before a handle is
  -- chosen. Friends/search/organiser features need a handle; scoring doesn't.
  handle        text unique check (handle is null or handle ~ '^[a-z][a-z0-9_]{2,19}$'),
  display_name  text not null default '' check (char_length(display_name) <= 40),
  avatar_id     text not null default 'helmet',
  -- Compressed JPEG data URL, resized client-side to ~256px (~15-25 KB) —
  -- small enough to live directly on the row, no storage bucket needed.
  photo         text,
  bio           text not null default '' check (char_length(bio) <= 160),
  -- Location, captured at signup (and editable later) so players can be
  -- sorted by area for promotions, regional tournaments and ground
  -- bookings. Deliberately free text, not a fixed lookup table: "province"
  -- vs "state" vs "emirate", and "tehsil" vs "county" vs "borough", vary by
  -- country and there's no single hierarchy that fits everyone.
  country       text not null default '' check (char_length(country) <= 60),
  region        text not null default '' check (char_length(region) <= 60),  -- province / state / emirate
  district      text not null default '' check (char_length(district) <= 60),
  area          text not null default '' check (char_length(area) <= 60),    -- tehsil / famous locality
  is_organiser  boolean not null default false,
  is_admin      boolean not null default false,
  -- Daily-login rewards. points is a future currency (redeemable once the
  -- Marketplace exists) — like handle/is_admin/is_organiser below, none of
  -- these four are in the owner's WITH CHECK allow-list, so the only way to
  -- change them is through daily_check_in() (SECURITY DEFINER), never a
  -- direct client update. That's what stops someone just upserting
  -- {points: 999999} on their own profile.
  points          integer not null default 0 check (points >= 0),
  streak_current  integer not null default 0 check (streak_current >= 0),
  streak_longest  integer not null default 0 check (streak_longest >= 0),
  last_checkin    date,
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by any signed-in user" on public.profiles;
create policy "profiles are readable by any signed-in user"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Nobody may create their own profile already flagged organiser/admin.
drop policy if exists "users can create their own profile" on public.profiles;
create policy "users can create their own profile"
  on public.profiles for insert
  with check (auth.uid() = id and is_admin = false and is_organiser = false);

-- Owner may edit their own presentation, but never their own handle or roles.
-- Admins may edit anything (that's how organiser/admin status is granted).
drop policy if exists "owner can update their own profile, admin can update any" on public.profiles;
create policy "owner can update their own profile, admin can update any"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (
    public.is_admin()
    or (
      auth.uid() = id
      and handle is not distinct from (select handle from public.profiles where id = auth.uid())
      and is_admin = (select is_admin from public.profiles where id = auth.uid())
      and is_organiser = (select is_organiser from public.profiles where id = auth.uid())
      and points = (select points from public.profiles where id = auth.uid())
      and streak_current = (select streak_current from public.profiles where id = auth.uid())
      and streak_longest = (select streak_longest from public.profiles where id = auth.uid())
      and last_checkin is not distinct from (select last_checkin from public.profiles where id = auth.uid())
    )
  );

drop policy if exists "owner or admin can delete a profile" on public.profiles;
create policy "owner or admin can delete a profile"
  on public.profiles for delete
  using (auth.uid() = id or public.is_admin());

-- ---------------------------------------------------------------------------
-- daily_check_in() — the only way points/streak on profiles ever change.
-- Runs as SECURITY DEFINER so it can update columns the caller's own RLS
-- policy blocks them from touching directly, but it decides everything
-- itself from server-side current_date — the client passes no arguments and
-- can't influence the amount awarded. Safe to call every time the app
-- opens; a second call on the same day is a no-op (awarded = 0).
--
--   +10 points for any new day
--   +50 bonus on a 7-day streak, +200 on 30, +1000 on 100
--   a missed day resets the streak to 1, not to 0 (today still counts)
-- ---------------------------------------------------------------------------
create or replace function public.daily_check_in()
returns table(points int, streak_current int, streak_longest int, awarded int, milestone int)
language plpgsql
security definer
as $$
declare
  today date := current_date;
  row public.profiles;
  gained int := 10;
  hit int := 0;
begin
  select * into row from public.profiles where id = auth.uid();
  if row is null then
    raise exception 'Profile not found';
  end if;

  if row.last_checkin = today then
    return query select row.points, row.streak_current, row.streak_longest, 0, 0;
    return;
  end if;

  if row.last_checkin = today - 1 then
    row.streak_current := row.streak_current + 1;
  else
    row.streak_current := 1;
  end if;

  if row.streak_current = 7 then gained := gained + 50; hit := 7;
  elsif row.streak_current = 30 then gained := gained + 200; hit := 30;
  elsif row.streak_current = 100 then gained := gained + 1000; hit := 100;
  end if;

  update public.profiles set
    points = points + gained,
    streak_current = row.streak_current,
    streak_longest = greatest(streak_longest, row.streak_current),
    last_checkin = today,
    updated_at = now()
  where id = auth.uid()
  returning * into row;

  return query select row.points, row.streak_current, row.streak_longest, gained, hit;
end;
$$;

-- ---------------------------------------------------------------------------
-- private per-user data: matches, teams, tournaments, scheduled events.
-- Same shape, same rules, so one function builds all four tables + policies.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['matches','teams','tournaments','events'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id         text primary key,
        user_id    uuid not null references auth.users(id) on delete cascade,
        data       jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table public.%1$I enable row level security;
    $f$, t);

    execute format('drop policy if exists "owner has full access" on public.%1$I;', t);
    execute format(
      'create policy "owner has full access" on public.%1$I for all using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t
    );

    -- Read-only, platform-wide visibility for admins — this is what makes
    -- the Admin dashboard's tournament/match counts actually reflect the
    -- whole platform instead of just whichever account is signed in on this
    -- device. Admins can SELECT any row here, never write/delete another
    -- user's data (no admin bypass on insert/update/delete — the "owner has
    -- full access" policy above is still the only write path).
    execute format('drop policy if exists "admin can read all rows" on public.%1$I;', t);
    execute format(
      'create policy "admin can read all rows" on public.%1$I for select using (public.is_admin());',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- connections (friends)
-- Simple, safe reads/creates/deletes go through RLS directly. Accepting or
-- declining a request is a state transition that depends on the row's
-- CURRENT status, which is awkward to express safely in a single RLS check —
-- so that one action goes through the respond_to_connection() function below
-- instead of a raw UPDATE.
-- ---------------------------------------------------------------------------
create table if not exists public.connections (
  id           text primary key,               -- deterministic pair id, e.g. "<uidA>__<uidB>" sorted
  members      uuid[2] not null,
  requested_by uuid not null references auth.users(id),
  status       text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.connections enable row level security;

drop policy if exists "members or admin can read a connection" on public.connections;
create policy "members or admin can read a connection"
  on public.connections for select
  using (auth.uid() = any(members) or public.is_admin());

drop policy if exists "either member can send a request" on public.connections;
create policy "either member can send a request"
  on public.connections for insert
  with check (
    auth.uid() = any(members)
    and requested_by = auth.uid()
    and status = 'pending'
    and array_length(members, 1) = 2
    and members[1] <> members[2]
  );

drop policy if exists "members or admin can delete a connection" on public.connections;
create policy "members or admin can delete a connection"
  on public.connections for delete
  using (auth.uid() = any(members) or public.is_admin());

create or replace function public.respond_to_connection(conn_id text, accept boolean)
returns public.connections
language plpgsql
security definer
as $$
declare
  row public.connections;
begin
  select * into row from public.connections where id = conn_id;
  if row is null then
    raise exception 'Connection not found';
  end if;
  if not (auth.uid() = any(row.members)) then
    raise exception 'Not a member of this connection';
  end if;
  if row.status = 'pending' then
    if row.requested_by = auth.uid() then
      raise exception 'You cannot accept your own request';
    end if;
    update public.connections
      set status = case when accept then 'accepted' else 'declined' end, updated_at = now()
      where id = conn_id
      returning * into row;
  elsif row.status = 'accepted' and not accept then
    -- unfriend
    update public.connections set status = 'declined', updated_at = now()
      where id = conn_id returning * into row;
  else
    raise exception 'No valid transition from status %', row.status;
  end if;
  return row;
end;
$$;

-- ---------------------------------------------------------------------------
-- organiser applications
-- ---------------------------------------------------------------------------
create table if not exists public.organiser_applications (
  id           uuid primary key default gen_random_uuid(),
  uid          uuid not null references auth.users(id) on delete cascade,
  handle       text,
  display_name text,
  org_name     text not null check (char_length(org_name) >= 3),
  description  text not null check (char_length(description) >= 20),
  contact      text not null default '',
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references auth.users(id),
  admin_note   text not null default ''
);

alter table public.organiser_applications enable row level security;

drop policy if exists "applicant or admin can read an application" on public.organiser_applications;
create policy "applicant or admin can read an application"
  on public.organiser_applications for select
  using (uid = auth.uid() or public.is_admin());

drop policy if exists "a signed-in user can apply" on public.organiser_applications;
create policy "a signed-in user can apply"
  on public.organiser_applications for insert
  with check (uid = auth.uid() and status = 'pending');

-- Approve/reject are admin-only and go through the functions below so the
-- profile flag and the application status can never drift out of sync.
drop policy if exists "admin can update an application" on public.organiser_applications;
create policy "admin can update an application"
  on public.organiser_applications for update
  using (public.is_admin());

drop policy if exists "admin can delete an application" on public.organiser_applications;
create policy "admin can delete an application"
  on public.organiser_applications for delete
  using (public.is_admin());

create or replace function public.approve_organiser_application(app_id uuid)
returns public.organiser_applications
language plpgsql
security definer
as $$
declare
  row public.organiser_applications;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  update public.organiser_applications
    set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
    where id = app_id
    returning * into row;
  if row is null then
    raise exception 'Application not found';
  end if;
  update public.profiles set is_organiser = true where id = row.uid;
  return row;
end;
$$;

create or replace function public.reject_organiser_application(app_id uuid, note text default '')
returns public.organiser_applications
language plpgsql
security definer
as $$
declare
  row public.organiser_applications;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  update public.organiser_applications
    set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(), admin_note = coalesce(note, '')
    where id = app_id
    returning * into row;
  if row is null then
    raise exception 'Application not found';
  end if;
  return row;
end;
$$;

-- ---------------------------------------------------------------------------
-- live match sharing — public read (that's the whole point of the link),
-- owner write.
-- ---------------------------------------------------------------------------
create table if not exists public.live_matches (
  id         text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       jsonb not null,
  live       boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.live_matches enable row level security;

drop policy if exists "anyone can read a live match" on public.live_matches;
create policy "anyone can read a live match" on public.live_matches for select using (true);
drop policy if exists "owner can insert their live match" on public.live_matches;
create policy "owner can insert their live match" on public.live_matches for insert with check (user_id = auth.uid());
drop policy if exists "owner can update their live match" on public.live_matches;
create policy "owner can update their live match" on public.live_matches for update using (user_id = auth.uid());
drop policy if exists "owner or admin can delete a live match" on public.live_matches;
create policy "owner or admin can delete a live match" on public.live_matches for delete using (user_id = auth.uid() or public.is_admin());

-- Realtime: let the live viewer subscribe to score updates. Adding a table
-- that's already a publication member throws (SQLSTATE 42710), so this is
-- wrapped to stay safe to run again.
do $$
begin
  alter publication supabase_realtime add table public.live_matches;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- MIGRATION — location fields on profiles (country / region / district /
-- area). Safe to run again on a database that already has this file applied:
-- the base CREATE TABLE above is skipped by `if not exists` on an existing
-- table, so these columns won't get added automatically — run this block
-- once in the SQL Editor against your existing project.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists country  text not null default '' check (char_length(country) <= 60);
alter table public.profiles add column if not exists region   text not null default '' check (char_length(region) <= 60);
alter table public.profiles add column if not exists district text not null default '' check (char_length(district) <= 60);
alter table public.profiles add column if not exists area     text not null default '' check (char_length(area) <= 60);

-- ---------------------------------------------------------------------------
-- MIGRATION — admin platform-wide read access on matches/teams/tournaments/
-- events. Without this, the Admin dashboard's tournament/match stats only
-- ever reflect whichever account happens to be signed in, not the whole
-- platform, because every existing policy on these tables is owner-only.
-- `create policy` has no `if not exists`, so this drops+recreates safely if
-- you run it more than once.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['matches','teams','tournaments','events'] loop
    execute format('drop policy if exists "admin can read all rows" on public.%1$I;', t);
    execute format(
      'create policy "admin can read all rows" on public.%1$I for select using (public.is_admin());',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- MIGRATION — daily login streak + points. Adds the columns, re-locks the
-- owner-update policy so points/streak can only change through
-- daily_check_in() below, and (re)creates that function. All idempotent —
-- safe to run again.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists points         integer not null default 0 check (points >= 0);
alter table public.profiles add column if not exists streak_current integer not null default 0 check (streak_current >= 0);
alter table public.profiles add column if not exists streak_longest integer not null default 0 check (streak_longest >= 0);
alter table public.profiles add column if not exists last_checkin   date;

drop policy if exists "owner can update their own profile, admin can update any" on public.profiles;
create policy "owner can update their own profile, admin can update any"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (
    public.is_admin()
    or (
      auth.uid() = id
      and handle is not distinct from (select handle from public.profiles where id = auth.uid())
      and is_admin = (select is_admin from public.profiles where id = auth.uid())
      and is_organiser = (select is_organiser from public.profiles where id = auth.uid())
      and points = (select points from public.profiles where id = auth.uid())
      and streak_current = (select streak_current from public.profiles where id = auth.uid())
      and streak_longest = (select streak_longest from public.profiles where id = auth.uid())
      and last_checkin is not distinct from (select last_checkin from public.profiles where id = auth.uid())
    )
  );

create or replace function public.daily_check_in()
returns table(points int, streak_current int, streak_longest int, awarded int, milestone int)
language plpgsql
security definer
as $$
declare
  today date := current_date;
  row public.profiles;
  gained int := 10;
  hit int := 0;
begin
  select * into row from public.profiles where id = auth.uid();
  if row is null then
    raise exception 'Profile not found';
  end if;

  if row.last_checkin = today then
    return query select row.points, row.streak_current, row.streak_longest, 0, 0;
    return;
  end if;

  if row.last_checkin = today - 1 then
    row.streak_current := row.streak_current + 1;
  else
    row.streak_current := 1;
  end if;

  if row.streak_current = 7 then gained := gained + 50; hit := 7;
  elsif row.streak_current = 30 then gained := gained + 200; hit := 30;
  elsif row.streak_current = 100 then gained := gained + 1000; hit := 100;
  end if;

  update public.profiles set
    points = points + gained,
    streak_current = row.streak_current,
    streak_longest = greatest(streak_longest, row.streak_current),
    last_checkin = today,
    updated_at = now()
  where id = auth.uid()
  returning * into row;

  return query select row.points, row.streak_current, row.streak_longest, gained, hit;
end;
$$;

-- ---------------------------------------------------------------------------
-- MIGRATION — public tournament discovery. Tournaments stay private by
-- default (is_public defaults to false, so every existing tournament keeps
-- its current behavior: visible only to its owner and admins). Owners opt
-- a tournament in when creating it. This only ADDS a new read path — the
-- existing owner-only and admin-only select policies on public.tournaments
-- are untouched, so nothing that worked before changes.
-- ---------------------------------------------------------------------------
alter table public.tournaments add column if not exists is_public boolean not null default false;

drop policy if exists "public tournaments are readable by anyone" on public.tournaments;
create policy "public tournaments are readable by anyone"
  on public.tournaments for select
  using (is_public = true);

-- ---------------------------------------------------------------------------
-- MIGRATION — public player profiles. A profile becomes readable by anyone,
-- signed in or not, only once its owner has claimed a public handle — the
-- same "I want to be findable" signal the rest of the app already uses for
-- friend search. Profiles without a handle keep the existing behavior
-- (visible only to other signed-in users). This only ADDS a read path; the
-- app's own public-profile queries (fetchPublicPlayerCard) also request a
-- narrow column list, not '*', so admin/points/streak fields are never
-- fetched for this route even though RLS would otherwise allow the row.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles with a public handle are readable by anyone" on public.profiles;
create policy "profiles with a public handle are readable by anyone"
  on public.profiles for select
  using (handle is not null);

-- ---------------------------------------------------------------------------
-- MIGRATION — tournament architecture foundation (Task 5).
--
-- Promotes the scalar fields a tournament listing/detail page and RLS
-- actually need to query, filter or show independent of the JSONB blob, as
-- real columns. `data` keeps holding the full nested object (teams,
-- fixtures, knockout) exactly as tournament.js already reads/writes it —
-- this migration does not touch that shape, so nothing existing breaks.
--
-- No new RLS policies are needed here: RLS is row-level, not column-level,
-- so the existing "owner has full access" / "admin can read all rows" /
-- "public tournaments are readable by anyone" policies on this table
-- already cover these new columns automatically.
--
-- `tournament_teams` and `fixtures` as separate normalized tables are
-- deliberately NOT part of this migration — see the Task 5 architecture
-- note in tournament.js. They belong to a future migration once there's a
-- real consumer for row-level team/fixture access (self-service team
-- registration with captain/manager permissions, or cross-tournament
-- fixture browsing) — building them unused now would just be a second,
-- unsynced source of truth alongside the JSONB the app already reads.
-- ---------------------------------------------------------------------------
alter table public.tournaments add column if not exists name         text not null default '';
alter table public.tournaments add column if not exists location     text not null default '';
alter table public.tournaments add column if not exists ground       text not null default '';
alter table public.tournaments add column if not exists start_date   date;
alter table public.tournaments add column if not exists end_date     date;
alter table public.tournaments add column if not exists description  text not null default '';
alter table public.tournaments add column if not exists banner_url   text;
alter table public.tournaments add column if not exists entry_rules  text not null default '';
alter table public.tournaments add column if not exists rules        text not null default '';
alter table public.tournaments add column if not exists status       text not null default 'upcoming'
  check (status in ('upcoming','live','completed','cancelled'));

-- ---------------------------------------------------------------------------
-- Live Now (public "what's on" list, browsable by area) + admin live-activity
-- tiles. `location` is the free-text ground/venue the scorer already types
-- at match setup — reused as-is, not a new required field. Additive column,
-- default null, existing rows unaffected. No RLS change needed: the existing
-- "anyone can read a live match" / owner-write policies on live_matches
-- already cover it, since RLS is row-level not column-level.
-- ---------------------------------------------------------------------------
alter table public.live_matches add column if not exists location text;

-- ---------------------------------------------------------------------------
-- feedback — authenticated users only, admin-reviewed. Deliberately no
-- public read: this is internal product feedback, not a public review —
-- Play Store ratings/reviews are a separate, later, public-facing feature
-- and don't touch this table at all.
-- ---------------------------------------------------------------------------
create table if not exists public.feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  feedback_type text not null default 'other'
    check (feedback_type in ('bug','feature','suggestion','ux','tournament_match','other')),
  rating        smallint check (rating is null or rating between 1 and 5),
  message       text not null check (char_length(message) between 1 and 2000),
  page          text not null default '',   -- best-effort: which screen they were on
  app_version   text not null default '',
  status        text not null default 'new' check (status in ('new','reviewed','resolved')),
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users(id)
);

alter table public.feedback enable row level security;

drop policy if exists "user can submit their own feedback" on public.feedback;
create policy "user can submit their own feedback"
  on public.feedback for insert
  with check (user_id = auth.uid());

-- Users can see their own past submissions (not required by the brief, but
-- costs nothing and enables a future "your feedback" view with no schema
-- change); admins can see everyone's. Nobody but admin can ever read
-- another user's feedback.
drop policy if exists "user can read own feedback, admin can read all" on public.feedback;
create policy "user can read own feedback, admin can read all"
  on public.feedback for select
  using (user_id = auth.uid() or public.is_admin());

-- Only admin can change status/reviewed_* — a submitter can never edit or
-- withdraw their own feedback after sending it (matches "permanent record"
-- treatment used elsewhere, e.g. organiser_applications).
drop policy if exists "only admin can update feedback" on public.feedback;
create policy "only admin can update feedback"
  on public.feedback for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy on any role — feedback is a permanent record.

-- ---------------------------------------------------------------------------
-- Admin moderation of tournaments/matches. Neither table gives admins a
-- write path via RLS — the shared matches/teams/tournaments/events loop
-- above only grants "owner has full access" + "admin can read all rows"
-- (select-only). Cancellation goes through a narrow SECURITY DEFINER
-- function instead of a broad admin-write RLS policy, the same pattern this
-- file already uses for daily_check_in() and approve_organiser_application():
-- it can only ever flip a status flag, never touch the rest of the row, and
-- it re-checks is_admin() itself rather than trusting the caller.
-- ---------------------------------------------------------------------------
create or replace function public.admin_cancel_tournament(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.tournaments
    set status = 'cancelled', updated_at = now()
    where id = p_id;
  return found;
end;
$$;

-- Matches have no real `status` column — match state lives entirely in the
-- jsonb `data` column that engine.js reads/writes. A single additive
-- `cancelled` flag is enough for admin moderation without reshaping the
-- engine's match object or touching engine.js at all; app.js checks this
-- flag alongside the existing `match.completed` check before allowing any
-- scoring action.
alter table public.matches add column if not exists cancelled boolean not null default false;

create or replace function public.admin_cancel_match(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  did_update boolean;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.matches
    set cancelled = true, updated_at = now()
    where id = p_id;
  -- Capture FOUND right after the UPDATE — it gets silently overwritten by
  -- the DELETE below (FOUND reflects whichever statement ran most recently
  -- in PL/pgSQL), and most matches never had a live_matches row to begin
  -- with, so returning the post-DELETE FOUND would report "not found" on
  -- almost every successful cancellation.
  did_update := found;
  -- A cancelled match shouldn't keep broadcasting as if still in progress —
  -- stop any active live share immediately (this is why it's a function and
  -- not a plain admin UPDATE policy: one call, two tables, one authorization
  -- check, both effects atomic).
  delete from public.live_matches where id = p_id;
  return did_update;
end;
$$;

-- ---------------------------------------------------------------------------
-- UI/UX modernization: self-reported playing identity, shown on the player
-- profile ("Batting Style" / "Bowling Style" / role badge) and Top Players.
-- Deliberately self-reported, not derived — the app has no way to compute
-- a "skill rating" or a cross-user playing role from real data, and the
-- brief is explicit about never faking statistics. These three are just
-- opinion fields a player fills in about themselves, same trust level as
-- the existing bio/location fields, covered by the same RLS policies.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists batting_style text not null default '' check (char_length(batting_style) <= 30);
alter table public.profiles add column if not exists bowling_style text not null default '' check (char_length(bowling_style) <= 30);
alter table public.profiles add column if not exists primary_role  text not null default '' check (char_length(primary_role) <= 20);

-- ---------------------------------------------------------------------------
-- Admin Push Notification & Announcement system.
--
-- Audience honesty note: teams and tournaments are stored as a single jsonb
-- blob per row (see the matches/teams/tournaments/events loop above), and
-- their rosters are free-text player names, not foreign keys to auth.users.
-- There is also no "followers" table. That means "team members" and
-- "tournament followers" CANNOT be resolved to real recipients today — so
-- this schema deliberately does not offer them as an audience_type. Only
-- audiences resolvable from real columns on `profiles` are supported: all
-- users, players (non-organisers), organisers, country, city/district,
-- specific users. See resolve_notification_audience() below — extending it
-- to teams/tournaments later just needs those rosters linked to real user
-- ids first, no other schema change.
--
--   notification_templates   reusable title/message templates (admin-only)
--   notifications             one row per send/campaign, owned by an admin
--   notification_recipients   one row per (notification, user) — powers the
--                              in-app notification center: read/unread state
--   notification_devices      FCM registration tokens, one row per browser/
--                              device a user has granted push permission on
--
-- Actual push delivery (calling FCM) happens from a Supabase Edge Function
-- using the service role key + an FCM service-account secret — NEVER from
-- the browser. See supabase/functions/send-notification in the repo. This
-- file only creates the tables/RLS/audience-resolution the Edge Function and
-- the admin panel both read and write.
-- ---------------------------------------------------------------------------

create table if not exists public.notification_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 80),
  type            text not null default 'announcement' check (type in (
                    'announcement','cricket_news','tournament','live_match',
                    'match_result','team','player','reward','important_update',
                    'maintenance','custom'
                  )),
  title_template  text not null check (char_length(title_template) between 1 and 120),
  message_template text not null check (char_length(message_template) between 1 and 500),
  action_type     text not null default 'none' check (action_type in (
                    'none','open_tournament','open_live_match','open_player',
                    'open_notifications','open_home'
                  )),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.notification_templates enable row level security;

-- Templates are an admin authoring tool, not user-facing content — nobody
-- but an admin ever reads this table directly (a sent notification's own
-- title/message is copied onto the `notifications` row itself, so a
-- recipient never needs template access to see their notification).
drop policy if exists "admin has full access to templates" on public.notification_templates;
create policy "admin has full access to templates"
  on public.notification_templates for all
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.notifications (
  id                uuid primary key default gen_random_uuid(),
  type              text not null default 'announcement' check (type in (
                      'announcement','cricket_news','tournament','live_match',
                      'match_result','team','player','reward','important_update',
                      'maintenance','custom'
                    )),
  title             text not null check (char_length(title) between 1 and 120),
  message           text not null check (char_length(message) between 1 and 500),
  image_url         text,
  action_type       text not null default 'none' check (action_type in (
                      'none','open_tournament','open_live_match','open_player',
                      'open_notifications','open_home'
                    )),
  -- id of the tournament/live match/player this points at; unused (null) for
  -- action types that don't need a target (open_notifications, open_home).
  action_target     text,
  audience_type     text not null check (audience_type in (
                      'all','players','organisers','country','city','selected','user'
                    )),
  -- {} for all/players/organisers; {country:'Pakistan'} for country;
  -- {district:'Lahore'} for city; {user_ids:[...]} for selected;
  -- {user_id:'...'} for a single specific user.
  audience_filter   jsonb not null default '{}'::jsonb,
  template_id       uuid references public.notification_templates(id),
  created_by        uuid not null references auth.users(id),
  -- FCM only ever confirms a message was *submitted* to Google's servers,
  -- never that it reached or was seen on a device — "delivered"/"read" in
  -- the FCM sense would overclaim, so the counts below are named for what's
  -- actually true (see the Edge Function for how these get set).
  status            text not null default 'draft' check (status in (
                      'draft','scheduled','sending','sent','partially_failed',
                      'failed','cancelled'
                    )),
  scheduled_at      timestamptz,
  sent_at           timestamptz,
  recipients_total  integer not null default 0,
  push_submitted    integer not null default 0,
  push_failed       integer not null default 0,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.notifications enable row level security;

-- The "admin or recipient can read a notification" SELECT policy references
-- public.notification_recipients in a subquery, so it can't be created until
-- that table exists — Postgres validates a policy's expression at CREATE
-- POLICY time, not lazily. It's added further down, right after
-- notification_recipients is created (search for that policy name below).
-- notification_recipients in turn has a foreign key back to notifications.id,
-- so the two tables have a circular ordering requirement: notifications must
-- exist before notification_recipients (FK), but notification_recipients
-- must exist before notifications' own SELECT policy (subquery). Creating
-- both tables first and only then adding every policy is what breaks the
-- cycle — don't move that policy back up next to this table without also
-- moving the notification_recipients table creation above it.

drop policy if exists "admin can create a notification" on public.notifications;
create policy "admin can create a notification"
  on public.notifications for insert
  with check (public.is_admin() and created_by = auth.uid());

-- Covers the admin panel editing a draft or cancelling a scheduled send. The
-- Edge Function itself writes status/sent_at/recipients_total/push_* using
-- the service role key, which bypasses RLS entirely, so this policy is only
-- ever exercised by the admin's own browser session.
drop policy if exists "admin can update a notification" on public.notifications;
create policy "admin can update a notification"
  on public.notifications for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin can delete a notification" on public.notifications;
create policy "admin can delete a notification"
  on public.notifications for delete
  using (public.is_admin());

-- One row per (notification, user) — this table alone is what the in-app
-- Notification Center reads: it's the user's inbox, read/unread state and
-- all. Deliberately separate from push delivery bookkeeping (notifications.
-- push_submitted/push_failed above): a user with no registered device still
-- gets a row here and sees the notification next time they open the app.
create table if not exists public.notification_recipients (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz,
  dismissed_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (notification_id, user_id)
);

alter table public.notification_recipients enable row level security;

-- Deferred here from right after the `notifications` table above — see the
-- comment there for why. Admins see every notification (History tab); a
-- regular user can see a notification's own content only if they're an
-- actual recipient of it, which is what lets the in-app Notification Center
-- join recipient rows back to title/message/type/action without a second
-- admin-only fetch.
drop policy if exists "admin or recipient can read a notification" on public.notifications;
create policy "admin or recipient can read a notification"
  on public.notifications for select
  using (
    public.is_admin()
    or exists(
      select 1 from public.notification_recipients nr
      where nr.notification_id = notifications.id and nr.user_id = auth.uid()
    )
  );

drop policy if exists "recipient or admin can read a recipient row" on public.notification_recipients;
create policy "recipient or admin can read a recipient row"
  on public.notification_recipients for select
  using (user_id = auth.uid() or public.is_admin());

-- A user may mark their own notification read/dismissed — nothing else on
-- the row is meant to move, so notification_id and user_id are locked to
-- their existing values (same "allow-list the mutable fields" pattern as the
-- profiles update policy above), stopping someone from reassigning a
-- recipient row to a different notification or claiming someone else's.
drop policy if exists "recipient can update read/dismissed state on their own row" on public.notification_recipients;
create policy "recipient can update read/dismissed state on their own row"
  on public.notification_recipients for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and notification_id = (select notification_id from public.notification_recipients r where r.id = notification_recipients.id)
  );

-- No insert policy for the authenticated/anon role at all: recipient rows
-- are only ever fanned out by the Edge Function using the service role key
-- (which bypasses RLS), never inserted directly from a browser — not even
-- an admin's. Keeps a broadcast to thousands of users from ever becoming
-- thousands of individual inserts from someone's phone.

create table if not exists public.notification_devices (
  -- The FCM registration token itself is the primary key: it identifies one
  -- browser/app install, not a person. If the same browser signs in as a
  -- different user later, upserting here correctly re-points that token at
  -- the new owner instead of accumulating duplicate rows for a stale user.
  fcm_token    text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  platform     text not null default 'web' check (platform in ('web','android','ios')),
  -- Best-effort browser/OS label for the user's own "manage devices" list —
  -- never a hardware identifier, never shown to anyone but the owner.
  device_label text not null default '',
  last_seen    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.notification_devices enable row level security;

-- Owner-only, full stop — not even admins can read raw FCM tokens through
-- the API (per "do not expose device tokens publicly"). The Edge Function
-- reads them using the service role key, which bypasses RLS entirely, so it
-- never needs a policy granting it access here.
drop policy if exists "owner has full access to their own devices" on public.notification_devices;
create policy "owner has full access to their own devices"
  on public.notification_devices for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- resolve_notification_audience() — the single source of truth for "who is
-- in audience X", used by the admin panel's pre-send "Send to N users?"
-- preview count. Admin-only (raises if not public.is_admin()), reads only
-- real profiles columns — no fake segments.
--
-- The Edge Function does NOT call this over RPC (a service-role caller has
-- no auth.uid(), so public.is_admin() would always be false for it) — it
-- runs the equivalent filter directly against the database using the
-- service role key, which bypasses RLS. Keep both in sync if you add a new
-- audience_type; the Edge Function's copy is in
-- supabase/functions/send-notification/index.ts (resolveAudience()).
-- ---------------------------------------------------------------------------
create or replace function public.resolve_notification_audience(p_audience_type text, p_filter jsonb default '{}'::jsonb)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  if p_audience_type = 'all' then
    return query select id from public.profiles;
  elsif p_audience_type = 'players' then
    return query select id from public.profiles where is_organiser = false;
  elsif p_audience_type = 'organisers' then
    return query select id from public.profiles where is_organiser = true;
  elsif p_audience_type = 'country' then
    return query select id from public.profiles
      where p_filter->>'country' is not null and lower(country) = lower(p_filter->>'country');
  elsif p_audience_type = 'city' then
    return query select id from public.profiles
      where p_filter->>'district' is not null and lower(district) = lower(p_filter->>'district');
  elsif p_audience_type = 'selected' then
    return query select id from public.profiles
      where id = any(
        (select array_agg((x)::uuid) from jsonb_array_elements_text(coalesce(p_filter->'user_ids', '[]'::jsonb)) x)
      );
  elsif p_audience_type = 'user' then
    return query select id from public.profiles where id = (p_filter->>'user_id')::uuid;
  else
    raise exception 'unknown audience_type: %', p_audience_type;
  end if;
end;
$$;

-- Admin dashboard's "active devices" stat needs a count, not the tokens
-- themselves — notification_devices intentionally has no admin read policy
-- at all (raw FCM tokens stay owner-only, full stop), so a narrow
-- SECURITY DEFINER function that returns only a number, never a row, is
-- what lets the summary card be honest without opening that table up.
create or replace function public.count_registered_devices()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select case when public.is_admin() then (select count(*) from public.notification_devices) else 0 end;
$$;

-- Realtime: lets the notification bell update the unread badge live while
-- the app is open in a tab, without polling. Push (FCM) is still what wakes
-- a closed/backgrounded app — this only covers "already looking at the app
-- in another tab right now".
do $$
begin
  alter publication supabase_realtime add table public.notification_recipients;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled sends: a `notifications` row with status='scheduled' and a
-- future scheduled_at is only a database record until something actually
-- triggers delivery — this app has no long-running server to run a setTimeout
-- against, so it needs Supabase's own cron mechanism. Requires the pg_cron
-- and pg_net extensions (Database -> Extensions in the dashboard; available
-- on Supabase's paid plans, not reliably on the free tier). Uncomment and
-- fill in your project ref + a service-role-scoped secret once the
-- send-notification Edge Function (below) is deployed:
--
--   select cron.schedule(
--     'dispatch-scheduled-notifications',
--     '* * * * *',  -- every minute
--     $$
--       select net.http_post(
--         url := 'https://<your-project-ref>.supabase.co/functions/v1/dispatch-scheduled',
--         headers := jsonb_build_object(
--           'Authorization', 'Bearer <service-role-key-stored-as-a-vault-secret>',
--           'Content-Type', 'application/json'
--         )
--       );
--     $$
--   );
--
-- See supabase/functions/dispatch-scheduled/index.ts — it finds due rows
-- (status='scheduled' and scheduled_at <= now()) and calls the same send
-- logic as an immediate send.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tournament Organizer Control Center — Phase 2: permission architecture
-- foundation. See TOURNAMENT_ORGANIZER_CONTROL_CENTER_AUDIT.md (repo root's
-- parent folder) for the full audit/plan this implements.
--
-- Today, tournament access is exactly one bit: `tournaments.user_id =
-- auth.uid()` (the "owner has full access" policy generated by the shared
-- matches/teams/tournaments/events loop above), plus admins getting a
-- read-only override. There is no way to grant a second person any access
-- to someone else's tournament. This table is the foundation everything
-- else in the Organizer Control Center brief builds on: a real, per-
-- tournament role a person can hold, independent of the `admins` allowlist
-- and independent of `profiles.is_organiser` (which stays a platform-wide
-- flag, unrelated to any specific tournament).
--
-- Deliberately additive, not a replacement:
--   * The existing owner-only write policy on `tournaments` is untouched.
--     A tournament's `user_id` column remains the one true creator/owner —
--     these role rows are extra grants on top of it, not instead of it.
--   * Only a new SELECT policy is added to `tournaments` below (a role
--     holder can now read a tournament they're not the row-owner of).
--     Nothing about who can WRITE to a tournament changes in this phase —
--     that's Phase 4 (manager permissions) and Phase 7 (scorer/official
--     write access to a specific match), each its own small, reviewable
--     migration once this foundation is proven safe.
--   * Every existing tournament gets its current owner backfilled into this
--     table as an 'owner' row below, and a trigger keeps that happening
--     automatically for every tournament created from now on — so nothing
--     currently working ever depends on someone remembering to run this
--     backfill again.
-- ---------------------------------------------------------------------------
create table if not exists public.tournament_roles (
  id            uuid primary key default gen_random_uuid(),
  tournament_id text not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('owner','manager','scorer','official')),
  granted_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tournament_id, user_id)
);

alter table public.tournament_roles enable row level security;

-- HOTFIX (post-Phase 11): this table's SELECT policy used to check
-- tournament ownership with a raw `exists(select 1 from public.tournaments
-- ...)` subquery. That subquery triggers tournaments' own RLS — and
-- tournaments' "tournament role holder can read their tournament" policy
-- (below) used to do the exact same thing in reverse, with a raw subquery
-- into tournament_roles. Two RLS-protected tables each doing a plain
-- subquery into the other forms a genuine cycle: reading either table
-- re-triggers the other's policy forever, until Postgres gives up with
-- "infinite recursion detected in policy for relation ..." (42P17) — which
-- is exactly what broke the admin dashboard and any other tournaments read.
-- Fixed by routing tournament ownership checks through a SECURITY DEFINER
-- function instead of a raw subquery — SECURITY DEFINER functions run as
-- the function owner, which bypasses RLS entirely (no FORCE ROW LEVEL
-- SECURITY is set anywhere in this file), so this call never re-enters
-- tournaments' RLS and the cycle is broken for good. Same pattern already
-- used everywhere else in this file (is_admin(), has_tournament_role()).
create or replace function public.is_tournament_creator(p_tournament_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(select 1 from public.tournaments where id = p_tournament_id and user_id = auth.uid());
$$;

-- A person can see their own role row anywhere; the tournament's actual
-- creator (tournaments.user_id — still the ultimate authority in this
-- phase) can see every role granted on their own tournament; admins can see
-- everything. Deliberately NOT letting one role holder see every other role
-- holder yet (e.g. a scorer seeing the full manager list) — that's a Phase
-- 3 UI decision, not needed for this foundation and easy to widen later
-- without touching what's built here.
drop policy if exists "role holder, tournament creator, or admin can read tournament roles" on public.tournament_roles;
create policy "role holder, tournament creator, or admin can read tournament roles"
  on public.tournament_roles for select
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_tournament_creator(tournament_roles.tournament_id)
  );

-- No insert/update/delete policy for any role — same pattern as
-- notification_recipients and organiser_applications' approve/reject: all
-- writes go through the two SECURITY DEFINER functions below, which
-- re-check authorization themselves rather than trusting a client-supplied
-- row. Keeps "who can grant a role" from ever becoming a raw RLS write
-- policy someone could get subtly wrong.

-- Read-only helper for RLS policies added in later phases (mirrors the
-- is_admin() pattern above) — NOT used by any policy yet in this phase,
-- defined now so Phase 4/7's migrations are additive too instead of having
-- to touch this one again.
create or replace function public.has_tournament_role(p_tournament_id text, p_roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.tournament_roles
    where tournament_id = p_tournament_id and user_id = auth.uid() and role = any(p_roles)
  );
$$;

create or replace function public.grant_tournament_role(p_tournament_id text, p_user_id uuid, p_role text)
returns public.tournament_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.tournament_roles;
  is_owner boolean;
begin
  if p_role not in ('owner','manager','scorer','official') then
    raise exception 'invalid role: %', p_role;
  end if;
  select exists(select 1 from public.tournaments where id = p_tournament_id and user_id = auth.uid()) into is_owner;
  if not (is_owner or public.is_admin()) then
    raise exception 'not authorized';
  end if;
  insert into public.tournament_roles (tournament_id, user_id, role, granted_by)
    values (p_tournament_id, p_user_id, p_role, auth.uid())
  on conflict (tournament_id, user_id) do update
    set role = excluded.role, granted_by = excluded.granted_by, updated_at = now()
  returning * into row;
  return row;
end;
$$;

create or replace function public.revoke_tournament_role(p_tournament_id text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  is_owner boolean;
  did_delete boolean;
begin
  select exists(select 1 from public.tournaments where id = p_tournament_id and user_id = auth.uid()) into is_owner;
  if not (is_owner or public.is_admin()) then
    raise exception 'not authorized';
  end if;
  -- The tournament's own user_id owner can't be removed through this path —
  -- that column is still the one true owner in this phase, and the trigger
  -- below would just recreate this row on the next insert anyway. A clear
  -- error here beats a silent no-op.
  if p_user_id = (select user_id from public.tournaments where id = p_tournament_id) then
    raise exception 'cannot revoke the tournament creator''s own access';
  end if;
  delete from public.tournament_roles where tournament_id = p_tournament_id and user_id = p_user_id;
  did_delete := found;
  return did_delete;
end;
$$;

-- Keeps every new tournament's creator backfilled into tournament_roles
-- automatically, the moment it's created — so nothing built on top of this
-- table in a later phase ever has to special-case "a tournament with no
-- owner role row yet".
create or replace function public.tournament_owner_role_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tournament_roles (tournament_id, user_id, role, granted_by)
    values (new.id, new.user_id, 'owner', new.user_id)
  on conflict (tournament_id, user_id) do update set role = 'owner', updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tournament_owner_role on public.tournaments;
create trigger trg_tournament_owner_role
  after insert on public.tournaments
  for each row execute function public.tournament_owner_role_trigger();

-- Additive SELECT policy on the existing tournaments table: a role holder
-- (manager/scorer/official — owners already read their own row via the
-- existing owner-only policy) can now read a tournament even when they're
-- not its row-level user_id. Every existing SELECT/INSERT/UPDATE/DELETE
-- policy on tournaments from earlier in this file is untouched — RLS
-- policies are OR'd together, so this can only ever widen read access,
-- never narrow anything that already worked.
--
-- HOTFIX (post-Phase 11): this used to be a raw
-- `exists(select 1 from public.tournament_roles r where ...)` subquery,
-- which combined with tournament_roles' own reverse subquery (see that
-- table's SELECT policy above) formed an infinite RLS recursion cycle
-- (Postgres error 42P17) on every read of either table. Routed through
-- has_tournament_role() — already a SECURITY DEFINER function, defined
-- above specifically as "a read-only helper for RLS policies added in
-- later phases" — which bypasses RLS instead of re-triggering it.
drop policy if exists "tournament role holder can read their tournament" on public.tournaments;
create policy "tournament role holder can read their tournament"
  on public.tournaments for select
  using (
    public.has_tournament_role(tournaments.id, array['owner','manager','scorer','official'])
  );

-- One-time backfill: give every existing tournament's current owner an
-- 'owner' row here, so role-aware code introduced in later phases sees
-- consistent data for tournaments created before this migration too. Safe
-- to run again — the `not exists` guard and the trigger's own ON CONFLICT
-- both make this idempotent.
insert into public.tournament_roles (tournament_id, user_id, role, granted_by)
select t.id, t.user_id, 'owner', t.user_id
from public.tournaments t
where not exists (
  select 1 from public.tournament_roles r where r.tournament_id = t.id and r.user_id = t.user_id
)
on conflict (tournament_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Tournament Organizer Control Center — Phase 4: manager write access +
-- emergency controls (pause / lock / organizer-initiated cancel).
--
-- Two genuinely new capabilities land here:
--   1. A 'manager' role holder can now WRITE to a tournament they don't own
--      (edit details, manage fixtures/knockout) — every write path before
--      this was owner-only, full stop. Deliberately narrower than owner:
--      no DELETE policy is added for managers (can't delete the
--      tournament), and the WITH CHECK below locks `user_id` to its
--      current value so this can never be used to transfer ownership.
--   2. `status` gains a real 'paused' value (previously only 'cancelled'
--      was ever specially interpreted — see tournament.js's deriveStatus,
--      updated alongside this migration), plus a `locked` flag that, while
--      true, blocks the new manager write policy entirely — an admin can
--      still act (matching every other admin override in this file), but
--      an owner/manager must unlock first. This is the "freeze everything
--      while we sort out a dispute" control from the brief.
-- ---------------------------------------------------------------------------

-- The original status check constraint was added inline on an ALTER TABLE
-- ADD COLUMN, so Postgres auto-named it — found here by matching its actual
-- definition rather than assuming a name, then replaced with an explicitly
-- named one that includes 'paused'. Safe to run again: after the first run
-- the constraint (now named tournaments_status_check) still matches this
-- same lookup, so it's just dropped and recreated identically.
do $$
declare
  con text;
begin
  select conname into con
    from pg_constraint
    where conrelid = 'public.tournaments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%upcoming%live%completed%cancelled%';
  if con is not null then
    execute format('alter table public.tournaments drop constraint %I', con);
  end if;
end $$;

alter table public.tournaments add constraint tournaments_status_check
  check (status in ('upcoming','live','paused','completed','cancelled'));

alter table public.tournaments add column if not exists locked boolean not null default false;

-- Additive UPDATE policy: a manager can write to a tournament they don't
-- own. The owner's own pre-existing "owner has full access" policy (from
-- the shared matches/teams/tournaments/events loop near the top of this
-- file) is completely untouched — this is a second, narrower policy that
-- only ever widens who can write, for managers specifically, never
-- replacing what already worked for owners.
drop policy if exists "manager can update tournament details" on public.tournaments;
create policy "manager can update tournament details"
  on public.tournaments for update
  using (
    public.has_tournament_role(tournaments.id, array['manager'])
    and not tournaments.locked
  )
  with check (
    public.has_tournament_role(tournaments.id, array['manager'])
    and not tournaments.locked
    and user_id = (select user_id from public.tournaments t2 where t2.id = tournaments.id)
  );

-- Shared authorization check for the four functions below: the caller must
-- be the tournament's owner or manager, or a platform admin. Kept as a
-- single function rather than repeating the same two-line check four times.
create or replace function public.is_tournament_manager_or_owner(p_tournament_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.has_tournament_role(p_tournament_id, array['owner','manager']) or public.is_admin();
$$;

create or replace function public.lock_tournament(p_tournament_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare did_update boolean;
begin
  if not public.is_tournament_manager_or_owner(p_tournament_id) then
    raise exception 'not authorized';
  end if;
  update public.tournaments set locked = true, updated_at = now() where id = p_tournament_id;
  did_update := found;
  return did_update;
end;
$$;

create or replace function public.unlock_tournament(p_tournament_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare did_update boolean;
begin
  if not public.is_tournament_manager_or_owner(p_tournament_id) then
    raise exception 'not authorized';
  end if;
  update public.tournaments set locked = false, updated_at = now() where id = p_tournament_id;
  did_update := found;
  return did_update;
end;
$$;

-- Restricted to 'upcoming'/'live'/'paused' on purpose: 'completed' is
-- meant to stay a derived fact (tournamentChampion() in tournament.js), and
-- 'cancelled' has its own function below for a clearer audit trail — this
-- one function isn't a general-purpose "set any status" backdoor.
create or replace function public.set_tournament_status(p_tournament_id text, p_status text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare did_update boolean; is_locked boolean;
begin
  if p_status not in ('upcoming','live','paused') then
    raise exception 'invalid status for this function: %', p_status;
  end if;
  if not public.is_tournament_manager_or_owner(p_tournament_id) then
    raise exception 'not authorized';
  end if;
  select locked into is_locked from public.tournaments where id = p_tournament_id;
  if is_locked and not public.is_admin() then
    raise exception 'tournament is locked — unlock it first';
  end if;
  update public.tournaments set status = p_status, updated_at = now() where id = p_tournament_id;
  did_update := found;
  return did_update;
end;
$$;

-- Distinct from admin_cancel_tournament() above: that one is the platform
-- moderation path (admin cancelling ANY tournament, no role check). This is
-- the organizer's own path — owner or manager cancelling a tournament they
-- actually run — added because a manager has no other way to do this (they
-- don't hold the row's user_id, so they were never covered by the owner's
-- unrestricted write policy in the first place).
create or replace function public.organizer_cancel_tournament(p_tournament_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare did_update boolean; is_locked boolean;
begin
  if not public.is_tournament_manager_or_owner(p_tournament_id) then
    raise exception 'not authorized';
  end if;
  select locked into is_locked from public.tournaments where id = p_tournament_id;
  if is_locked and not public.is_admin() then
    raise exception 'tournament is locked — unlock it first';
  end if;
  update public.tournaments set status = 'cancelled', updated_at = now() where id = p_tournament_id;
  did_update := found;
  return did_update;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tournament Organizer Control Center — Phase 5: real, account-linked team
-- rosters. Deliberately additive and opt-in: the existing JSONB
-- `tournaments.data.teams[].id` + `teams.data.players` (plain name strings,
-- matched by string — see rosterFor() in app.js) keep working completely
-- unchanged for every tournament that never touches this. These two new
-- tables are a SEPARATE, parallel roster an organizer can build for a
-- tournament team, linked back to the JSONB team via `local_team_id` only
-- for the app's own convenience when it wants to show both side by side —
-- nothing here rewrites or depends on the JSONB shape.
--
-- Every write goes through a function (same reasoning as tournament_roles
-- in Phase 2): no INSERT/UPDATE/DELETE policy on either table at all.
-- ---------------------------------------------------------------------------
create table if not exists public.tournament_teams (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  text not null references public.tournaments(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 40),
  -- Optional pointer back to the corresponding entry in the tournament's
  -- own data.teams[] array (a local, tournament-scoped id — see
  -- tournament.js) — null if this roster was created standalone. Not a
  -- foreign key: that id only ever exists inside JSONB, there's no table
  -- Postgres could reference.
  local_team_id  text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.tournament_teams enable row level security;

-- The full policy (including the "roster member" clause) is added further
-- down, right after tournament_team_players is created — that clause
-- subqueries a table that doesn't exist yet at this point in the file,
-- exactly the same circular-ordering situation as notifications /
-- notification_recipients earlier in this file (see that comment for the
-- general shape of the problem). This first policy covers everyone except
-- a roster member who isn't also a role holder; it's superseded/widened by
-- the second one below the moment that table exists — DROP POLICY IF
-- EXISTS on the same name makes re-running this file safe either way.
drop policy if exists "role holder, public tournament, roster member, or admin can read a team" on public.tournament_teams;
create policy "role holder, public tournament, roster member, or admin can read a team"
  on public.tournament_teams for select
  using (
    public.is_admin()
    or public.has_tournament_role(tournament_id, array['owner','manager','scorer','official'])
    or exists(select 1 from public.tournaments t where t.id = tournament_teams.tournament_id and t.is_public)
  );

create table if not exists public.tournament_team_players (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.tournament_teams(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'invited' check (status in ('invited','accepted','declined')),
  is_captain  boolean not null default false,
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, user_id)
);

alter table public.tournament_team_players enable row level security;

drop policy if exists "player themself, role holder, public tournament, or admin can read a roster row" on public.tournament_team_players;
create policy "player themself, role holder, public tournament, or admin can read a roster row"
  on public.tournament_team_players for select
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists(
      select 1 from public.tournament_teams tt
      where tt.id = tournament_team_players.team_id
        and (
          public.has_tournament_role(tt.tournament_id, array['owner','manager','scorer','official'])
          or exists(select 1 from public.tournaments t where t.id = tt.tournament_id and t.is_public)
        )
    )
  );

-- Deferred here from right after tournament_teams was created — see the
-- comment there. Widens that table's SELECT policy with the one clause that
-- needed tournament_team_players to exist first: a player can now also read
-- the team row for a roster they're personally on, even for a private
-- tournament they hold no role in (e.g. a player invited onto a team in a
-- private, invite-only tournament — they need to see the team's own name to
-- make sense of their invite).
drop policy if exists "role holder, public tournament, roster member, or admin can read a team" on public.tournament_teams;
create policy "role holder, public tournament, roster member, or admin can read a team"
  on public.tournament_teams for select
  using (
    public.is_admin()
    or public.has_tournament_role(tournament_id, array['owner','manager','scorer','official'])
    or exists(select 1 from public.tournaments t where t.id = tournament_teams.tournament_id and t.is_public)
    or exists(select 1 from public.tournament_team_players p where p.team_id = tournament_teams.id and p.user_id = auth.uid())
  );

create or replace function public.create_tournament_team(p_tournament_id text, p_name text, p_local_team_id text default null)
returns public.tournament_teams
language plpgsql
security definer
set search_path = public
as $$
declare row public.tournament_teams;
begin
  if not public.is_tournament_manager_or_owner(p_tournament_id) then
    raise exception 'not authorized';
  end if;
  insert into public.tournament_teams (tournament_id, name, local_team_id, created_by)
    values (p_tournament_id, p_name, p_local_team_id, auth.uid())
  returning * into row;
  return row;
end;
$$;

-- Re-inviting a player who previously declined resets them back to
-- 'invited' (a change of heart on the organizer's side); re-inviting
-- someone already invited or accepted is a harmless no-op on their status.
create or replace function public.invite_player_to_team(p_team_id uuid, p_user_id uuid)
returns public.tournament_team_players
language plpgsql
security definer
set search_path = public
as $$
declare row public.tournament_team_players; v_tournament_id text;
begin
  select tournament_id into v_tournament_id from public.tournament_teams where id = p_team_id;
  if v_tournament_id is null then
    raise exception 'team not found';
  end if;
  if not public.is_tournament_manager_or_owner(v_tournament_id) then
    raise exception 'not authorized';
  end if;
  insert into public.tournament_team_players (team_id, user_id, status, invited_by)
    values (p_team_id, p_user_id, 'invited', auth.uid())
  on conflict (team_id, user_id) do update
    set status = case when public.tournament_team_players.status = 'declined' then 'invited' else public.tournament_team_players.status end,
        invited_by = excluded.invited_by, updated_at = now()
  returning * into row;
  return row;
end;
$$;

-- Self-service accept/decline — mirrors respond_to_connection() above: only
-- the invited player themselves can call this, and only while their row is
-- still genuinely pending.
create or replace function public.respond_to_team_invite(p_team_id uuid, p_accept boolean)
returns public.tournament_team_players
language plpgsql
security definer
set search_path = public
as $$
declare row public.tournament_team_players;
begin
  select * into row from public.tournament_team_players where team_id = p_team_id and user_id = auth.uid();
  if row is null then
    raise exception 'No invite found';
  end if;
  if row.status <> 'invited' then
    raise exception 'No pending invite to respond to';
  end if;
  update public.tournament_team_players
    set status = case when p_accept then 'accepted' else 'declined' end, updated_at = now()
    where id = row.id
  returning * into row;
  return row;
end;
$$;

-- Only one captain per team: clears any existing captain on the same team
-- before setting the new one, in the same transaction. Requires the target
-- to have actually accepted — can't captain someone who never joined.
create or replace function public.set_team_captain(p_team_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_tournament_id text; target_status text;
begin
  select tournament_id into v_tournament_id from public.tournament_teams where id = p_team_id;
  if v_tournament_id is null then
    raise exception 'team not found';
  end if;
  if not public.is_tournament_manager_or_owner(v_tournament_id) then
    raise exception 'not authorized';
  end if;
  select status into target_status from public.tournament_team_players where team_id = p_team_id and user_id = p_user_id;
  if target_status is null then
    raise exception 'player is not on this team';
  end if;
  if target_status <> 'accepted' then
    raise exception 'player has not accepted their invite yet';
  end if;
  update public.tournament_team_players set is_captain = false, updated_at = now()
    where team_id = p_team_id and is_captain = true and user_id <> p_user_id;
  update public.tournament_team_players set is_captain = true, updated_at = now()
    where team_id = p_team_id and user_id = p_user_id;
  return true;
end;
$$;

-- Owner/manager can remove anyone; a player can always remove themselves
-- (leave the roster) regardless of role.
create or replace function public.remove_team_player(p_team_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_tournament_id text; did_delete boolean;
begin
  select tournament_id into v_tournament_id from public.tournament_teams where id = p_team_id;
  if v_tournament_id is null then
    raise exception 'team not found';
  end if;
  if not (p_user_id = auth.uid() or public.is_tournament_manager_or_owner(v_tournament_id)) then
    raise exception 'not authorized';
  end if;
  delete from public.tournament_team_players where team_id = p_team_id and user_id = p_user_id;
  did_delete := found;
  return did_delete;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tournament Organizer Control Center — Phase 6: fixtures as real rows.
--
-- Deliberate scope decision, written down here because it's a real
-- trade-off, not an accident: tournament.js's data.fixtures/data.knockout
-- JSONB arrays remain the ACTUAL source of truth. Nothing about how app.js
-- reads or writes a tournament's fixtures changes in this migration — every
-- existing render/mutate call path (play a fixture, regenerate fixtures,
-- generate the bracket, set a fixture date) keeps working exactly as
-- before, completely untouched. This table is a read-only SHADOW copy, kept
-- in sync by the trigger below every time a tournament row is written.
--
-- Why not a full cutover (JSONB removed, this table becomes the only
-- source of truth)? That would mean rewriting every one of those call
-- sites in the same pass, with no live database available to verify the
-- rewrite against — exactly the kind of change the audit report flagged as
-- highest-risk (see TOURNAMENT_ORGANIZER_CONTROL_CENTER_AUDIT.md, "Tournament
-- ownership semantics change under load-bearing code"). The shadow-table
-- approach gets the thing Phase 7 actually needs — a real row per fixture
-- that can hold new columns like an assigned scorer — without touching a
-- single line of existing, working code. A full cutover remains a
-- reasonable follow-up once this has been run against the live app for a
-- while with no surprises.
-- ---------------------------------------------------------------------------
create table if not exists public.fixtures (
  id             text primary key,   -- same id tournament.js's makeId() already generates in the JSONB — not a new id space
  tournament_id  text not null references public.tournaments(id) on delete cascade,
  stage          text not null default 'league',
  round          integer,
  team_a_id      text,
  team_b_id      text,
  fixture_date   timestamptz,
  venue          text not null default '',
  match_id       text,
  status         text not null default 'scheduled',
  result         jsonb,
  depends_on     jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.fixtures enable row level security;

-- No insert/update/delete policy for any role — every write comes from the
-- SECURITY DEFINER trigger function below (or, from Phase 7 on, the
-- assign/unassign-official functions), never a direct client write.
drop policy if exists "role holder, public tournament, or admin can read a fixture" on public.fixtures;
create policy "role holder, public tournament, or admin can read a fixture"
  on public.fixtures for select
  using (
    public.is_admin()
    or public.has_tournament_role(tournament_id, array['owner','manager','scorer','official'])
    or exists(select 1 from public.tournaments t where t.id = fixtures.tournament_id and t.is_public)
  );

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
      match_id, status, result, depends_on, updated_at
    ) values (
      fx_id, new.id, coalesce(fx->>'stage', 'league'),
      nullif(fx->>'round', '')::int,
      fx->>'teamAId', fx->>'teamBId',
      case when fx->>'date' is not null and fx->>'date' <> '' then (fx->>'date')::timestamptz else null end,
      coalesce(fx->>'venue', ''), fx->>'matchId', coalesce(fx->>'status', 'scheduled'),
      fx->'result', fx->'dependsOn', now()
    )
    on conflict (id) do update set
      tournament_id = excluded.tournament_id, stage = excluded.stage, round = excluded.round,
      team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id,
      fixture_date = excluded.fixture_date, venue = excluded.venue,
      match_id = excluded.match_id, status = excluded.status,
      result = excluded.result, depends_on = excluded.depends_on, updated_at = now();
  end loop;

  -- Anything no longer present in the JSONB (a regenerated fixture list, a
  -- reset bracket) is gone from the source of truth, so it's gone here too
  -- — this is what keeps a shadow table from silently accumulating stale
  -- rows for fixtures that don't exist anymore.
  delete from public.fixtures
    where tournament_id = new.id
      and not (id = any(seen_ids));

  return new;
end;
$$;

drop trigger if exists trg_sync_fixtures on public.tournaments;
create trigger trg_sync_fixtures
  after insert or update on public.tournaments
  for each row execute function public.sync_fixtures_from_tournament();

-- One-time backfill for every tournament that already existed before this
-- migration — assigning a column to itself still fires the AFTER UPDATE
-- trigger without actually changing updated_at (so this doesn't disturb
-- fetchPublicTournaments()'s "recently updated" ordering). Safe to run
-- again: the trigger's own upsert/delete logic is idempotent.
update public.tournaments set updated_at = updated_at;

-- ---------------------------------------------------------------------------
-- Tournament Organizer Control Center — Phase 7: scorer/official assignment
-- + live-scoring access.
--
-- Honest trade-off, written down rather than hidden: the ideal design would
-- let an assigned scorer write ONLY the one fixture they're assigned to,
-- nothing else about the tournament. That's not what this migration does.
-- Instead, a scorer/official is added to the SAME tournaments UPDATE policy
-- 'manager' got in Phase 4 — meaning an assigned scorer/official gets the
-- same row-level write ceiling as a manager for the tournament they're
-- assigned into, not a narrower one.
--
-- Why: the actually-narrow version (a function that writes only to the new
-- `fixtures` row for that one fixture) would leave a real correctness gap —
-- tournament.js's standings/knockout-advancement logic reads
-- tournaments.data.fixtures/knockout, not the fixtures table (Phase 6's
-- shadow table is a read path for row-level features, not what the app
-- renders standings from). A scorer who could only write to `fixtures`
-- would have their completed match invisibly excluded from the points
-- table until an owner/manager happened to resave the tournament — a
-- silent data-integrity bug that would be worse than the over-grant this
-- migration accepts instead. Building the reverse sync (fixtures ->
-- tournaments.data) to close that gap properly is real, but meaningfully
-- riskier work than fits safely in this pass — see this file's Phase 6
-- comment for the same reasoning applied there.
--
-- What actually limits a scorer/official in practice today: the app's own
-- UI only ever shows them fixture-scoring actions for a fixture they're
-- assigned to (see app.js's canScoreFixture()) — this migration is the
-- server-side ceiling, not the intended floor, exactly like the existing
-- "manager can edit anything, UI only shows fixture tools" situation this
-- extends. Tightening this later (once the reverse sync exists) is a
-- straightforward follow-up: swap 'scorer','official' back out of this
-- policy and give them the narrow fixtures-only function instead.
-- ---------------------------------------------------------------------------

alter table public.fixtures add column if not exists assigned_scorer_uid   uuid references auth.users(id);
alter table public.fixtures add column if not exists assigned_official_uid uuid references auth.users(id);

drop policy if exists "manager can update tournament details" on public.tournaments;
create policy "manager can update tournament details"
  on public.tournaments for update
  using (
    public.has_tournament_role(tournaments.id, array['manager','scorer','official'])
    and not tournaments.locked
  )
  with check (
    public.has_tournament_role(tournaments.id, array['manager','scorer','official'])
    and not tournaments.locked
    and user_id = (select user_id from public.tournaments t2 where t2.id = tournaments.id)
  );

create or replace function public.assign_fixture_role(p_fixture_id text, p_user_id uuid, p_role text)
returns public.fixtures
language plpgsql
security definer
set search_path = public
as $$
declare row public.fixtures; v_tournament_id text;
begin
  if p_role not in ('scorer','official') then
    raise exception 'invalid role for a fixture assignment: %', p_role;
  end if;
  select tournament_id into v_tournament_id from public.fixtures where id = p_fixture_id;
  if v_tournament_id is null then
    raise exception 'fixture not found';
  end if;
  if not public.is_tournament_manager_or_owner(v_tournament_id) then
    raise exception 'not authorized';
  end if;
  -- Being assignable at all requires the target user actually holding that
  -- role on the tournament (tournament_roles, granted via
  -- grant_tournament_role — see Phase 2) — assigning someone as fixture
  -- scorer who was never granted the 'scorer' role would let them into the
  -- manager-tier write policy above with no corresponding role row
  -- explaining why. has_tournament_role() checks auth.uid() (the caller),
  -- so this checks the target user directly instead.
  if not exists(
    select 1 from public.tournament_roles
    where tournament_id = v_tournament_id and user_id = p_user_id and role = p_role
  ) then
    raise exception 'that person must hold the % role on this tournament before being assigned a fixture', p_role;
  end if;
  update public.fixtures set
    assigned_scorer_uid   = case when p_role = 'scorer'   then p_user_id else assigned_scorer_uid   end,
    assigned_official_uid = case when p_role = 'official' then p_user_id else assigned_official_uid end,
    updated_at = now()
  where id = p_fixture_id
  returning * into row;
  return row;
end;
$$;

create or replace function public.unassign_fixture_role(p_fixture_id text, p_role text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_tournament_id text; did_update boolean;
begin
  if p_role not in ('scorer','official') then
    raise exception 'invalid role for a fixture assignment: %', p_role;
  end if;
  select tournament_id into v_tournament_id from public.fixtures where id = p_fixture_id;
  if v_tournament_id is null then
    raise exception 'fixture not found';
  end if;
  if not public.is_tournament_manager_or_owner(v_tournament_id) then
    raise exception 'not authorized';
  end if;
  update public.fixtures set
    assigned_scorer_uid   = case when p_role = 'scorer'   then null else assigned_scorer_uid   end,
    assigned_official_uid = case when p_role = 'official' then null else assigned_official_uid end,
    updated_at = now()
  where id = p_fixture_id;
  did_update := found;
  return did_update;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tournament Organizer Control Center — Phase 8: communication. Reuses the
-- entire existing push-notification pipeline (templates, notifications,
-- notification_recipients, notification_devices, the two Edge Functions) —
-- nothing about that infrastructure is rebuilt here. This adds three new
-- audience types that are only resolvable now that Phase 2 (tournament_roles)
-- and Phase 5 (tournament_team_players) give real user ids to work from —
-- the original notifications migration's own comment flagged this exact
-- extension as the reason "team members"/"tournament followers" weren't
-- offered as audiences from day one.
--
-- Organizer-created notifications are scoped and narrow by construction:
-- organizer_create_notification() below refuses anything except these three
-- tournament-scoped audience types, and cross-checks the audience_filter
-- actually points at the caller's own tournament/team — an owner of
-- Tournament A can never use this to message Tournament B's participants.
-- Sending it still goes through the SAME Edge Function as an admin send;
-- that function's own authorization was widened to accept a tournament
-- owner/manager sending their own tournament-scoped notification — see
-- supabase/functions/send-notification/index.ts.
-- ---------------------------------------------------------------------------

do $$
declare con text;
begin
  select conname into con
    from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%audience_type%';
  if con is not null then
    execute format('alter table public.notifications drop constraint %I', con);
  end if;
end $$;

alter table public.notifications add constraint notifications_audience_type_check
  check (audience_type in (
    'all','players','organisers','country','city','selected','user',
    'tournament_participants','team_members','tournament_officials'
  ));

-- A creator can always read back what they created — previously only
-- admins and actual recipients could read a notification row at all, which
-- never mattered while only admins could create one.
drop policy if exists "admin or recipient can read a notification" on public.notifications;
create policy "admin or recipient can read a notification"
  on public.notifications for select
  using (
    public.is_admin()
    or created_by = auth.uid()
    or exists(
      select 1 from public.notification_recipients nr
      where nr.notification_id = notifications.id and nr.user_id = auth.uid()
    )
  );

-- Mirrors resolve_notification_audience() below for the three new
-- audience types. is_admin()-gated call is untouched for every existing
-- audience type; a tournament owner/manager may now ALSO preview a count
-- for one of the three tournament-scoped types on their own tournament —
-- this is what lets the organizer's compose UI show "Send to N people?"
-- the same way the admin panel already does.
create or replace function public.resolve_notification_audience(p_audience_type text, p_filter jsonb default '{}'::jsonb)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_tournament_id text;
begin
  if p_audience_type in ('tournament_participants','tournament_officials') then
    v_tournament_id := p_filter->>'tournament_id';
  elsif p_audience_type = 'team_members' then
    select tournament_id into v_tournament_id from public.tournament_teams where id = (p_filter->>'team_id')::uuid;
  end if;

  if not (
    public.is_admin()
    or (v_tournament_id is not null and public.is_tournament_manager_or_owner(v_tournament_id))
  ) then
    raise exception 'not authorized';
  end if;

  if p_audience_type = 'all' then
    return query select id from public.profiles;
  elsif p_audience_type = 'players' then
    return query select id from public.profiles where is_organiser = false;
  elsif p_audience_type = 'organisers' then
    return query select id from public.profiles where is_organiser = true;
  elsif p_audience_type = 'country' then
    return query select id from public.profiles
      where p_filter->>'country' is not null and lower(country) = lower(p_filter->>'country');
  elsif p_audience_type = 'city' then
    return query select id from public.profiles
      where p_filter->>'district' is not null and lower(district) = lower(p_filter->>'district');
  elsif p_audience_type = 'selected' then
    return query select id from public.profiles
      where id = any(
        (select array_agg((x)::uuid) from jsonb_array_elements_text(coalesce(p_filter->'user_ids', '[]'::jsonb)) x)
      );
  elsif p_audience_type = 'user' then
    return query select id from public.profiles where id = (p_filter->>'user_id')::uuid;
  elsif p_audience_type = 'tournament_participants' then
    return query select distinct p.user_id from public.tournament_team_players p
      join public.tournament_teams tt on tt.id = p.team_id
      where tt.tournament_id = p_filter->>'tournament_id' and p.status = 'accepted';
  elsif p_audience_type = 'tournament_officials' then
    return query select user_id from public.tournament_roles where tournament_id = p_filter->>'tournament_id';
  elsif p_audience_type = 'team_members' then
    return query select user_id from public.tournament_team_players
      where team_id = (p_filter->>'team_id')::uuid and status = 'accepted';
  else
    raise exception 'unknown audience_type: %', p_audience_type;
  end if;
end;
$$;

create or replace function public.organizer_create_notification(
  p_tournament_id text, p_type text, p_title text, p_message text,
  p_audience_type text, p_audience_filter jsonb,
  p_action_type text default 'open_tournament', p_action_target text default null
)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare row public.notifications; v_team_tournament text; v_target text;
begin
  if not public.is_tournament_manager_or_owner(p_tournament_id) then
    raise exception 'not authorized';
  end if;
  if p_audience_type not in ('tournament_participants','team_members','tournament_officials') then
    raise exception 'organizers can only send to tournament-scoped audiences';
  end if;
  if p_audience_type = 'team_members' then
    select tournament_id into v_team_tournament from public.tournament_teams where id = (p_audience_filter->>'team_id')::uuid;
    if v_team_tournament is distinct from p_tournament_id then
      raise exception 'that team does not belong to this tournament';
    end if;
  else
    if coalesce(p_audience_filter->>'tournament_id', '') <> p_tournament_id then
      raise exception 'audience filter must target this tournament';
    end if;
  end if;
  v_target := coalesce(p_action_target, case when coalesce(p_action_type, 'open_tournament') = 'open_tournament' then p_tournament_id else null end);
  insert into public.notifications (
    type, title, message, action_type, action_target, audience_type, audience_filter, created_by, status
  ) values (
    coalesce(p_type, 'tournament'), p_title, p_message, coalesce(p_action_type, 'open_tournament'), v_target,
    p_audience_type, p_audience_filter, auth.uid(), 'draft'
  ) returning * into row;
  return row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tournament Organizer Control Center — Phase 9: statistics + disputes.
--
-- Statistics: the existing `matches` RLS (see the shared do-loop near the
-- top of this file) is strictly owner-only + admin — a tournament owner/
-- manager currently can't read a match that an assigned scorer scored
-- themselves, even though the small result summary already gets copied into
-- the tournament's own JSONB via linkResultToTournament() at score-time (so
-- standings/knockout progression already work today). Real cross-scorer
-- tournament statistics need the full ball-by-ball data, not just that
-- summary, so this adds ONE more additive, precisely-scoped SELECT policy —
-- never touching the shared loop or its two existing policies on `matches`.
-- ---------------------------------------------------------------------------
drop policy if exists "tournament owner or manager can read tournament matches" on public.matches;
create policy "tournament owner or manager can read tournament matches"
  on public.matches for select
  using (
    data->>'tournamentId' is not null
    and public.is_tournament_manager_or_owner(data->>'tournamentId')
  );

-- ---------------------------------------------------------------------------
-- Disputes: RPC-only writes, same pattern as every other Phase 2+ table in
-- this file (tournament_roles, tournament_teams, tournament_team_players,
-- fixtures) — no client-side insert/update/delete policy at all, so the two
-- functions below are the only way a row in this table is ever created or
-- changed, and both re-check authorization themselves.
-- ---------------------------------------------------------------------------
create table if not exists public.tournament_disputes (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   text not null references public.tournaments(id) on delete cascade,
  fixture_id      text references public.fixtures(id) on delete set null,
  raised_by       uuid not null references auth.users(id) on delete cascade,
  category        text not null default 'other' check (category in ('scoring','conduct','scheduling','eligibility','other')),
  description     text not null,
  status          text not null default 'open' check (status in ('open','under_review','resolved','dismissed')),
  resolution_note text,
  resolved_by     uuid references auth.users(id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.tournament_disputes enable row level security;

create index if not exists tournament_disputes_tournament_idx on public.tournament_disputes(tournament_id);

drop policy if exists "raiser or organizer or admin can read a dispute" on public.tournament_disputes;
create policy "raiser or organizer or admin can read a dispute"
  on public.tournament_disputes for select
  using (
    raised_by = auth.uid()
    or public.is_admin()
    or public.is_tournament_manager_or_owner(tournament_id)
  );

create or replace function public.raise_dispute(
  p_tournament_id text, p_fixture_id text default null,
  p_category text default 'other', p_description text default ''
)
returns public.tournament_disputes
language plpgsql
security definer
set search_path = public
as $$
declare row public.tournament_disputes;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'description is required';
  end if;
  if not exists (select 1 from public.tournaments where id = p_tournament_id) then
    raise exception 'tournament not found';
  end if;
  if p_fixture_id is not null and not exists (
    select 1 from public.fixtures where id = p_fixture_id and tournament_id = p_tournament_id
  ) then
    raise exception 'that fixture does not belong to this tournament';
  end if;
  insert into public.tournament_disputes (tournament_id, fixture_id, raised_by, category, description)
  values (p_tournament_id, p_fixture_id, auth.uid(), coalesce(p_category, 'other'), trim(p_description))
  returning * into row;
  return row;
end;
$$;

-- Owner/manager/admin only — resolving a dispute someone else raised, so
-- there's no "resolve my own dispute" self-service path, deliberately.
create or replace function public.resolve_dispute(
  p_dispute_id uuid, p_status text, p_resolution_note text default null
)
returns public.tournament_disputes
language plpgsql
security definer
set search_path = public
as $$
declare row public.tournament_disputes;
begin
  select * into row from public.tournament_disputes where id = p_dispute_id;
  if row is null then
    raise exception 'dispute not found';
  end if;
  if not (public.is_admin() or public.is_tournament_manager_or_owner(row.tournament_id)) then
    raise exception 'not authorized';
  end if;
  if p_status not in ('open', 'under_review', 'resolved', 'dismissed') then
    raise exception 'invalid status';
  end if;
  update public.tournament_disputes set
    status = p_status,
    resolution_note = coalesce(p_resolution_note, resolution_note),
    resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() else resolved_by end,
    resolved_at = case when p_status in ('resolved', 'dismissed') then now() else resolved_at end,
    updated_at = now()
  where id = p_dispute_id
  returning * into row;
  return row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tournament Organizer Control Center — Phase 10: completion + verification.
--
-- verified_at/verified_by are admin-only, and once set the tournament row is
-- immutably locked to non-admin writes — not by redefining the shared
-- "owner has full access" policy (that policy also governs SELECT, and
-- narrowing it here would risk hiding a verified tournament from its own
-- owner, plus it's shared machinery from the do-loop near the top of this
-- file that this whole project has deliberately never touched). Instead
-- this adds two new RESTRICTIVE policies, table-specific to `tournaments`
-- only. A RESTRICTIVE policy is ANDed against every PERMISSIVE policy for
-- the same command (Postgres RLS semantics), so once verified_at is set,
-- NEITHER "owner has full access" NOR "manager can update tournament
-- details" can write to this row anymore, full stop — while SELECT is
-- completely unaffected, so the owner keeps seeing their own verified
-- tournament. The one remaining write path is admin_unverify_tournament()
-- below: it runs SECURITY DEFINER, which (like every other admin-only
-- mutation in this file, e.g. admin_cancel_tournament) executes as the
-- function's owner and bypasses RLS entirely, so this restriction never
-- blocks the admin undo path.
-- ---------------------------------------------------------------------------
alter table public.tournaments add column if not exists verified_at timestamptz;
alter table public.tournaments add column if not exists verified_by uuid references auth.users(id);

drop policy if exists "verified tournaments are locked to non-admin writes" on public.tournaments;
create policy "verified tournaments are locked to non-admin writes"
  on public.tournaments as restrictive for update
  using (verified_at is null);

drop policy if exists "verified tournaments cannot be deleted" on public.tournaments;
create policy "verified tournaments cannot be deleted"
  on public.tournaments as restrictive for delete
  using (verified_at is null);

-- Real completion, not a client-supplied claim: every league fixture must
-- be completed or no-result, and for a knockout/league-knockout format the
-- final specifically must be completed with a result — mirrors
-- tournamentChampion()/leagueComplete() in tournament.js exactly, but reads
-- from the Phase 6 `fixtures` shadow table so it can't be fooled by a stale
-- or tampered local copy of the tournament's JSONB.
create or replace function public.is_tournament_complete(p_tournament_id text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_format text;
  v_league_count int;
  v_final record;
begin
  select format into v_format from public.tournaments where id = p_tournament_id;
  if v_format is null then
    return false;
  end if;

  select count(*) into v_league_count from public.fixtures
    where tournament_id = p_tournament_id and stage = 'league';
  if v_league_count = 0 then
    return false;
  end if;
  if exists (
    select 1 from public.fixtures
    where tournament_id = p_tournament_id and stage = 'league'
      and status not in ('completed', 'no-result')
  ) then
    return false;
  end if;

  if v_format = 'league' then
    return true;
  end if;

  select status, result into v_final from public.fixtures
    where tournament_id = p_tournament_id and stage = 'final'
    limit 1;
  if not found then
    return false;
  end if;
  return v_final.status = 'completed' and v_final.result is not null;
end;
$$;

create or replace function public.admin_verify_tournament(p_tournament_id text)
returns public.tournaments
language plpgsql
security definer
set search_path = public
as $$
declare row public.tournaments;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if not public.is_tournament_complete(p_tournament_id) then
    raise exception 'this tournament is not actually complete yet — every league fixture (and the final, for knockout formats) needs a result first';
  end if;
  update public.tournaments set verified_at = now(), verified_by = auth.uid(), updated_at = now()
    where id = p_tournament_id
    returning * into row;
  if row is null then
    raise exception 'tournament not found';
  end if;
  return row;
end;
$$;

-- Admin-only undo path — see the RESTRICTIVE policy comment above for why
-- this is the only way a verified tournament's lock is ever lifted.
create or replace function public.admin_unverify_tournament(p_tournament_id text)
returns public.tournaments
language plpgsql
security definer
set search_path = public
as $$
declare row public.tournaments;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.tournaments set verified_at = null, verified_by = null, updated_at = now()
    where id = p_tournament_id
    returning * into row;
  if row is null then
    raise exception 'tournament not found';
  end if;
  return row;
end;
$$;

-- Read-only reward-eligibility foundation — no reward logic itself lives
-- here yet. Counts by tournament_roles' 'owner' role rather than the raw
-- user_id column, since tournament_roles (Phase 2) is the authoritative
-- source of who organizes a tournament today. Unrestricted, like is_admin()
-- and every other small stat helper in this file — a count is not
-- sensitive, and this is what the Profile screen's "Organizer Progress"
-- card will call for any profile it's showing, not just the signed-in user.
create or replace function public.organiser_verified_tournament_count(p_uid uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select count(distinct t.id)::int
  from public.tournaments t
  join public.tournament_roles r on r.tournament_id = t.id and r.user_id = p_uid and r.role = 'owner'
  where t.verified_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap: run this yourself once, after you've signed up in the app, to
-- become the first admin. Replace with your actual auth user id.
-- ---------------------------------------------------------------------------
-- insert into public.admins (uid) values ('paste-your-user-id-here');
