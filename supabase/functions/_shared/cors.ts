// Shared CORS headers for the notification Edge Functions. The admin panel
// calls send-notification directly from the browser (with the admin's own
// session JWT, verified server-side inside the function — see index.ts), so
// this needs to allow cross-origin calls from wherever the app is hosted.
// dispatch-scheduled is only ever called by Supabase's own cron job, never
// a browser, but sharing one header set keeps this file trivial either way.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
