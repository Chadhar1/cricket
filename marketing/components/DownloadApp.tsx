import QRCode from "qrcode";
import { Smartphone, Wifi, Zap } from "lucide-react";
import { Container, SectionHeading, GlassCard, Pill } from "./ui";
import { APP_URL } from "@/lib/constants";

async function getQrSvg() {
  const svg = await QRCode.toString(APP_URL, {
    type: "svg",
    margin: 0,
    color: { dark: "#eaf2ff", light: "#00000000" },
  });
  return svg;
}

export default async function DownloadApp() {
  const qrSvg = await getQrSvg();

  return (
    <section className="relative py-24 sm:py-32">
      <Container>
        <div className="glass-strong grid grid-cols-1 items-center gap-10 overflow-hidden rounded-[2rem] p-8 sm:p-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col items-start gap-5">
            <Pill tone="soon">Works today — no app store needed</Pill>
            <h2 className="font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
              Install it like an app,
              <br />
              right from your browser.
            </h2>
            <p className="max-w-md text-base leading-relaxed text-ink-soft">
              CricketConnect is a full Progressive Web App today — add it to
              your home screen on iPhone or Android and it launches full
              screen, works offline at the ground, and syncs the moment
              you&apos;re back online. A native Play Store listing is on the
              roadmap; you don&apos;t need to wait for it.
            </p>

            <div className="flex flex-col gap-3 text-sm text-ink-soft sm:flex-row sm:gap-6">
              <span className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-accent" /> Installs in one tap
              </span>
              <span className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-accent" /> Full offline scoring
              </span>
              <span className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-accent" /> iOS &amp; Android
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div
                className="h-28 w-28 shrink-0 rounded-2xl bg-white/5 p-3"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <div className="text-xs leading-relaxed text-ink-soft">
                <p className="font-semibold text-ink">Scan to open CricketConnect</p>
                <p>Then use your browser&apos;s &ldquo;Add to Home Screen&rdquo;</p>
                <p className="mt-1 text-secondary">{APP_URL.replace("https://", "")}</p>
              </div>
            </div>
          </div>

          <div className="relative mx-auto h-[340px] w-full max-w-xs sm:h-[400px]">
            <div className="absolute left-1/2 top-0 h-[340px] w-[170px] -translate-x-1/2 -rotate-6 rounded-[2rem] border-4 border-white/10 bg-surface shadow-2xl sm:h-[400px] sm:w-[195px]">
              <div className="flex h-full flex-col gap-2 overflow-hidden rounded-[1.5rem] bg-gradient-to-b from-surface to-surface-2 p-3">
                <div className="mx-auto h-1.5 w-10 rounded-full bg-white/20" />
                <div className="mt-2 rounded-xl bg-gradient-to-br from-primary to-accent p-2.5">
                  <p className="text-[9px] font-bold text-white/80">LIVE</p>
                  <p className="font-display text-lg font-extrabold text-white">142/4</p>
                  <p className="text-[9px] text-white/80">16.2 overs</p>
                </div>
                <div className="rounded-lg bg-white/5 p-2">
                  <div className="h-1.5 w-3/4 rounded bg-white/15" />
                  <div className="mt-1.5 h-1.5 w-1/2 rounded bg-white/15" />
                </div>
                <div className="rounded-lg bg-white/5 p-2">
                  <div className="h-1.5 w-2/3 rounded bg-white/15" />
                  <div className="mt-1.5 h-1.5 w-1/3 rounded bg-white/15" />
                </div>
                <div className="mt-auto grid grid-cols-3 gap-1.5">
                  {["1", "2", "4"].map((n) => (
                    <div
                      key={n}
                      className="flex h-8 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-ink"
                    >
                      {n}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="absolute bottom-0 right-0 h-[220px] w-[130px] rotate-6 rounded-[1.6rem] border-4 border-white/10 bg-surface shadow-2xl sm:h-[260px] sm:w-[150px]">
              <div className="flex h-full flex-col gap-2 overflow-hidden rounded-[1.1rem] bg-gradient-to-b from-surface to-surface-2 p-2.5">
                <div className="rounded-lg bg-white/5 p-2 text-center">
                  <p className="text-[8px] text-ink-soft">Tournament</p>
                  <p className="text-[10px] font-bold text-ink">Semi-Final</p>
                </div>
                <div className="flex-1 rounded-lg bg-gradient-to-br from-secondary/20 to-accent/20" />
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
