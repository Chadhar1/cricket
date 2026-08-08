"use client";

import { motion } from "framer-motion";
import { Car, CloudSun, Compass, Lightbulb, MapPin } from "lucide-react";
import { Container, SectionHeading, GlassCard, Pill } from "./ui";

const GROUNDS = [
  {
    name: "Riverside Ground No. 2",
    distance: "1.2 mi",
    pitch: "Turf",
    weather: "24°C, clear",
    parking: true,
    lighting: true,
  },
  {
    name: "Meadowbrook Oval",
    distance: "3.6 mi",
    pitch: "Matting",
    weather: "21°C, partly cloudy",
    parking: true,
    lighting: false,
  },
  {
    name: "Port Ellery Stadium",
    distance: "5.8 mi",
    pitch: "Turf",
    weather: "23°C, clear",
    parking: false,
    lighting: true,
  },
];

export default function Grounds() {
  return (
    <section id="grounds" className="relative py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="Coming Soon · Grounds"
          title="Find and book a ground in seconds."
          subtitle="An interactive map of grounds near you — pitch type, lighting, parking, and live weather, with one-tap booking. On the roadmap, not live yet."
        />

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
          >
            <GlassCard className="relative h-full min-h-[340px] overflow-hidden !p-0">
              <div className="absolute inset-0 bg-gradient-to-br from-surface via-surface-2 to-surface" />
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(22,163,74,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(22,163,74,0.18) 1px, transparent 1px)",
                  backgroundSize: "28px 28px",
                }}
              />
              {[
                { top: "30%", left: "35%" },
                { top: "55%", left: "62%" },
                { top: "68%", left: "28%" },
              ].map((pos, i) => (
                <span
                  key={i}
                  className="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full btn-glow animate-pulse-glow"
                  style={pos}
                >
                  <MapPin className="h-4 w-4 text-white" />
                </span>
              ))}
              <div className="absolute left-5 top-5">
                <Pill tone="soon">Map preview</Pill>
              </div>
            </GlassCard>
          </motion.div>

          <div className="flex flex-col gap-4">
            {GROUNDS.map((g, i) => (
              <motion.div
                key={g.name}
                initial={{ opacity: 0, x: 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
              >
                <GlassCard hover={false} className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-display text-base font-bold text-ink">
                      {g.name}
                    </h3>
                    <p className="flex items-center gap-1 text-xs text-ink-soft">
                      <Compass className="h-3 w-3" /> {g.distance} away · {g.pitch} pitch
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
                      <span className="flex items-center gap-1">
                        <CloudSun className="h-3.5 w-3.5" /> {g.weather}
                      </span>
                      <span className="flex items-center gap-1">
                        <Car className="h-3.5 w-3.5" /> {g.parking ? "Parking" : "No parking"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Lightbulb className="h-3.5 w-3.5" /> {g.lighting ? "Floodlit" : "Daytime only"}
                      </span>
                    </div>
                  </div>
                  <span className="glass shrink-0 rounded-full px-4 py-2 text-xs font-semibold text-ink-soft">
                    Notify me
                  </span>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
