"use client";

import { motion } from "framer-motion";
import { BarChart3, BrainCircuit, LineChart, Sparkles, Wand2 } from "lucide-react";
import { Container, SectionHeading, GlassCard } from "./ui";

const FEATURES = [
  {
    icon: Sparkles,
    title: "AI Player Rating",
    desc: "A single, evolving rating built from real match data — form, consistency, and impact combined.",
  },
  {
    icon: LineChart,
    title: "AI Match Prediction",
    desc: "Live win-probability models that update ball by ball as the game swings.",
  },
  {
    icon: BarChart3,
    title: "AI Performance Insights",
    desc: "Spot trends in your own game — strong overs, weak matchups, and where to improve next.",
  },
  {
    icon: Wand2,
    title: "Smart Team Builder",
    desc: "Balanced XIs suggested from real player stats, not guesswork.",
  },
  {
    icon: BrainCircuit,
    title: "AI Tournament Analytics",
    desc: "League-wide trends: form tables, breakout players, and upset predictions.",
  },
];

export default function AIFeatures() {
  return (
    <section id="ai" className="relative py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
        <div className="h-[420px] w-[420px] rounded-full bg-accent/10 blur-[120px]" />
      </div>
      <Container>
        <SectionHeading
          eyebrow="Coming Soon · AI"
          title="Intelligence built on real stats."
          subtitle="Every AI feature below is powered by the same career and match data the app already tracks — nothing fabricated, all on the roadmap."
        />

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className={i === 4 ? "sm:col-span-2 lg:col-span-1" : ""}
            >
              <GlassCard className="group flex h-full flex-col gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 text-accent shadow-[0_0_30px_-4px_rgba(242,183,5,0.5)] transition-transform duration-300 group-hover:scale-110">
                  <f.icon className="h-6 w-6" />
                </span>
                <h3 className="font-display text-lg font-bold text-ink">{f.title}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{f.desc}</p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
