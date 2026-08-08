"use client";

import { motion } from "framer-motion";
import { CalendarClock, MapPin, Swords } from "lucide-react";
import { Container, SectionHeading, GlassCard, Pill, SecondaryButton } from "./ui";
import { APP_LINKS } from "@/lib/constants";

// Deliberately not fake data. Fixtures live inside each tournament today
// (Tournaments -> Fixtures tab) but there's no public, cross-platform
// "what's on this week" feed yet — this section is a real, honestly-labelled
// placeholder shaped exactly like the eventual API response will be
// (date, teams, ground, tournament), not a fabricated schedule.
const PLACEHOLDER_ROWS = [1, 2, 3];

export default function UpcomingMatches() {
  return (
    <section id="upcoming" className="relative py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="Coming Soon · Public Schedule"
          title="Upcoming matches, in one place."
          subtitle="A platform-wide feed of upcoming fixtures from public tournaments — on the roadmap. Fixtures already exist inside every tournament today; this is the cross-platform view of them."
        />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
          className="relative mx-auto mt-14 max-w-3xl"
        >
          <GlassCard hover={false} className="relative overflow-hidden">
            <div className="flex flex-col gap-3">
              {PLACEHOLDER_ROWS.map((row) => (
                <div
                  key={row}
                  className="flex items-center gap-4 rounded-2xl bg-white/5 p-4 opacity-50"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
                    <Swords className="h-5 w-5 text-ink-soft" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="h-2.5 w-2/5 rounded-full bg-white/15" />
                    <div className="h-2 w-3/5 rounded-full bg-white/10" />
                  </div>
                  <div className="hidden shrink-0 items-center gap-1.5 text-xs text-ink-soft sm:flex">
                    <MapPin className="h-3.5 w-3.5" /> —
                  </div>
                </div>
              ))}
            </div>

            {/* Overlay message */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface/70 p-8 text-center backdrop-blur-sm">
              <Pill tone="soon">
                <CalendarClock className="h-3 w-3" /> Launching soon
              </Pill>
              <p className="max-w-sm text-sm leading-relaxed text-ink-soft">
                Once tournament organisers start publishing fixtures, every
                upcoming public match will show up here automatically —
                nothing to configure.
              </p>
              <SecondaryButton href={APP_LINKS.tournaments} external>
                Browse tournaments now
              </SecondaryButton>
            </div>
          </GlassCard>
        </motion.div>
      </Container>
    </section>
  );
}
