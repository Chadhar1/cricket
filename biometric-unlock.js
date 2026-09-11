/* Biometric "quick unlock" -- a purely client-side, no-backend gate layered
   on top of the Supabase session that's already persisted in this browser
   (localStorage). Uses the WebAuthn platform authenticator -- Face ID/
   Touch ID/Android fingerprint, whatever the OS's Chrome/Chromium already
   integrates with -- as a local "prove you're really holding this device"
   check.

   IMPORTANT -- what this is not: this does NOT create a new Supabase
   session and is NOT a way to sign in on a device that was never signed in
   before. There is no server-side verification of the WebAuthn assertion
   at all, on purpose: we only ever call this when a valid Supabase refresh
   token is already sitting in this browser's storage, so the one thing we
   need proven is "the person holding the device right now passed the OS's
   own biometric check" -- the same category of guarantee as an OS screen
   lock, not a second authentication factor recognised by the server. A
   real passwordless sign-in (a credential that can mint a *new* session on
   a fresh device) would need actual server-side verification -- a stored
   public key plus a real challenge/response check in an edge function --
   which is a materially bigger feature and deliberately not this one.

   One credential per device/browser: enabling it again for a different
   account overwrites the previous record, matching how a shared/family
   device's lock should behave (only ever guards whichever account most
   recently turned it on, on this device).
*/

const STORAGE_KEY = 'cc_biometric_lock_v1';

function bytesToB64(bytes){
  let bin = '';
  const arr = new Uint8Array(bytes);
  for(let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}
function b64ToBytes(b64){
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function readRecord(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch(err){ return null; }
}
function writeRecord(rec){
  if(rec) localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  else localStorage.removeItem(STORAGE_KEY);
}

/* Feature-detects an actual platform authenticator (fingerprint/face) --
   not just "this browser knows what WebAuthn is". A desktop Chrome with no
   fingerprint reader correctly reports false here, so the toggle in the
   Account page simply never shows rather than offering something that
   would fail. */
export async function isBiometricSupported(){
  try{
    if(!(window.PublicKeyCredential && navigator.credentials)) return false;
    if(!PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  }catch(err){ return false; }
}

export function isBiometricEnabledForUser(userId){
  const rec = readRecord();
  return !!(rec && rec.userId === userId && rec.credentialId);
}

export function disableBiometricUnlock(){
  writeRecord(null);
}

/* Runs the actual OS enrollment ceremony (the fingerprint/face prompt) and,
   only on success, remembers the resulting credential for this device. The
   `challenge` here never leaves the device and is never checked against
   anything -- see the file header for why that's fine for this feature. */
export async function enableBiometricUnlock(userId, email){
  if(!userId) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = new TextEncoder().encode(userId).slice(0, 64);
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Cricket Connect' },
      user: { id: userIdBytes, name: email || 'player', displayName: email || 'CricketConnect player' },
      challenge,
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      attestation: 'none'
    }
  });
  if(!cred) return false;
  writeRecord({ userId, credentialId: bytesToB64(cred.rawId) });
  return true;
}

/* Re-runs the same OS prompt against the previously-enrolled credential.
   Success just resolves true; there is nothing here that talks to
   Supabase or the network at all. */
export async function verifyBiometricUnlock(){
  const rec = readRecord();
  if(!rec) return false;
  try{
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: b64ToBytes(rec.credentialId), type: 'public-key', transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000
      }
    });
    return !!assertion;
  }catch(err){
    console.error('verifyBiometricUnlock failed:', err);
    return false;
  }
}
