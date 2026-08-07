-- ============================================================================
-- Cricket Connect — Supabase schema + Row Level Security
--
-- Run in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
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

create policy "profiles are readable by any signed-in user"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Nobody may create their own profile already flagged organiser/admin.
create policy "users can create their own profile"
  on public.profiles for insert
  with check (auth.uid() = id and is_admin = false and is_organiser = false);

-- Owner may edit their own presentation, but never their own handle or roles.
-- Admins may edit anything (that's how organiser/admin status is granted).
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

create policy "members or admin can read a connection"
  on public.connections for select
  using (auth.uid() = any(members) or public.is_admin());

create policy "either member can send a request"
  on public.connections for insert
  with check (
    auth.uid() = any(members)
    and requested_by = auth.uid()
    and status = 'pending'
    and array_length(members, 1) = 2
    and members[1] <> members[2]
  );

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

create policy "applicant or admin can read an application"
  on public.organiser_applications for select
  using (uid = auth.uid() or public.is_admin());

create policy "a signed-in user can apply"
  on public.organiser_applications for insert
  with check (uid = auth.uid() and status = 'pending');

-- Approve/reject are admin-only and go through the functions below so the
-- profile flag and the application status can never drift out of sync.
create policy "admin can update an application"
  on public.organiser_applications for update
  using (public.is_admin());

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

create policy "anyone can read a live match" on public.live_matches for select using (true);
create policy "owner can insert their live match" on public.live_matches for insert with check (user_id = auth.uid());
create policy "owner can update their live match" on public.live_matches for update using (user_id = auth.uid());
create policy "owner or admin can delete a live match" on public.live_matches for delete using (user_id = auth.uid() or public.is_admin());

-- Realtime: let the live viewer subscribe to score updates.
alter publication supabase_realtime add table public.live_matches;

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
-- Bootstrap: run this yourself once, after you've signed up in the app, to
-- become the first admin. Replace with your actual auth user id.
-- ---------------------------------------------------------------------------
-- insert into public.admins (uid) values ('paste-your-user-id-here');
