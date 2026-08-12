// ============================================================================
// STANDALONE, DASHBOARD-DEPLOYABLE VERSION of send-notification.
//
// The CLI project structure (send-notification/index.ts + a sibling
// _shared/ folder used by both Edge Functions) doesn't work through the
// Supabase dashboard's browser-based function editor, which only manages
// files inside one function at a time. This file inlines everything
// _shared/cors.ts, _shared/fcm.ts, and _shared/notify.ts would otherwise
// provide, so it can be pasted as the entire contents of a single
// "index.ts" in the dashboard with nothing else to add.
//
// HOW TO DEPLOY THIS VIA THE DASHBOARD:
//   1. Edge Functions -> Create a new function.
//   2. Function name: send-notification   (must be exactly this — cloud.js
//      calls supabase.functions.invoke('send-notification', ...))
//   3. Delete the template code in index.ts and paste this entire file in
//      its place.
//   4. Click "Deploy function".
//   5. Go to Edge Functions -> Secrets and add (if not already set):
//        FCM_SERVICE_ACCOUNT_JSON   = the whole JSON key file from Firebase
//                                     Console -> Project Settings ->
//                                     Service Accounts -> Generate new
//                                     private key
//        APP_ORIGIN                 = your production URL, e.g.
//                                     https://your-app.vercel.app
//      (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
//      injected automatically by Supabase — you don't set those yourself.)
//   6. Repeat this whole process for dispatch-scheduled using its own
//      dashboard-standalone.ts file.
//
// If you later switch to the Supabase CLI, use the original split files
// (index.ts + ../_shared/*.ts) instead — they're the source of truth and
// this file is generated from them. Keep both in sync if you ever change
// the notification-sending logic.
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------------
// FCM HTTP v1, authenticated via a Firebase service-account JWT-bearer OAuth2
// flow (never the legacy, deprecated FCM "server key"). The private key
// never leaves this function — it's read from the FCM_SERVICE_ACCOUNT_JSON
// secret and used only to sign a short-lived JWT locally with Deno's
// built-in Web Crypto API.
// ---------------------------------------------------------------------------

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  arr.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(serviceAccount: ServiceAccount): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedClaims = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60 > Date.now() / 1000) {
    return cachedToken.accessToken;
  }
  const jwt = await signJwt(serviceAccount);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM auth failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = { accessToken: data.access_token, expiresAt: Math.floor(Date.now() / 1000) + data.expires_in };
  return cachedToken.accessToken;
}

function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!raw) {
    throw new Error(
      'FCM_SERVICE_ACCOUNT_JSON secret is not set. Generate a service account key in ' +
      'Firebase Console -> Project Settings -> Service Accounts -> Generate new private key, ' +
      'then add it as a secret in Edge Functions -> Secrets.'
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON secret is not valid JSON.');
  }
}

interface PushPayload {
  title: string;
  body: string;
  imageUrl?: string | null;
  deepLink?: string | null;
  notificationId: string;
}

type FcmSendResult =
  | { ok: true }
  | { ok: false; shouldRemoveToken: boolean; error: string };

async function sendToDevice(serviceAccount: ServiceAccount, token: string, payload: PushPayload): Promise<FcmSendResult> {
  const accessToken = await getAccessToken(serviceAccount);
  const message: Record<string, unknown> = {
    token,
    notification: {
      title: payload.title,
      body: payload.body,
      ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
    },
    data: { notification_id: payload.notificationId, ...(payload.deepLink ? { deep_link: payload.deepLink } : {}) },
    webpush: {
      fcm_options: payload.deepLink ? { link: payload.deepLink } : undefined,
      notification: { icon: '/icon-192.png' },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }
  );

  if (res.ok) return { ok: true };

  const body = await res.text();
  const permanent = body.includes('UNREGISTERED') || body.includes('INVALID_ARGUMENT') || body.includes('NOT_FOUND');
  return { ok: false, shouldRemoveToken: permanent, error: body.slice(0, 300) };
}

// ---------------------------------------------------------------------------
// Core send pipeline — audience resolution, deep-link building, the atomic
// claim-before-send guard, and the bounded-concurrency FCM fan-out.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function resolveAudience(
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

function buildDeepLink(origin: string, actionType: string, actionTarget: string | null): string | null {
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

interface SendResult {
  status: 'sent' | 'partially_failed' | 'failed';
  recipientsTotal: number;
  pushSubmitted: number;
  pushFailed: number;
  errorMessage: string | null;
}

async function sendNotification(supabase: SupabaseClient, notificationId: string, origin: string): Promise<SendResult> {
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

// ---------------------------------------------------------------------------
// HTTP entrypoint — POST /functions/v1/send-notification { notification_id }
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') throw new Error('Method not allowed');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) throw new Error('Unauthorized: invalid session');

    const { data: adminRow } = await callerClient
      .from('admins')
      .select('uid')
      .eq('uid', userData.user.id)
      .maybeSingle();
    if (!adminRow) throw new Error('Forbidden: admin access required');

    const body = await req.json().catch(() => ({}));
    const notificationId = body?.notification_id;
    if (!notificationId || typeof notificationId !== 'string') {
      throw new Error('notification_id is required');
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const origin = Deno.env.get('APP_ORIGIN') || req.headers.get('origin') || '';
    const result = await sendNotification(serviceClient, notificationId, origin);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-notification failed:', err);
    const message = err instanceof Error ? err.message : 'Something went wrong.';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
