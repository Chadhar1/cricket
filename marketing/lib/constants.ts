// The real, currently-live Cricket Connect app (legacy-app) that this
// marketing site sends visitors into. Every CTA on the landing page points
// here — there is no separate auth system on the landing site itself.
export const APP_URL = "https://cricket-pied-ten.vercel.app";

// legacy-app supports real deep links via ?go=setup|tournaments|stats|teams|
// history|profile (see app.js boot()). Anyone without a session is routed to
// the auth screen automatically, so "get started" / "login" just need the
// bare app URL.
export const APP_LINKS = {
  getStarted: APP_URL,
  login: APP_URL,
  tournaments: `${APP_URL}/?go=tournaments`,
  // Tournament creation happens from inside the Tournaments screen (the
  // "+ New" button there) — same deep link as browsing, different intent
  // on the landing page's button label.
  createTournament: `${APP_URL}/?go=tournaments`,
  // There's no direct ?go=friends deep link yet (see app.js's allowed-list),
  // so this lands on Profile, one tap from the real Friends search/add flow.
  findPlayers: `${APP_URL}/?go=profile`,
  startScoring: `${APP_URL}/?go=setup`,
  teams: `${APP_URL}/?go=teams`,
  stats: `${APP_URL}/?go=stats`,
};

// Same Supabase project the live app talks to (public URL + anon key —
// safe to expose client-side, access is governed by RLS). Lets the landing
// page show real live-match data instead of fabricated numbers.
export const SUPABASE_URL = "https://hkqiroednyfpkwmlrreg.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrcWlyb2VkbnlmcGt3bWxycmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NzQ0MDksImV4cCI6MjEwMTM1MDQwOX0.WsQ90f9RbOLbR-ibGurmAn4VIc-RdVa-qgGFKLKOgAQ";
