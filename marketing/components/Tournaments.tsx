"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarDays, Coins, MapPinned, Users } from "lucide-react";
import { Container, SectionHeading, GlassCard, PrimaryButton, Pill } from "./ui";
import { APP_LINKS } from "@/lib/constants";

const TOURNAMENTS = [
  {
    name: "Riverside Premier League",
    location: "Riverside Ground No. 2",
    prize: "$2,500",
    entry: "$120 / team",
    teams: "14 / 16",
    trending: true,
    daysFromNow: 12,
  },
  {
    name: "Harbour T20 Cup",
    location: "Port Ellery Stadium",
    prize: "$1,800",
    entry: "$90 / team",
    teams: "8 / 12",
    trending: false,
    daysFromNow: 26,
  },
  {
    name: "Meadow Community Shield",
    location: "Meadowbrook Oval",
    prize: "$900",
    entry: "Free",
    teams: "10 / 10",
    trending: true,
    daysFromNow: 5,
  },
];

function useCountdown(daysFromNow: number) {
  const [target] = useState(() => Date.now() + daysFromNow * 86400000);
  const [left, setLeft] = useState(target - Date.now());

  useEffect(() => {
    const id = setInterval(() => setLeft(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const clamped = Math.max(0, left);
  const d = Math.floor(clamped / 86400000);
  const h = Math.floor((clamped % 86400000) / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  return { d, h, m, s };
}

function Countdown({ days }: { days: number }) {
  const { d, h, m, s } = useCountdown(days);
  return (
    <div className="flex gap-2">
      {[
        { v: d, l: "D" },
        { v: h, l: "H" },
        { v: m, l: "M" },
        { v: s, l: "S" },
      ].map((u) => (
        <div
          key={u.l}
          className="flex min-w-[42px] flex-col items-center rounded-lg bg-white/5 px-2 py-1.5"
        >
          <span className="font-display text-sm font-bold text-ink tabular-nums">
            {String(u.v).padStart(2, "0")}
          </span>
          <span className="text-[9px] text-ink-soft">{u.l}</span>
        </div>
      ))}
    </div>
  );
}

export default function Tournaments() {
  return (
    <section id="tournaments" className="relative py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="Tournaments"
          title="Run a tournament like a pro."
          subtitle="Automatic fixtures, correct net run rate, seeded knockouts — organiser tools that used to take a spreadsheet and a headache."
        />

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {TOURNAMENTS.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <GlassCard className="flex h-full flex-col overflow-hidden !p-0">
                <div className="relative flex h-32 items-end bg-gradient-to-br from-primary via-secondary to-accent p-5">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.25),transparent_60%)]" />
                  {t.trending && (
                    <span className="absolute right-4 top-4 z-10">
                      <Pill tone="soon">🔥 Trending</Pill>
                    </span>
                  )}
                  <h3 className="relative font-display text-xl font-bold text-white drop-shadow">
                    {t.name}
                  </h3>
                </div>

                <div className="flex flex-1 flex-col gap-4 p-6">
                  <p className="flex items-center gap-2 text-sm text-ink-soft">
                    <MapPinned className="h-4 w-4 text-secondary" /> {t.location}
                  </p>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-white/5 px-3 py-2">
                      <p className="flex items-center gap-1 text-[11px] text-ink-soft">
                        <Coins className="h-3 w-3" /> Prize Pool
                      </p>
                      <p className="font-semibold text-ink">{t.prize}</p>
                    </div>
                    <div className="rounded-xl bg-white/5 px-3 py-2">
                      <p className="text-[11px] text-ink-soft">Entry Fee</p>
                      <p className="font-semibold text-ink">{t.entry}</p>
                    </div>
                    <div className="col-span-2 rounded-xl bg-white/5 px-3 py-2">
                      <p className="flex items-center gap-1 text-[11px] text-ink-soft">
                        <Users className="h-3 w-3" /> Registered Teams
                      </p>
                      <p className="font-semibold text-ink">{t.teams}</p>
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-ink-soft">
                      <CalendarDays className="h-3.5 w-3.5" /> Registration closes in
                    </p>
                    <Countdown days={t.daysFromNow} />
                  </div>

                  <PrimaryButton href={APP_LINKS.tournaments} className="mt-auto w-full">
                    Register
                  </PrimaryButton>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
