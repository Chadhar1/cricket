import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./constants";

// Read-only browser client hitting the same Supabase project the live app
// uses. live_matches has a public "anyone can read" RLS policy, so this is
// the one section of the landing page that shows real data instead of a
// mock — if nobody happens to be scoring a match right now, we fall back to
// a clearly-labelled preview state instead of pretending.
export const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

export type LiveMatchRow = {
  id: string;
  data: Record<string, unknown>;
  live: boolean;
  updated_at: string;
};

export async function fetchLiveMatches(limit = 6): Promise<LiveMatchRow[]> {
  try {
    const { data, error } = await supabasePublic
      .from("live_matches")
      .select("id, data, live, updated_at")
      .eq("live", true)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

export type ParsedLiveMatch = {
  id: string;
  teamA: string;
  teamB: string;
  battingTeamName: string;
  bowlingTeamName: string;
  runs: number;
  wickets: number;
  oversStr: string;
  oversLimit: number;
  runRate: string;
};

function fmtOvers(legalBalls: number) {
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
}

// engine.js's match shape (see legacy-app/engine.js). Read defensively —
// this is a live JSON blob written by whatever the scorer's device has
// open, not a fixed API contract.
export function parseLiveMatch(row: LiveMatchRow): ParsedLiveMatch | null {
  const m = row.data as {
    teamA?: string;
    teamB?: string;
    oversLimit?: number;
    currentInningsIdx?: number;
    innings?: { runs: number; wickets: number; legalBalls: number; battingTeam: "A" | "B" }[];
  };
  if (!m || !m.teamA || !m.teamB || !Array.isArray(m.innings)) return null;
  const inn = m.innings[m.currentInningsIdx ?? 0];
  if (!inn) return null;
  const battingName = inn.battingTeam === "A" ? m.teamA : m.teamB;
  const bowlingName = inn.battingTeam === "A" ? m.teamB : m.teamA;
  const legalBalls = inn.legalBalls ?? 0;
  const rr = legalBalls ? (inn.runs / (legalBalls / 6)).toFixed(2) : "0.00";
  return {
    id: row.id,
    teamA: m.teamA,
    teamB: m.teamB,
    battingTeamName: battingName,
    bowlingTeamName: bowlingName,
    runs: inn.runs ?? 0,
    wickets: inn.wickets ?? 0,
    oversStr: fmtOvers(legalBalls),
    oversLimit: m.oversLimit ?? 0,
    runRate: rr,
  };
}
