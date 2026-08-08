"use client";

import { motion } from "framer-motion";
import { Flame, Heart, MessageCircle, Search, Share2, Sparkles, UserPlus } from "lucide-react";
import { Container, SectionHeading, GlassCard, Pill, PrimaryButton, SecondaryButton } from "./ui";
import { APP_LINKS } from "@/lib/constants";

const STORIES = ["Riverside XI", "Sana R.", "Harbour Kings", "Devon M.", "Meadow CC", "Tariq N."];

const POSTS = [
  {
    author: "Riverside XI",
    time: "2h",
    text: "Chased down 178 with 2 overs to spare. What a run chase from the middle order 🏏",
    likes: 214,
    comments: 38,
    tag: "#RiversidePremierLeague",
  },
  {
    author: "Sana Rehman",
    time: "5h",
    text: "New personal best — 96 off 58 balls. So close to the century, next time 😅",
    likes: 341,
    comments: 52,
    tag: "#PersonalBest",
  },
];

export default function Community() {
  return (
    <section id="community" className="relative py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="Community &amp; Achievements"
          title="Where consistency gets noticed."
          subtitle="Friends, streaks and points are live in the app right now — the public social feed below is what's coming next on top of that foundation."
        />

        {/* Real, working features — up front, not buried under the mockup */}
        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
          >
            <GlassCard className="flex h-full flex-col items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/25 to-primary/20 text-accent">
                <Flame className="h-6 w-6" />
              </span>
              <Pill tone="soon">Live today</Pill>
              <h3 className="font-display text-xl font-bold text-ink">
                Daily streaks &amp; points
              </h3>
              <p className="text-sm leading-relaxed text-ink-soft">
                Open the app once a day to build your streak — 10 points a
                day, bigger bonuses at 7, 30 and 100 days. It's future
                currency: redeemable once the Marketplace launches, tracked
                for real from day one.
              </p>
              <PrimaryButton href={APP_LINKS.getStarted} external className="mt-auto">
                Start your streak
              </PrimaryButton>
            </GlassCard>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <GlassCard className="flex h-full flex-col items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-secondary/25 to-primary/20 text-secondary">
                <Search className="h-6 w-6" />
              </span>
              <Pill tone="soon">Live today</Pill>
              <h3 className="font-display text-xl font-bold text-ink">
                Friends &amp; player search
              </h3>
              <p className="text-sm leading-relaxed text-ink-soft">
                Claim your handle, then find people by name or @handle — not
                just the players you already know. Send a request, they
                accept, you're connected.
              </p>
              <SecondaryButton href={APP_LINKS.findPlayers} external className="mt-auto">
                Find your friends
              </SecondaryButton>
            </GlassCard>
          </motion.div>
        </div>

        {/* Coming-soon preview of the broader social feed */}
        <div className="mt-16 flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-accent" />
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Coming soon — the public feed built on top of this
          </p>
        </div>

        <div className="relative mt-6">
          <div className="flex gap-4 overflow-x-auto pb-2 opacity-70">
            {STORIES.map((s, i) => (
              <motion.div
                key={s}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="flex shrink-0 flex-col items-center gap-2"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary via-secondary to-accent p-[2.5px]">
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-surface text-xs font-bold text-ink">
                    {s
                      .split(" ")
                      .map((w) => w[0])
                      .join("")}
                  </div>
                </div>
                <span className="text-[11px] text-ink-soft">{s}</span>
              </motion.div>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 opacity-70 lg:grid-cols-2">
            {POSTS.map((p, i) => (
              <motion.div
                key={p.author}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <GlassCard hover={false}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full btn-glow text-xs font-bold text-white">
                        {p.author
                          .split(" ")
                          .map((w) => w[0])
                          .join("")}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-ink">{p.author}</p>
                        <p className="text-xs text-ink-soft">{p.time} ago</p>
                      </div>
                    </div>
                    <button className="glass rounded-full px-3 py-1.5 text-[11px] font-semibold text-ink-soft">
                      <UserPlus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <p className="mt-4 text-sm leading-relaxed text-ink">{p.text}</p>
                  <p className="mt-2 text-xs font-medium text-secondary">{p.tag}</p>

                  <div className="mt-4 flex items-center gap-6 border-t border-white/10 pt-3 text-xs text-ink-soft">
                    <span className="flex items-center gap-1.5">
                      <Heart className="h-3.5 w-3.5" /> {p.likes}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MessageCircle className="h-3.5 w-3.5" /> {p.comments}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </span>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
