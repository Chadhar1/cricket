"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { APP_LINKS } from "@/lib/constants";

const LINKS = [
  { label: "Live Scores", href: "#live" },
  { label: "Tournaments", href: "#tournaments" },
  { label: "Players", href: "#players" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Teams", href: "#teams" },
  { label: "Community", href: "#community" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? "py-2" : "py-4"
      }`}
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div
          className={`glass-strong flex items-center justify-between rounded-2xl px-4 py-3 transition-all duration-300 sm:px-6 ${
            scrolled ? "shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)]" : ""
          }`}
        >
          <Link href="#home" className="flex items-center gap-2.5">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl btn-glow">
              <span className="h-3.5 w-3.5 rounded-full bg-white" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-ink">
              Cricket<span className="text-accent">Connect</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 lg:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <Link
              href={APP_LINKS.login}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href={APP_LINKS.getStarted}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-glow rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105"
            >
              Sign Up
            </Link>
          </div>

          <button
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-ink lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="glass-strong mt-2 overflow-hidden rounded-2xl lg:hidden"
            >
              <div className="flex flex-col gap-1 p-4">
                {LINKS.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-white/5 hover:text-ink"
                  >
                    {l.label}
                  </a>
                ))}
                <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
                  <Link
                    href={APP_LINKS.login}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl px-3 py-2.5 text-center text-sm font-semibold text-ink-soft"
                  >
                    Log in
                  </Link>
                  <Link
                    href={APP_LINKS.getStarted}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-glow rounded-full px-4 py-3 text-center text-sm font-semibold text-white"
                  >
                    Sign Up
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
