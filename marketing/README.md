# CricketConnect Marketing Site

This is the premium Next.js marketing/landing site ("Gully to Gallery"). It's a Next.js/React/
TypeScript/Tailwind v4/Framer Motion app that builds down to plain static HTML/CSS/JS and ships
as part of **legacy-app's own single deployment** — one repo, one Vercel project, one domain.
It is served at `/welcome`; the real app stays at `/` exactly as it always has.

## How it fits together
- `next.config.ts` has `output: "export"` — `npm run build` produces a static `out/` folder,
  no Node server involved at runtime.
- The Next app itself only has one real route: `app/welcome/page.tsx` (this is the whole
  marketing page). `app/page.tsx` at root is just a dev-only redirect to `/welcome` so
  `npm run dev` doesn't 404 at `localhost:3100/` — it's never deployed.
- legacy-app itself stays a zero-build static site. There's no Vercel build step for the real
  app; this folder's build output just gets copied in as extra static files.

## Local development
```bash
cd legacy-app/marketing
npm install
npm run dev      # http://localhost:3100/welcome
```

## Publishing an update to the live site
1. Build it:
   ```bash
   cd legacy-app/marketing
   npm run build
   ```
2. Copy the exported output into legacy-app's own served root. Next's static export writes
   nested routes as a flat `<route>.html` file (here, `out\welcome.html`) — that's the actual
   page. The `out\welcome\` folder next to it only holds client-navigation data, not the page
   itself, so it does NOT get copied.
   ```powershell
   # from legacy-app/marketing
   Remove-Item -Recurse -Force ..\welcome, ..\_next -ErrorAction SilentlyContinue
   New-Item -ItemType Directory -Force ..\welcome | Out-Null
   Copy-Item out\welcome.html ..\welcome\index.html
   Copy-Item -Recurse out\_next ..\_next
   ```
3. Commit and push from `legacy-app`:
   ```bash
   cd ..
   git add welcome _next
   git commit -m "Update marketing site"
   git push
   ```
4. legacy-app's one Vercel project (no build step, static files only) picks it up automatically —
   `cricket-pied-ten.vercel.app/welcome` is the marketing page, `cricket-pied-ten.vercel.app/`
   stays the real app.

## Why `/welcome` and not root `/`
The real app's installed-PWA users have `manifest.json`'s `start_url` pointing at `/index.html`
at the domain root. Swapping root `/` to the marketing page would break their home-screen
shortcut. Putting the marketing site at `/welcome` gets it onto the same domain/deploy without
disturbing anyone who already has the app installed.

## Retiring the old separate Vercel project
Once `/welcome` is live under the `cricket` project, the old separate marketing Vercel project
(the one that was pointed at `apps/landing` / `cricket_connect`) is no longer needed — safe to
delete it, and remove `apps/landing` from the old monorepo if you want it fully gone.
