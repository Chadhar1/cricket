"use client";

import { motion } from "framer-motion";
import { UserPlus, Users2, Radio, Trophy } from "lucide-react";
import { Container, SectionHeading } from "./ui";

const STEPS = [
  {
    n: "01",
    icon: UserPlus,
    title: "Create your profile",
    desc: "Sign up free, set your role — batter, bowler, all-rounder, keeper — and your area so nearby teams can find you.",
  },
  {
    n: "02",
    icon: Users2,
    title: "Build or join a team",
    desc: "Search players by name or handle, send a request, and put together your squad — or get scouted for someone else's.",
  },
  {
    n: "03",
    icon: Radio,
    title: "Score live, ball by ball",
    desc: "Run tournaments with real fixtures and net run rate, and share a live link so anyone can follow the match as it happens.",
  },
  {
    n: "04",
    icon: Trophy,
    title: "Climb the ranks",
    desc: "Every match builds your career stats and streak. From your local ground to the leaderboard — gully to gallery.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="How It Works"
          title="From your first match to your next milestone."
          subtitle="Four steps, all live in the app today — no waitlist, no fake demo."
        />

        <div className="relative mt-16 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="pointer-events-none absolute top-8 left-0 right-0 hidden h-px bg-gradient-to-r from-transparent via-white/15 to-transparent lg:block" />

          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="relative flex flex-col items-start gap-4"
            >
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl btn-glow shadow-lg">
                <s.icon className="h-7 w-7 text-white" />
                <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-surface text-[11px] font-bold text-ink-soft ring-2 ring-bg">
                  {s.n}
                </span>
              </div>
              <h3 className="font-display text-lg font-bold text-ink">{s.title}</h3>
              <p className="text-sm leading-relaxed text-ink-soft">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
