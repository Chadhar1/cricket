"use client";

import { motion } from "framer-motion";
import { MapPin, Trophy, Users2 } from "lucide-react";
import { Container, SectionHeading, GlassCard, SecondaryButton } from "./ui";
import { APP_LINKS } from "@/lib/constants";

const TEAMS = [
  {
    name: "Riverside XI",
    city: "Riverside",
    captain: "Aman Kapoor",
    wins: 24,
    rank: 1,
    members: 15,
    gradient: "from-primary to-secondary",
  },
  {
    name: "Northside CC",
    city: "Northgate",
    captain: "Sana Rehman",
    wins: 19,
    rank: 3,
    members: 14,
    gradient: "from-secondary to-accent",
  },
  {
    name: "Harbour Kings",
    city: "Port Ellery",
    captain: "Devon Marsh",
    wins: 21,
    rank: 2,
    members: 16,
    gradient: "from-accent to-primary",
  },
];

export default function Teams() {
  return (
    <section id="teams" className="relative py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="Teams"
          title="Build a team. Run it properly."
          subtitle="Rosters, captaincy, rankings, and match history — all in one place, synced for every member."
        />

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TEAMS.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <GlassCard className="flex h-full flex-col">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${t.gradient} font-display text-lg font-bold text-white shadow-lg`}
                  >
                    {t.name
                      .split(" ")
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")}
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-ink">
                      {t.name}
                    </h3>
                    <p className="flex items-center gap-1 text-xs text-ink-soft">
                      <MapPin className="h-3 w-3" /> {t.city}
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-sm text-ink-soft">
                  Captain: <span className="text-ink">{t.captain}</span>
                </p>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-center">
                  <div>
                    <p className="flex items-center justify-center gap-1 text-sm font-bold text-ink">
                      <Trophy className="h-3.5 w-3.5 text-accent" /> {t.wins}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                      Wins
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-ink">#{t.rank}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                      Ranking
                    </p>
                  </div>
                  <div>
                    <p className="flex items-center justify-center gap-1 text-sm font-bold text-ink">
                      <Users2 className="h-3.5 w-3.5 text-secondary" /> {t.members}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                      Members
                    </p>
                  </div>
                </div>

                <SecondaryButton href={APP_LINKS.teams} className="mt-6 w-full">
                  Join Team
                </SecondaryButton>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
