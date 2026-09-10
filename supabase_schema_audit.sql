-- ---------------------------------------------------------------------------
-- Schema audit — read-only. Checks every table, column, and function that
-- supabase.sql (and its two standalone companion files) expect to exist
-- against what's actually live in this Supabase project, so we know exactly
-- what's missing instead of guessing from one error at a time.
--
-- Run this in Supabase SQL Editor and look at rows where exists = false.
-- Changes nothing — safe to run any time.
-- ---------------------------------------------------------------------------

with expected_tables(name) as (
  values
  ('admins'),('profiles'),('connections'),('organiser_applications'),
  ('live_matches'),('feedback'),('notification_templates'),('notifications'),
  ('notification_recipients'),('notification_devices'),('tournament_roles'),
  ('tournament_teams'),('tournament_team_players'),('fixtures'),
  ('tournament_disputes'),('tournaments'),('matches')
),
expected_columns(tbl, col) as (
  values
  ('profiles','country'),('profiles','region'),('profiles','district'),('profiles','area'),
  ('profiles','points'),('profiles','streak_current'),('profiles','streak_longest'),('profiles','last_checkin'),
  ('profiles','batting_style'),('profiles','bowling_style'),('profiles','primary_role'),
  ('tournaments','is_public'),('tournaments','name'),('tournaments','location'),('tournaments','ground'),
  ('tournaments','start_date'),('tournaments','end_date'),('tournaments','description'),('tournaments','banner_url'),
  ('tournaments','entry_rules'),('tournaments','rules'),('tournaments','status'),('tournaments','locked'),
  ('tournaments','verified_at'),('tournaments','verified_by'),
  ('live_matches','location'),
  ('matches','cancelled'),
  ('fixtures','assigned_scorer_uid'),('fixtures','assigned_official_uid')
),
expected_functions(name) as (
  values
  ('is_admin'),('daily_check_in'),('respond_to_connection'),('approve_organiser_application'),
  ('reject_organiser_application'),('admin_cancel_tournament'),('admin_cancel_match'),
  ('resolve_notification_audience'),('count_registered_devices'),('is_tournament_creator'),
  ('has_tournament_role'),('grant_tournament_role'),('revoke_tournament_role'),
  ('tournament_owner_role_trigger'),('is_tournament_manager_or_owner'),('lock_tournament'),
  ('unlock_tournament'),('set_tournament_status'),('organizer_cancel_tournament'),
  ('create_tournament_team'),('invite_player_to_team'),('respond_to_team_invite'),
  ('set_team_captain'),('remove_team_player'),('sync_fixtures_from_tournament'),
  ('assign_fixture_role'),('unassign_fixture_role'),('organizer_create_notification'),
  ('raise_dispute'),('resolve_dispute'),('is_tournament_complete'),('admin_verify_tournament'),
  ('admin_unverify_tournament'),('organiser_verified_tournament_count')
)
select 'TABLE' as kind, name as object, (to_regclass('public.' || name) is not null) as exists
from expected_tables
union all
select 'COLUMN', tbl || '.' || col,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name = col)
from expected_columns
union all
select 'FUNCTION', name,
  exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = name)
from expected_functions
order by exists asc, kind, object;
