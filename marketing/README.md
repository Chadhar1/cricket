# CricketConnect Marketing Site

This is the premium Next.js marketing/landing site ("Gully to Gallery"), moved here from the old
`cricket_connect` monorepo so the whole project — real app + marketing site — lives in one repo.

## What this is
- A separate Next.js/React/TypeScript/Tailwind v4/Framer Motion app.
- Not wired into the real app's build. The real app (`../index.html`, `../app.js`, etc.) is
  completely untouched, zero-build, and deploys exactly as it always has.
- This folder currently deploys as its **own, separate Vercel project** (same as before the move) —
  just pointed at this repo/path now instead of the old `cricket_connect` repo.

## Local development
```bash
cd legacy-app/marketing
npm install
npm run dev      # http://localhost:3100 (or next available port)
```

## Deploying
In the Vercel dashboard for the marketing site's project:
- **Git repository**: `Chadhar1/cricket` (this repo)
- **Root Directory**: `legacy-app/marketing`
- Framework preset: Next.js (auto-detected)

No other settings should need to change from the previous `apps/landing` deployment.

## Why it's not fully merged into one deployment yet
Folding this into the *same* Vercel project/build as the real app (via Next.js static export,
served as e.g. `/welcome`) is a reasonable next step, but it changes the real app's deploy
pipeline from "no build step" to "Next.js build step." That's a change worth making deliberately,
with a local `npm run build` verified first — not pushed straight to the live app's deployment
untested. See project notes for the staged plan.
