// ============================================================================
// POST /functions/v1/send-notification   { notification_id: string }
//
// Called from the admin panel (cloud.js sendNotificationNow(), via
// supabase.functions.invoke, which automatically forwards the admin's own
// session as the Authorization header) when they click "Send Now", or right
// after creating a notification with no scheduled_at. This is the ONLY
// place in the whole system that holds the service role key and the FCM
// service account — see _shared/fcm.ts and _shared/notify.ts for why.
//
// Tournament Organizer Control Center — Phase 8: a platform admin can send
// ANY notification, unchanged. A tournament owner/manager can ALSO send —
// but only one they themselves created (organizer_create_notification() in
// supabase.sql already refuses to let them create anything but a
// tournament-scoped audience_type targeting their own tournament/team), so
// this function doesn't need to re-derive that scoping itself — it only
// needs to confirm the caller both created it and still holds a
// manager/owner role on the tournament it targets.
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { sendNotification } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') throw new Error('Method not allowed');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Proves who's calling, nothing more — this client is scoped by RLS
    // exactly like the caller's own browser session, using the anon key
    // plus their forwarded JWT. It cannot read or write anything their own
    // account couldn't already touch through the app.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) throw new Error('Unauthorized: invalid session');

    const body = await req.json().catch(() => ({}));
    const notificationId = body?.notification_id;
    if (!notificationId || typeof notificationId !== 'string') {
      throw new Error('notification_id is required');
    }

    // Admin status is re-verified here, independently of anything the
    // browser claims about itself — the `admins` table's existing RLS
    // policy already lets any authenticated user read it (that's how the
    // app decides whether to show its own Admin tab), so the caller-scoped
    // client above can answer this without any elevated access yet.
    const { data: adminRow } = await callerClient
      .from('admins')
      .select('uid')
      .eq('uid', userData.user.id)
      .maybeSingle();

    let authorized = !!adminRow;

    if (!authorized) {
      // Not a platform admin — see if this is a tournament owner/manager
      // sending a notification they created themselves. The caller-scoped
      // client can read this row at all only because of the Phase 8 RLS
      // change letting a creator read their own notification.
      const { data: notifRow } = await callerClient
        .from('notifications')
        .select('created_by, audience_type, audience_filter')
        .eq('id', notificationId)
        .maybeSingle();

      if (notifRow && notifRow.created_by === userData.user.id) {
        let tournamentId: string | null = null;
        if (notifRow.audience_type === 'team_members') {
          const teamId = notifRow.audience_filter?.team_id;
          if (teamId) {
            const { data: teamRow } = await callerClient
              .from('tournament_teams')
              .select('tournament_id')
              .eq('id', teamId)
              .maybeSingle();
            tournamentId = teamRow?.tournament_id ?? null;
          }
        } else if (['tournament_participants', 'tournament_officials'].includes(notifRow.audience_type)) {
          tournamentId = notifRow.audience_filter?.tournament_id ?? null;
        }
        if (tournamentId) {
          const { data: isManager } = await callerClient.rpc('is_tournament_manager_or_owner', {
            p_tournament_id: tournamentId,
          });
          authorized = !!isManager;
        }
      }
    }

    if (!authorized) throw new Error('Forbidden: admin or tournament organizer access required');

    // Resolving the full audience, fanning out notification_recipients, and
    // reading device tokens across every matched user needs access no admin
    // RLS policy grants (notification_devices intentionally has none at
    // all) — so only from here on, and only after both checks above passed,
    // does this function touch the service role key.
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const origin = Deno.env.get('APP_ORIGIN') || req.headers.get('origin') || '';
    const result = await sendNotification(serviceClient, notificationId, origin);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-notification failed:', err);
    // Message only — never the raw error object, which could contain a
    // Postgres error with column/table names or other internal detail.
    const message = err instanceof Error ? err.message : 'Something went wrong.';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
