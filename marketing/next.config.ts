import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Ship this site as plain static HTML/CSS/JS so it can be folded straight
  // into legacy-app's own zero-build static deploy — one repo, one Vercel
  // project, one domain. `npm run build` writes the output to out/; only
  // out/welcome and out/_next get copied into legacy-app's served root
  // (see marketing/README.md for the exact steps).
  output: "export",
  images: {
    unoptimized: true,
  },
  // This folder is a standalone project inside legacy-app's repo now (not
  // part of the old cricket_connect monorepo workspace) — pin the root so
  // Turbopack doesn't get confused by the unrelated lockfile still sitting
  // at D:\Cricket\cricket-app\package-lock.json.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
