import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
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
