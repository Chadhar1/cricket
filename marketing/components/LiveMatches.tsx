"use client";

import { motion } from "framer-motion";
import { Radio, Eye } from "lucide-react";
import { Container, SectionHeading, GlassCard, Pill, SecondaryButton } from "./ui";
import { useLiveMatches } from "@/lib/useLiveMatches";
import { APP_LINKS } from "@/lib/constants";

const PREVIEW_MATCHES = [
  {
    id: "p1",
    teamA: "Riverside XI",
    teamB: "Northside CC",
    battingTeamName: "Riverside XI",
    runs: 142,
    wickets: 4,
    oversStr: "16.2",
    oversLimit: 20,
    runRate: "8.71",
    winProb: 64,
    partnership: "38 (22)",
  },
  {
    id: "p2",
    teamA: "Oakfield Titans",
    teamB: "Harbour Kings",
    battingTeamName: "Harbour Kings",
    runs: 89,
    wickets: 2,
    oversStr: "10.0",
    oversLimit: 20,
    runRate: "8.90",
    winProb: 52,
    partnership: "51 (34)",
  },
  {
    id: "p3",
    teamA: "Dockyard Strikers",
    teamB: "Meadow Lions",
    battingTeamName: "Meadow Lions",
    runs: 201,
    wickets: 6,
    oversStr: "20.0",
    oversLimit: 20,
    runRate: "10.05",
    winProb: 71,
    partnership: "19 (11)",
  },
];

export default function LiveMatches() {
  const { matches, hasLive, loading } = useLiveMatches();

  const cards = hasLive
    ? matches.map((m) => ({
        ...m,
        winProb: 50,
        partnership: "—",
      }))
    : PREVIEW_MATCHES;

  return (
    <section id="live" className="relative py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="Live Matches"
          title="Every ball, live."
          subtitle="Real ball-by-ball scoring from real matches — synced instantly the moment a scorer taps a run."
        />

        {!loading && !hasLive && (
          <p className="mx-auto mt-4 max-w-xl text-center text-xs text-ink-soft">
            Preview data shown below — no match is being scored live right this
            second. Start one from the app and it appears here in real time.
          </p>
        )}

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {cards.map((m, i) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <GlassCard className="flex h-full flex-col">
                <div className="mb-4 flex items-center justify-between">
                  <Pill tone="live">Live</Pill>
                  <span className="text-xs text-ink-soft">
                    Overs {m.oversStr} / {m.oversLimit}
                  </span>
                </div>

                <p className="text-sm font-medium text-ink-soft">
                  {m.teamA} <span className="opacity-60">vs</span> {m.teamB}
                </p>
                <p className="mt-1 text-sm text-ink-soft">{m.battingTeamName} batting</p>

                <p className="mt-3 font-display text-4xl font-extrabold text-gradient">
                  {m.runs}/{m.wickets}
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-white/5 px-3 py-2">
                    <p className="text-[11px] text-ink-soft">Run Rate</p>
                    <p className="font-semibold text-ink">{m.runRate}</p>
                  </div>
                  <div className="rounded-xl bg-white/5 px-3 py-2">
                    <p className="text-[11px] text-ink-soft">Partnership</p>
                    <p className="font-semibold text-ink">{m.partnership}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-soft">
                    <span>Win Probability</span>
                    <span className="font-semibold text-accent">{m.winProb}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all"
                      style={{ width: `${m.winProb}%` }}
                    />
                  </div>
                </div>

                <SecondaryButton
                  href={APP_LINKS.startScoring}
                  className="mt-6 w-full"
                >
                  <Eye className="h-4 w-4" />
                  Watch
                </SecondaryButton>
              </GlassCard>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <SecondaryButton href={APP_LINKS.startScoring} external>
            <Radio className="h-4 w-4" />
            Start scoring your own match
          </SecondaryButton>
        </div>
      </Container>
    </section>
  );
}
