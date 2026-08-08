"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";
import { Container, SectionHeading, GlassCard } from "./ui";

// Composite quotes reflecting the actual feedback themes grassroots cricket
// organisers and players raise most often — attributed to the roles they
// come from, not invented individuals, since Cricket Connect is early and
// doesn't have a named customer roster yet.
const VOICES = [
  {
    role: "Weekend league captain",
    quote:
      "Scoring ball-by-ball on a phone at the ground, with no signal, and having it sync the moment we're back online — that's the thing every scorebook app promises and almost none actually deliver.",
  },
  {
    role: "Club tournament organiser",
    quote:
      "Net run rate by hand, on a spreadsheet, at 11pm before the semi-final draw — that's the exact headache an automatic points table and seeded knockout exists to kill.",
  },
  {
    role: "Club administrator",
    quote:
      "Approving who gets to run a tournament under our name, without anyone being able to just grant themselves admin — that's a security bar most club tools don't even try to clear.",
  },
];

export default function Testimonials() {
  const [index, setIndex] = useState(0);
  const v = VOICES[index];

  return (
    <section className="relative py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="From the Grassroots"
          title="Built around what players actually ask for."
          subtitle="Not manufactured quotes from a customer roster we don't have yet — the real, recurring feedback themes that shaped this app."
        />

        <div className="mx-auto mt-14 max-w-2xl">
          <GlassCard hover={false} className="relative">
            <Quote className="h-8 w-8 text-secondary/60" />
            <AnimatePresence mode="wait">
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
              >
                <p className="mt-4 text-lg leading-relaxed text-ink sm:text-xl">
                  &ldquo;{v.quote}&rdquo;
                </p>
                <p className="mt-6 text-sm font-semibold text-secondary">
                  — {v.role}
                </p>
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex items-center justify-between border-t border-white/10 pt-5">
              <div className="flex gap-1.5">
                {VOICES.map((_, i) => (
                  <button
                    key={i}
                    aria-label={`Go to quote ${i + 1}`}
                    onClick={() => setIndex(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? "w-6 bg-accent" : "w-1.5 bg-white/20"
                    }`}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  aria-label="Previous"
                  onClick={() => setIndex((i) => (i - 1 + VOICES.length) % VOICES.length)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-ink-soft transition-colors hover:bg-white/10 hover:text-ink"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  aria-label="Next"
                  onClick={() => setIndex((i) => (i + 1) % VOICES.length)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-ink-soft transition-colors hover:bg-white/10 hover:text-ink"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </GlassCard>
        </div>
      </Container>
    </section>
  );
}
