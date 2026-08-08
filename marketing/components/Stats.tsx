"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Container } from "./ui";

const STATS = [
  { value: 100, suffix: "%", label: "Free to join, no paywalls" },
  { value: 6, suffix: "", label: "Core modules live today" },
  { value: 1, prefix: "<", suffix: "s", label: "Live score sync latency" },
  { value: 0, suffix: "", label: "Cost to run your own tournament", isZeroDollar: true },
];

function AnimatedNumber({ value, duration = 1.4 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / (duration * 1000));
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration]);

  return <span ref={ref}>{display}</span>;
}

export default function Stats() {
  return (
    <section className="relative py-20">
      <Container>
        <div className="glass-strong grid grid-cols-2 gap-8 rounded-3xl px-6 py-12 sm:px-12 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="flex flex-col items-center text-center"
            >
              <p className="font-display text-3xl font-extrabold text-gradient sm:text-4xl lg:text-5xl">
                {s.isZeroDollar ? "$" : (s.prefix ?? "")}
                <AnimatedNumber value={s.value} />
                {s.suffix}
              </p>
              <p className="mt-2 text-xs text-ink-soft sm:text-sm">{s.label}</p>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
