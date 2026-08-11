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

-- Admins see every notification (History tab). A regular user can see a
-- notification's own content only if they're an actual recipient of it —
-- this is what lets the in-app Notification Center join recipient rows back
-- to title/message/type/action without a second admin-only fetch.
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
-- Bootstrap: run this yourself once, after you've signed up in the app, to
-- become the first admin. Replace with your actual auth user id.
-- ---------------------------------------------------------------------------
-- insert into public.admins (uid) values ('paste-your-user-id-here');
