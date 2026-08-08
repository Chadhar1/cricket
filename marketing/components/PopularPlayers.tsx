"use client";

import { motion } from "framer-motion";
import { BadgeCheck, Heart } from "lucide-react";
import { Container, SectionHeading, GlassCard, PrimaryButton } from "./ui";
import { APP_LINKS } from "@/lib/constants";

const PLAYERS = [
  {
    initials: "AK",
    name: "Aman Kapoor",
    role: "All-rounder",
    avg: "42.8",
    sr: "138.4",
    econ: "6.9",
    verified: true,
    achievement: "3x Player of the Match",
    gradient: "from-primary to-secondary",
  },
  {
    initials: "SR",
    name: "Sana Rehman",
    role: "Opening Batter",
    avg: "51.2",
    sr: "121.7",
    econ: "—",
    verified: true,
    achievement: "Season top run-scorer",
    gradient: "from-secondary to-accent",
  },
  {
    initials: "DM",
    name: "Devon Marsh",
    role: "Fast Bowler",
    avg: "18.4",
    sr: "—",
    econ: "5.6",
    verified: false,
    achievement: "Hat-trick vs Oakfield",
    gradient: "from-accent to-primary",
  },
  {
    initials: "TN",
    name: "Tariq Nasser",
    role: "Wicketkeeper",
    avg: "36.9",
    sr: "129.1",
    econ: "—",
    verified: true,
    achievement: "Most dismissals — league",
    gradient: "from-primary to-accent",
  },
];

export default function PopularPlayers() {
  return (
    <section id="players" className="relative py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="Player Profiles"
          title="Every player, a real profile."
          subtitle="Career stats, verification, and achievements — built automatically from the matches you actually score."
        />

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLAYERS.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              <GlassCard className="group relative flex h-full flex-col items-center text-center">
                <button
                  aria-label="Favorite player"
                  className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-ink-soft transition-colors hover:bg-white/10 hover:text-red-400"
                >
                  <Heart className="h-4 w-4" />
                </button>

                <div
                  className={`relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br ${p.gradient} font-display text-xl font-bold text-white shadow-lg transition-transform duration-300 group-hover:scale-105`}
                >
                  {p.initials}
                  {p.verified && (
                    <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface ring-2 ring-surface">
                      <BadgeCheck className="h-5 w-5 text-accent" />
                    </span>
                  )}
                </div>

                <h3 className="mt-4 font-display text-lg font-bold text-ink">
                  {p.name}
                </h3>
                <p className="text-sm text-secondary">{p.role}</p>
                <p className="mt-2 text-xs text-ink-soft">{p.achievement}</p>

                <div className="mt-5 grid w-full grid-cols-3 gap-2 border-t border-white/10 pt-4 text-center">
                  <div>
                    <p className="text-sm font-bold text-ink">{p.avg}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                      Average
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-ink">{p.sr}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                      S/R
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-ink">{p.econ}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                      Economy
                    </p>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <PrimaryButton href={APP_LINKS.stats}>
            Build your player profile
          </PrimaryButton>
        </div>
      </Container>
    </section>
  );
}
