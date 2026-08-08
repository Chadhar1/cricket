import Link from "next/link";
import { Github, Mail } from "lucide-react";
import { Container, PrimaryButton } from "./ui";
import { APP_LINKS, APP_URL } from "@/lib/constants";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Live Scoring", href: "#live" },
      { label: "Tournaments", href: "#tournaments" },
      { label: "Find Players", href: APP_LINKS.findPlayers, external: true },
      { label: "Teams", href: "#teams" },
      { label: "Player Stats", href: "#players" },
      { label: "Admin Tools", href: APP_LINKS.getStarted, external: true },
    ],
  },
  {
    title: "Roadmap",
    links: [
      { label: "AI Insights", href: "#ai" },
      { label: "Ground Booking", href: "#grounds" },
      { label: "Community Feed", href: "#community" },
      { label: "Marketplace", href: "#marketplace" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#home" },
      { label: "Get Started", href: APP_LINKS.getStarted, external: true },
      { label: "Log In", href: APP_LINKS.login, external: true },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Live App", href: APP_URL, external: true },
      { label: "Report an Issue", href: "mailto:gachadhar1@gmail.com" },
      { label: "Privacy Policy", href: `${APP_URL}/privacy.html`, external: true },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative border-t border-white/10 pt-20">
      <Container>
        <div className="glass-strong flex flex-col items-start gap-6 rounded-3xl p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div>
            <h3 className="font-display text-2xl font-bold text-ink">
              Your gully game belongs in the gallery.
            </h3>
            <p className="mt-1 text-sm text-ink-soft">
              Join CricketConnect free — takes less than a minute.
            </p>
          </div>
          <PrimaryButton href={APP_LINKS.getStarted}>Get Started</PrimaryButton>
        </div>

        <div className="mt-16 grid grid-cols-2 gap-10 pb-10 sm:grid-cols-4 lg:grid-cols-6">
          <div className="col-span-2 flex flex-col gap-3 lg:col-span-2">
            <Link href="#home" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg btn-glow">
                <span className="h-3 w-3 rounded-full bg-white" />
              </span>
              <span className="font-display text-base font-bold text-ink">
                Cricket<span className="text-accent">Connect</span>
              </span>
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-ink-soft">
              The digital ecosystem for grassroots cricket — players, teams,
              organisers, and fans, in one place.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <a
                href="mailto:gachadhar1@gmail.com"
                aria-label="Email"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-ink-soft transition-colors hover:bg-white/10 hover:text-ink"
              >
                <Mail className="h-4 w-4" />
              </a>
              <a
                href={APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Live app"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-ink-soft transition-colors hover:bg-white/10 hover:text-ink"
              >
                <Github className="h-4 w-4" />
              </a>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                {col.title}
              </h4>
              {col.links.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  target={"external" in l && l.external ? "_blank" : undefined}
                  rel={"external" in l && l.external ? "noopener noreferrer" : undefined}
                  className="text-sm text-ink-soft transition-colors hover:text-ink"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 py-6 text-xs text-ink-soft sm:flex-row">
          <p>© {new Date().getFullYear()} CricketConnect. All rights reserved.</p>
          <p>Gully to Gallery.</p>
        </div>
      </Container>
    </footer>
  );
}
