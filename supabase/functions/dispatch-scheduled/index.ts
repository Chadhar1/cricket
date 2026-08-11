// ============================================================================
// POST /functions/v1/dispatch-scheduled
//
// Invoked on a schedule by Supabase's pg_cron (see the commented-out
// `cron.schedule(...)` block at the end of supabase.sql) — never by a
// browser, so authorization here is a single shared secret compared against
// the Authorization header, not a user session. Finds every notification
// whose scheduled_at has arrived and sends each one through the exact same
// sendNotification() an immediate "Send Now" uses, so a scheduled send can
// never behave differently from an immediate one.
//
// Requires the pg_cron + pg_net Postgres extensions enabled on the project
// (Database -> Extensions) — see supabase.sql for the exact cron.schedule()
// call to run once this function is deployed and DISPATCH_SCHEDULED_SECRET
// is set.
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { sendNotification } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const expected = Deno.env.get('DISPATCH_SCHEDULED_SECRET');
    const provided = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!expected || !provided || provided !== expected) throw new Error('Unauthorized');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const origin = Deno.env.get('APP_ORIGIN') || '';

    const { data: due, error } = await serviceClient
      .from('notifications')
      .select('id')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString());
    if (error) throw error;

    // Sequential on purpose: each notification's own device fan-out is
    // already concurrency-capped internally (see mapWithConcurrency in
    // _shared/notify.ts) — running several large sends at once on top of
    // that would stack their FCM bursts. A cron tick that's a few seconds
    // slower than "instant" costs nothing for a scheduled announcement.
    const results = [];
    for (const row of due || []) {
      try {
        const result = await sendNotification(serviceClient, row.id, origin);
        results.push({ id: row.id, ...result });
      } catch (err) {
        console.error(`dispatch-scheduled: notification ${row.id} failed:`, err);
        results.push({ id: row.id, status: 'failed', error: err instanceof Error ? err.message : String(err) });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('dispatch-scheduled failed:', err);
    const message = err instanceof Error ? err.message : 'Something went wrong.';
    return new Response(JSON.stringify({ error: message }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
