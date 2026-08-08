"use client";

import { useRef, type MouseEvent } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Radio, Trophy, TrendingUp, Users } from "lucide-react";
import { PrimaryButton, SecondaryButton, Pill } from "./ui";
import { APP_LINKS } from "@/lib/constants";
import { useLiveMatches } from "@/lib/useLiveMatches";

const DEMO_TICKER = [
  { a: "Riverside XI", b: "Northside CC", line: "142/4 (16.2 ov) — chasing 178" },
  { a: "Oakfield Titans", b: "Harbour Kings", line: "89/2 (10.0 ov) — RR 8.90" },
  { a: "Dockyard Strikers", b: "Meadow Lions", line: "201/6 (20 ov) — set 202 to win" },
];

function CricketBall() {
  return (
    <motion.svg
      viewBox="0 0 100 100"
      className="h-full w-full drop-shadow-[0_0_25px_rgba(22,163,74,0.6)]"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 14, ease: "linear" }}
    >
      <defs>
        <radialGradient id="ballGrad" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ff5a4e" />
          <stop offset="55%" stopColor="#c81e1e" />
          <stop offset="100%" stopColor="#6e0f0f" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#ballGrad)" />
      <path
        d="M50 4 A46 46 0 0 1 50 96"
        fill="none"
        stroke="#f5e6c8"
        strokeWidth="1.6"
        strokeDasharray="3 2.5"
      />
      <path
        d="M50 4 A46 46 0 0 0 50 96"
        fill="none"
        stroke="#f5e6c8"
        strokeWidth="1.6"
        strokeDasharray="3 2.5"
      />
    </motion.svg>
  );
}

export default function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, { stiffness: 60, damping: 20 });
  const sy = useSpring(my, { stiffness: 60, damping: 20 });
  const glowX = useTransform(sx, [0, 1], ["10%", "90%"]);
  const glowY = useTransform(sy, [0, 1], ["10%", "90%"]);
  const tiltX = useTransform(sy, [0, 1], [6, -6]);
  const tiltY = useTransform(sx, [0, 1], [-6, 6]);

  const { matches, hasLive } = useLiveMatches();
  const ticker = hasLive
    ? matches.map((m) => ({
        a: m.teamA,
        b: m.teamB,
        line: `${m.battingTeamName} ${m.runs}/${m.wickets} (${m.oversStr} ov) · RR ${m.runRate}`,
      }))
    : DEMO_TICKER;

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    mx.set((e.clientX - rect.left) / rect.width);
    my.set((e.clientY - rect.top) / rect.height);
  }

  return (
    <section
      id="home"
      ref={ref}
      onMouseMove={handleMouseMove}
      className="relative flex min-h-[100svh] items-center overflow-hidden pt-28 pb-20"
    >
      {/* Stadium floodlight backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-20">
        <div className="absolute inset-0 bg-bg" />
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(60% 50% at 15% 0%, rgba(22,163,74,0.35), transparent 60%), radial-gradient(50% 45% at 85% 10%, rgba(242,183,5,0.16), transparent 60%), radial-gradient(70% 60% at 50% 100%, rgba(14,165,233,0.16), transparent 60%)",
          }}
        />
        {/* floodlight beams */}
        <div className="absolute -top-40 left-[8%] h-[70vh] w-[26vw] rotate-[18deg] bg-gradient-to-b from-white/10 via-white/0 to-transparent blur-2xl" />
        <div className="absolute -top-40 right-[8%] h-[70vh] w-[26vw] -rotate-[18deg] bg-gradient-to-b from-white/10 via-white/0 to-transparent blur-2xl" />
        {/* fog */}
        <div className="absolute bottom-0 left-0 h-56 w-full bg-gradient-to-t from-surface/90 to-transparent" />
        {/* mouse-follow glow */}
        <motion.div
          className="absolute h-[45vw] w-[45vw] max-h-[600px] max-w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-[100px]"
          style={{
            left: glowX,
            top: glowY,
            background:
              "radial-gradient(circle, rgba(22,163,74,0.5), rgba(242,183,5,0.18) 55%, transparent 75%)",
          }}
        />
        {/* particles */}
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-accent/70 animate-drift"
            style={{
              width: `${2 + (i % 3)}px`,
              height: `${2 + (i % 3)}px`,
              left: `${(i * 37) % 100}%`,
              top: `${(i * 53) % 100}%`,
              animationDuration: `${16 + (i % 7) * 3}s`,
              animationDelay: `${-(i * 1.3)}s`,
              opacity: 0.5,
            }}
          />
        ))}
        <div className="noise absolute inset-0" />
      </div>

      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-16 px-5 sm:px-8 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Left: copy */}
        <div className="flex flex-col items-start gap-7">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Pill tone="live">Live on the pitch right now</Pill>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="font-display text-[2.6rem] font-extrabold leading-[1.04] tracking-tight text-ink sm:text-6xl lg:text-[4rem]"
          >
            CricketConnect
            <br />
            <span className="text-gradient">Gully to Gallery.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12 }}
            className="max-w-lg text-lg leading-relaxed text-ink-soft"
          >
            Connect with players. Build teams. Join tournaments. Make your
            cricket count.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="flex flex-wrap items-center gap-3"
          >
            <PrimaryButton href={APP_LINKS.tournaments}>
              <Trophy className="h-4 w-4" />
              Find Tournaments
            </PrimaryButton>
            <SecondaryButton href={APP_LINKS.findPlayers}>
              <Users className="h-4 w-4" />
              Find Players
            </SecondaryButton>
            <SecondaryButton href={APP_LINKS.createTournament}>
              Create Tournament
            </SecondaryButton>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.35 }}
            className="flex flex-wrap items-center gap-x-8 gap-y-3 pt-2 text-sm text-ink-soft"
          >
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 text-secondary" /> Free to join
            </span>
            <span className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-secondary" /> Real-time scoring
            </span>
            <span className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-secondary" /> Built by players
            </span>
          </motion.div>
        </div>

        {/* Right: floating UI + ball */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          style={{ rotateX: tiltX, rotateY: tiltY }}
          className="relative mx-auto h-[420px] w-full max-w-md [perspective:1000px] sm:h-[480px]"
        >
          <div className="absolute right-2 top-0 h-24 w-24 animate-float opacity-90 sm:h-28 sm:w-28">
            <CricketBall />
          </div>

          <div className="glass-strong animate-float-slow absolute left-0 top-10 w-64 rounded-2xl p-4 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <Pill tone="live">Live</Pill>
              <span className="text-xs text-ink-soft">Overs 16.2</span>
            </div>
            <p className="text-sm font-semibold text-ink">
              {ticker[0].a} <span className="text-ink-soft">vs</span> {ticker[0].b}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-gradient">
              {ticker[0].line.split("—")[0].split("·")[0].trim()}
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-primary to-accent" />
            </div>
          </div>

          <div
            className="glass-strong absolute bottom-24 right-0 w-52 animate-float rounded-2xl p-4 shadow-2xl"
            style={{ animationDelay: "-2s" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-secondary">
              Player Profile
            </p>
            <div className="mt-2 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full btn-glow text-sm font-bold text-white">
                AK
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">Aman Kapoor</p>
                <p className="text-xs text-ink-soft">All-rounder</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-sm font-bold text-ink">42.8</p>
                <p className="text-[10px] text-ink-soft">Avg</p>
              </div>
              <div>
                <p className="text-sm font-bold text-ink">138</p>
                <p className="text-[10px] text-ink-soft">SR</p>
              </div>
              <div>
                <p className="text-sm font-bold text-ink">61</p>
                <p className="text-[10px] text-ink-soft">Wkts</p>
              </div>
            </div>
          </div>

          <div
            className="glass-strong animate-float-slow absolute bottom-0 left-6 w-60 rounded-2xl p-4 shadow-2xl"
            style={{ animationDelay: "-4s" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-secondary">
              Tournament Bracket
            </p>
            <div className="mt-3 flex flex-col gap-1.5 text-xs text-ink-soft">
              <div className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5">
                <span className="text-ink">Riverside XI</span>
                <span className="font-bold text-accent">W</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5">
                <span>Northside CC</span>
                <span>L</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Live score ticker */}
      <div className="glass-strong absolute inset-x-0 bottom-0 z-10 overflow-hidden border-x-0 border-b-0 py-2.5">
        <div className="flex animate-[marquee_28s_linear_infinite] gap-10 whitespace-nowrap">
          {[...ticker, ...ticker, ...ticker].map((t, i) => (
            <span
              key={i}
              className="flex items-center gap-2 text-xs font-medium text-ink-soft"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              <span className="text-ink">
                {t.a} vs {t.b}
              </span>
              <span>· {t.line}</span>
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-33.333%); }
        }
      `}</style>
    </section>
  );
}
