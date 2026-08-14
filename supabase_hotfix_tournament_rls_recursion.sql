-- ============================================================================
-- CricketConnect — HOTFIX: infinite RLS recursion on tournaments /
-- tournament_roles (Postgres error 42P17)
--
-- WHAT WAS BROKEN: tournaments' "tournament role holder can read their
-- tournament" SELECT policy did a raw subquery into tournament_roles, and
-- tournament_roles' own SELECT policy did a raw subquery back into
-- tournaments. Two RLS-protected tables each subquerying the other forms a
-- genuine cycle — reading either table re-triggers the other's policy
-- forever until Postgres gives up with "infinite recursion detected in
-- policy for relation ..." This broke every screen that reads tournaments
-- or tournament_roles (admin dashboard, tournament list, etc).
--
-- THE FIX: route both cross-table ownership checks through SECURITY
-- DEFINER functions instead of raw subqueries. A SECURITY DEFINER function
-- runs as its owner, which bypasses RLS entirely (this project never sets
-- FORCE ROW LEVEL SECURITY anywhere), so the call never re-enters the other
-- table's RLS and the cycle is broken for good. This is the same pattern
-- already used everywhere else in this schema (is_admin(),
-- has_tournament_role(), is_tournament_manager_or_owner()).
--
-- HOW TO RUN THIS: Supabase dashboard -> SQL Editor -> New query -> paste
-- this whole file -> Run. Safe to run again if needed (CREATE OR REPLACE
-- FUNCTION, DROP POLICY IF EXISTS + CREATE POLICY throughout).
--
-- This is also folded into the master supabase.sql file at its original
-- Phase 2 location, so a fresh run of the full schema already includes it.
-- ============================================================================

-- New helper — breaks the tournament_roles -> tournaments direction of the
-- cycle. Replaces a raw `exists(select 1 from public.tournaments ...)`
-- subquery in tournament_roles' SELECT policy below.
create or replace function public.is_tournament_creator(p_tournament_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(select 1 from public.tournaments where id = p_tournament_id and user_id = auth.uid());
$$;

drop policy if exists "role holder, tournament creator, or admin can read tournament roles" on public.tournament_roles;
create policy "role holder, tournament creator, or admin can read tournament roles"
  on public.tournament_roles for select
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_tournament_creator(tournament_roles.tournament_id)
  );

-- Breaks the tournaments -> tournament_roles direction of the cycle.
-- Replaces a raw `exists(select 1 from public.tournament_roles ...)`
-- subquery with the already-existing has_tournament_role() SECURITY
-- DEFINER function (it was defined for exactly this purpose but never
-- actually wired into this policy — that gap is the root cause of the bug).
drop policy if exists "tournament role holder can read their tournament" on public.tournaments;
create policy "tournament role holder can read their tournament"
  on public.tournaments for select
  using (
    public.has_tournament_role(tournaments.id, array['owner','manager','scorer','official'])
  );
