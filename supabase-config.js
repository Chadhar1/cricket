/* ===========================================================================
   SUPABASE CONFIG  —  paste your project's values below.

   Find them in: Supabase dashboard -> Project Settings -> API.
     - `url`      is "Project URL"
     - `anonKey`  is the "anon public" key (NOT the service_role key — that
                  one must never appear in client-side code)

   Both are safe to ship to the browser and safe to commit: the anon key
   only grants what your Row Level Security policies (supabase.sql) allow.
   Your data is protected by those policies, not by hiding this file.

   If you leave the placeholders in place, the app falls back to LOCAL-ONLY
   mode instead of erroring: scoring, teams and tournaments all keep working
   on the device, just with no sync, accounts, or live share.

   Before sign-in will work, in the Supabase dashboard:
     1. Run supabase.sql in the SQL Editor (creates tables + RLS policies)
     2. Authentication -> Providers -> enable Email, and Google if you want it
     3. Authentication -> URL Configuration -> add your Vercel URL to
        Site URL / Redirect URLs
   =========================================================================== */

export const supabaseConfig = {
  url: "https://hkqiroednyfpkwmlrreg.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrcWlyb2VkbnlmcGt3bWxycmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NzQ0MDksImV4cCI6MjEwMTM1MDQwOX0.WsQ90f9RbOLbR-ibGurmAn4VIc-RdVa-qgGFKLKOgAQ"
};

/* Returns false while the placeholders above are still in place, so the app
   knows to stay in local-only mode instead of throwing errors. */
export function isConfigured(){
  return !!supabaseConfig.url &&
         !supabaseConfig.url.startsWith("PASTE_") &&
         !!supabaseConfig.anonKey &&
         !supabaseConfig.anonKey.startsWith("PASTE_");
}
