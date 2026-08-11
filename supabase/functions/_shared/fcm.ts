// ============================================================================
// Firebase Cloud Messaging — HTTP v1 API, called with a short-lived OAuth2
// access token obtained from a Firebase service account (never the legacy
// FCM "server key", which Google is retiring and which this app has never
// used). The service account's private key never leaves this Edge Function:
// it's read from the FCM_SERVICE_ACCOUNT_JSON secret (server-side only, set
// via `supabase secrets set` — see the repo's notification setup notes) and
// used only to sign a short-lived JWT locally with the Web Crypto API
// already built into Deno. Nothing here ever touches the browser.
// ============================================================================

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

/* Cached in-memory for the lifetime of this Edge Function instance (Deno
   isolates are reused across invocations for a while) so a batch send of
   thousands of devices doesn't mint a fresh OAuth token per device — only
   refreshed once it's within 60s of expiring. */
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

export function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!raw) {
    throw new Error(
      'FCM_SERVICE_ACCOUNT_JSON secret is not set. Generate a service account key in ' +
      'Firebase Console -> Project Settings -> Service Accounts -> Generate new private key, ' +
      'then run: supabase secrets set FCM_SERVICE_ACCOUNT_JSON=\'<the whole JSON file contents>\''
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON secret is not valid JSON.');
  }
}

export interface PushPayload {
  title: string;
  body: string;
  imageUrl?: string | null;
  /* Opened when the user taps the notification — resolved client-side from
     action_type/action_target before this ever reaches FCM, so by the time
     it gets here it's always a real, already-validated in-app path (see
     buildDeepLink in notify.ts), never a raw external URL. */
  deepLink?: string | null;
  notificationId: string;
}

export type FcmSendResult =
  | { ok: true }
  | { ok: false; shouldRemoveToken: boolean; error: string };

/* Sends to exactly one device token. Callers loop over a recipient's device
   list themselves — FCM HTTP v1 has no native multicast endpoint, unlike the
   deprecated legacy API. shouldRemoveToken is set for the specific error
   codes FCM uses to mean "this token will never work again" (uninstalled,
   unsubscribed, or malformed) versus a transient failure worth leaving in
   place for the next send. */
export async function sendToDevice(serviceAccount: ServiceAccount, token: string, payload: PushPayload): Promise<FcmSendResult> {
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
  // https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
  const permanent = body.includes('UNREGISTERED') || body.includes('INVALID_ARGUMENT') || body.includes('NOT_FOUND');
  return { ok: false, shouldRemoveToken: permanent, error: body.slice(0, 300) };
}
