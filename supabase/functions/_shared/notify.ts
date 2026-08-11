// ============================================================================
// Core send pipeline, shared by the immediate-send entrypoint
// (send-notification/index.ts) and the cron-invoked one
// (dispatch-scheduled/index.ts) so "send now" and "a scheduled send firing
// on time" are guaranteed to behave identically — one function, two callers.
// ============================================================================
import { loadServiceAccount, sendToDevice } from './fcm.ts';

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

/* Mirrors supabase.sql's resolve_notification_audience() exactly — see that
   function's comment for why this Edge Function can't just call it over RPC
   (a service-role caller has no auth.uid(), so the SQL function's own
   public.is_admin() check would always fail for it). Keep both in sync if
   you add a new audience_type. Runs with the service role client, which
   bypasses RLS, so it can read every profile regardless of who's asking —
   the admin-only gate for *triggering* a send lives in index.ts, not here. */
export async function resolveAudience(
  supabase: SupabaseClient,
  audienceType: string,
  filter: Record<string, unknown>
): Promise<string[]> {
  let query = supabase.from('profiles').select('id');

  switch (audienceType) {
    case 'all':
      break;
    case 'players':
      query = query.eq('is_organiser', false);
      break;
    case 'organisers':
      query = query.eq('is_organiser', true);
      break;
    case 'country':
      if (!filter.country) return [];
      query = query.ilike('country', String(filter.country));
      break;
    case 'city':
      if (!filter.district) return [];
      query = query.ilike('district', String(filter.district));
      break;
    case 'selected': {
      const ids = Array.isArray(filter.user_ids) ? (filter.user_ids as string[]) : [];
      if (!ids.length) return [];
      query = query.in('id', ids);
      break;
    }
    case 'user':
      if (!filter.user_id) return [];
      query = query.eq('id', String(filter.user_id));
      break;
    default:
      throw new Error(`unknown audience_type: ${audienceType}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as { id: string }[]).map((r) => r.id);
}

/* Only the destinations that actually exist and work today — see the
   supabase.sql comment on the notifications table for why "open a specific
   team" / "open tournament followers" aren't offered as targets at all (the
   data to resolve them doesn't exist yet). index.html's boot() reads `tour`,
   `player` and `go=notifications` additively alongside its existing deep
   links, so none of these break an existing URL contract. */
export function buildDeepLink(origin: string, actionType: string, actionTarget: string | null): string | null {
  switch (actionType) {
    case 'open_tournament':
      return actionTarget ? `${origin}/index.html?tour=${encodeURIComponent(actionTarget)}` : null;
    case 'open_live_match':
      return actionTarget ? `${origin}/live.html?m=${encodeURIComponent(actionTarget)}` : null;
    case 'open_player':
      return actionTarget ? `${origin}/index.html?player=${encodeURIComponent(actionTarget)}` : null;
    case 'open_notifications':
      return `${origin}/index.html?go=notifications`;
    case 'open_home':
    case 'none':
    default:
      return null;
  }
}

/* Bounded concurrency for the FCM fan-out — plain Promise.all across
   thousands of devices would open thousands of simultaneous connections
   from one Edge Function invocation; this caps it instead, per the brief's
   "basic protection against accidental notification spam / rate limiting
   where appropriate". */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(worker));
  return results;
}

export interface SendResult {
  status: 'sent' | 'partially_failed' | 'failed';
  recipientsTotal: number;
  pushSubmitted: number;
  pushFailed: number;
  errorMessage: string | null;
}

/* The one place that actually sends. Both entrypoints call this after their
   own, different authorization checks (admin JWT for an immediate send,
   shared cron secret for a scheduled one) — this function itself trusts
   that whoever called it already verified the caller was allowed to. */
export async function sendNotification(supabase: SupabaseClient, notificationId: string, origin: string): Promise<SendResult> {
  // Atomic claim: only a row still in draft/scheduled gets picked up, and
  // this UPDATE...WHERE...RETURNING is itself the guard against a double
  // click or an overlapping cron tick sending the same notification twice —
  // a second concurrent call finds zero rows to update and bails cleanly.
  const { data: claimed, error: claimError } = await supabase
    .from('notifications')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .in('status', ['draft', 'scheduled'])
    .eq('id', notificationId)
    .select()
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    throw new Error('Notification is not in a sendable state (already sent, sending, or cancelled).');
  }

  const finish = async (result: SendResult) => {
    await supabase
      .from('notifications')
      .update({
        status: result.status,
        sent_at: new Date().toISOString(),
        recipients_total: result.recipientsTotal,
        push_submitted: result.pushSubmitted,
        push_failed: result.pushFailed,
        error_message: result.errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', notificationId);
    return result;
  };

  let userIds: string[];
  try {
    userIds = await resolveAudience(supabase, claimed.audience_type, claimed.audience_filter || {});
  } catch (err) {
    return finish({ status: 'failed', recipientsTotal: 0, pushSubmitted: 0, pushFailed: 0, errorMessage: String(err) });
  }

  if (!userIds.length) {
    return finish({ status: 'failed', recipientsTotal: 0, pushSubmitted: 0, pushFailed: 0, errorMessage: 'No recipients matched this audience.' });
  }

  // In-app Notification Center entry for every matched user, regardless of
  // whether they have a push-capable device registered — this is what makes
  // the notification show up next time they open the app even if push
  // delivery below fails or they've never granted browser permission.
  const recipientRows = userIds.map((user_id) => ({ notification_id: notificationId, user_id }));
  const { error: recipientsError } = await supabase
    .from('notification_recipients')
    .upsert(recipientRows, { onConflict: 'notification_id,user_id', ignoreDuplicates: true });
  if (recipientsError) throw recipientsError;

  const { data: devices, error: devicesError } = await supabase
    .from('notification_devices')
    .select('fcm_token, user_id')
    .in('user_id', userIds);
  if (devicesError) throw devicesError;

  if (!devices || !devices.length) {
    // Real, honest outcome: every matched user got an in-app notification,
    // nobody had push enabled yet. Not a failure of the send itself.
    return finish({ status: 'sent', recipientsTotal: userIds.length, pushSubmitted: 0, pushFailed: 0, errorMessage: null });
  }

  const serviceAccount = loadServiceAccount();
  const deepLink = buildDeepLink(origin, claimed.action_type, claimed.action_target);
  const payload = { title: claimed.title, body: claimed.message, imageUrl: claimed.image_url, deepLink, notificationId };

  const tokensToRemove: string[] = [];
  let submitted = 0;
  let failed = 0;

  await mapWithConcurrency(devices as { fcm_token: string }[], 25, async (device) => {
    const result = await sendToDevice(serviceAccount, device.fcm_token, payload);
    if (result.ok) {
      submitted++;
    } else {
      failed++;
      if (result.shouldRemoveToken) tokensToRemove.push(device.fcm_token);
    }
  });

  if (tokensToRemove.length) {
    // Expired/uninstalled/invalid — matches the brief's "handle invalid
    // token / expired token / removed device" requirement. A user who
    // re-enables push later just registers a fresh token; nothing to
    // recover here.
    await supabase.from('notification_devices').delete().in('fcm_token', tokensToRemove);
  }

  const status: SendResult['status'] = failed === 0 ? 'sent' : submitted === 0 ? 'failed' : 'partially_failed';
  return finish({
    status,
    recipientsTotal: userIds.length,
    pushSubmitted: submitted,
    pushFailed: failed,
    errorMessage: failed > 0 ? `${failed} device${failed === 1 ? '' : 's'} failed to accept the push message.` : null,
  });
}
