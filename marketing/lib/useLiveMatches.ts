"use client";

import { useEffect, useState } from "react";
import { fetchLiveMatches, parseLiveMatch, type ParsedLiveMatch } from "./supabase";

export function useLiveMatches(pollMs = 15000) {
  const [matches, setMatches] = useState<ParsedLiveMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const rows = await fetchLiveMatches(8);
      if (cancelled) return;
      const parsed = rows
        .map(parseLiveMatch)
        .filter((m): m is ParsedLiveMatch => m !== null);
      setMatches(parsed);
      setLoading(false);
    }

    load();
    const id = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  return { matches, loading, hasLive: matches.length > 0 };
}
