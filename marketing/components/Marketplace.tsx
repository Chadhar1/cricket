"use client";

import { motion } from "framer-motion";
import { Container, SectionHeading, GlassCard, Pill } from "./ui";

const PRODUCTS = [
  { name: "Pro Willow Bat — Grade A", price: "$189", tag: "Bestseller" },
  { name: "Match Ball, 6-pack", price: "$54", tag: "Restocked" },
  { name: "Full Protective Kit", price: "$240", tag: "New" },
  { name: "Academy Coaching — 4 sessions", price: "$120", tag: "Popular" },
];

export default function Marketplace() {
  return (
    <section id="marketplace" className="relative py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="Coming Soon · Marketplace"
          title="Gear, coaching, sponsorships — all in one place."
          subtitle="Sports equipment, academy coaching, and sponsor deals for teams and organisers. On the roadmap alongside the AI features."
        />

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCTS.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              <GlassCard className="flex h-full flex-col !p-0 overflow-hidden">
                <div className="relative flex h-32 items-center justify-center bg-gradient-to-br from-surface-2 to-surface">
                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/30 to-accent/30" />
                  <span className="absolute left-3 top-3">
                    <Pill tone="soon">{p.tag}</Pill>
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1 p-5">
                  <h3 className="text-sm font-semibold text-ink">{p.name}</h3>
                  <p className="font-display text-lg font-bold text-gradient">{p.price}</p>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
