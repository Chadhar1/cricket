-- ============================================================================
-- CricketConnect — Tournament Organizer Control Center
-- Phases 8, 9, 10 migration
--
-- HOW TO RUN THIS: Supabase dashboard -> SQL Editor -> New query -> paste
-- this whole file -> Run. Safe to run again if needed (every CREATE TABLE
-- uses IF NOT EXISTS, every policy is DROP-then-CREATE, every function is
-- CREATE OR REPLACE, every ALTER TABLE ADD COLUMN uses IF NOT EXISTS).
--
-- This assumes Phases 1-7 have already been run — see
-- supabase_phase5_7_migration.sql for Phases 5-7, and supabase.sql for the
-- complete schema including Phases 1-4. In particular this needs:
--   is_tournament_manager_or_owner(), has_tournament_role() (Phase 2/4)
--   tournament_teams, tournament_team_players (Phase 5)
--   fixtures (Phase 6, synced from tournaments.data.fixtures/.knockout)
--   the notifications/notification_recipients/notification_devices tables
--   and the send-notification / dispatch-scheduled Edge Functions (from the
--   earlier, separate notification-system migration)
--
-- After running this, also redeploy the two Edge Functions with their
-- Phase 8 changes:
--   supabase functions deploy send-notification
--   supabase functions deploy dispatch-scheduled   (only if you also use
--     scheduled/templated sends — its _shared/notify.ts twin changed too)
-- ============================================================================

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
