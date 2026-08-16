/* ===========================================================================
   recorder.js — the Video Compositor.

   Owns the camera, the composite canvas, and the MediaRecorder. Knows
   nothing about cricket scoring — it's handed a `getOverlayState()`
   function and a template id, and draws whatever that returns onto the
   canvas every frame via overlays.js's drawOverlay(). This is the layer
   the architecture proposal called the Video Compositor:

     Scoring Engine -> Event Adapter (broadcast-events.js) ->
     Broadcast Overlay Renderer (overlays.js) -> Video Compositor (this file)
     -> Local Video File

   HONEST LIMITATIONS (per the DEVELOPMENT RULE — documented here rather
   than silently working around or pretending they don't exist):

   1. OUTPUT FORMAT IS WEBM, NOT MP4. MediaRecorder on Chrome/Android
      (the real deployed target — see the TWA wrapper) only reliably
      produces video/webm (VP8/VP9 + Opus). True video/mp4 recording
      support in MediaRecorder is effectively Safari-only. The file this
      module produces is a genuine, fully self-contained .webm — the score
      overlay and event animations are pixels baked into the video stream
      itself (verifiable by opening it outside the app), it just isn't a
      .mp4 container. This was an explicit, agreed trade-off (see
      RECORDING_OVERLAY_FEASIBILITY_PROPOSAL.md) rather than an oversight.

   2. MEMORY: recorded chunks accumulate in memory as an array of Blob
      parts (via MediaRecorder's timeslice) until the recording stops,
      then are combined into one Blob for saving. This is the standard
      browser-recording pattern and avoids ever holding one giant buffer
      mid-recording, but there is no true stream-straight-to-disk API
      available on Android Chrome (File System Access API's writable
      streams are desktop-only), so total memory use still grows with the
      length of the recording. Expect this to be the practical ceiling on
      "how long can one recording safely run" on a given phone, not a
      hard-coded time limit.

   3. requestAnimationFrame can be throttled or fully paused by the browser
      when the tab/app is backgrounded on some platforms — MediaRecorder
      itself keeps running, but the overlay may stop updating (freeze on
      the last drawn frame) until the app is foregrounded again. This is
      flagged rather than silently accepted; recorder.js does not attempt
      to fake continued animation while backgrounded.
   =========================================================================== */

import { drawOverlay, eventDuration } from './overlays.js';
import { onBroadcastEvent } from './broadcast-events.js';

/* ---- module state (one recording at a time, by design) ---- */
let cameraStream = null;
let micTrack = null;
let previewVideoEl = null;     // hidden <video> fed by the camera stream — the frame source
let compositeCanvas = null;
let compositeCtx = null;
let rafId = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartedAt = 0;
let pausedAccumMs = 0;
let pauseStartedAt = 0;
let unsubscribeEvents = null;
let eventQueue = [];
let activeEvent = null;        // { type, player, dismissal, resultText, startedAt }
let currentTemplateId = 'classic';
let getOverlayStateFn = null;  // () => overlay state object, supplied by the caller (app.js)
let currentFacingMode = 'environment';
let tickListeners = [];
let errorListeners = [];

function emitTick(){ tickListeners.forEach(fn=>{ try{ fn(getStatus()); }catch(e){ console.error(e); } }); }
function emitError(err){ errorListeners.forEach(fn=>{ try{ fn(err); }catch(e){ console.error(e); } }); }
export function onRecorderTick(fn){ tickListeners.push(fn); return ()=>{ const i=tickListeners.indexOf(fn); if(i>=0) tickListeners.splice(i,1); }; }
export function onRecorderError(fn){ errorListeners.push(fn); return ()=>{ const i=errorListeners.indexOf(fn); if(i>=0) errorListeners.splice(i,1); }; }

/* ---------------------------------------------------------------------------
   Storage — checked before recording starts, per the "show available
   storage and estimated capacity, never crash from running out" requirement.
   --------------------------------------------------------------------------- */
const ASSUMED_BITRATE_BPS = 2_500_000; // ~2.5 Mbps, a reasonable 720p30 VP8/VP9 target

export async function getStorageEstimate(){
  if(!(navigator.storage && navigator.storage.estimate)){
    return { supported:false, availableBytes:null, estimatedMinutes:null };
  }
  try{
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    const availableBytes = Math.max(0, quota - usage);
    const estimatedMinutes = availableBytes / (ASSUMED_BITRATE_BPS / 8) / 60;
    return { supported:true, availableBytes, estimatedMinutes };
  }catch(err){
    return { supported:false, availableBytes:null, estimatedMinutes:null };
  }
}
export const LOW_STORAGE_MINUTES_WARNING = 10; // warn the organizer below this

/* ---------------------------------------------------------------------------
   Camera preview.
   --------------------------------------------------------------------------- */
export function isCameraSupported(){
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

/* Returns { stream, videoEl, capabilities, error }. Never throws — camera
   or mic denial is reported through `error` so the caller can show a clear
   message rather than the feature just silently not working. */
export async function openCameraPreview({ facingMode = 'environment', width = 1280, height = 720, frameRate = 30, audio = false } = {}){
  if(!isCameraSupported()){
    return { stream:null, videoEl:null, capabilities:null, error:'Recording needs camera + MediaRecorder support, which this browser does not have.' };
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } },
      audio
    });
    cameraStream = stream;
    currentFacingMode = facingMode;
    micTrack = audio ? (stream.getAudioTracks()[0] || null) : null;

    previewVideoEl = document.createElement('video');
    previewVideoEl.muted = true;
    previewVideoEl.playsInline = true;
    previewVideoEl.autoplay = true;
    previewVideoEl.srcObject = stream;
    await previewVideoEl.play().catch(()=>{});

    const videoTrack = stream.getVideoTracks()[0];
    const capabilities = videoTrack && videoTrack.getCapabilities ? videoTrack.getCapabilities() : null;
    return { stream, videoEl: previewVideoEl, capabilities, error:null };
  }catch(err){
    const msg = err && err.name === 'NotAllowedError'
      ? 'Camera access was denied. Allow camera access in your browser settings to record.'
      : err && err.name === 'NotFoundError'
        ? 'No camera was found on this device.'
        : 'Could not start the camera: ' + (err && err.message ? err.message : String(err));
    return { stream:null, videoEl:null, capabilities:null, error: msg };
  }
}

/* Mounts whatever's currently the live frame source (the raw camera
   <video> before recording starts, or the composite <canvas> once
   startRecording() has created it) into a container the caller controls.
   Call again after startRecording() to swap the mounted element from the
   plain camera preview to the actual composite — so what the organizer
   sees on screen is exactly what's being written to the file, overlay
   included, not a separate "trust me" preview. */
export function mountPreview(containerEl){
  if(!containerEl) return;
  const el = compositeCanvas || previewVideoEl;
  if(!el) return;
  containerEl.innerHTML = '';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.objectFit = 'cover';
  el.style.display = 'block';
  containerEl.appendChild(el);
}
export function getPreviewVideoElement(){ return previewVideoEl; }
export function getCompositeCanvas(){ return compositeCanvas; }

/* Mutes/unmutes the already-captured mic track in place (MediaStreamTrack
   .enabled), rather than re-requesting getUserMedia — works identically
   whether called before or during a recording, since the same track
   object is what's feeding the MediaRecorder either way. If no mic track
   was ever requested (audio:false at openCameraPreview() time), there is
   nothing to toggle — hasMicTrack() tells the caller that up front rather
   than this silently doing nothing. */
export function hasMicTrack(){ return !!micTrack; }
export function setMicEnabled(enabled){ if(micTrack) micTrack.enabled = !!enabled; }

export function stopCameraPreview(){
  if(cameraStream){
    cameraStream.getTracks().forEach(t=>t.stop());
    cameraStream = null;
  }
  micTrack = null;
  if(previewVideoEl){ previewVideoEl.srcObject = null; previewVideoEl = null; }
}

/* Toggles between front/back camera. Only meaningful if the device
   actually has more than one — callers should check
   navigator.mediaDevices.enumerateDevices() for videoinput count > 1
   before showing a switch-camera control at all. Safe to call whether or
   not a recording is currently running: the composite loop always reads
   the current previewVideoEl, so swapping the underlying video feed under
   it works transparently, recording included.

   While a recording IS running, only the video side is ever touched. The
   mic track already embedded in the MediaRecorder's output stream (built
   once, at startRecording() time — see the `tracks` array there) must be
   left completely alone: stopping it as a side effect of tearing down the
   old camera stream would silently kill audio for the rest of the
   recording. So this deliberately does not call stopCameraPreview()/
   openCameraPreview() (which always tear down and re-request everything,
   mic included) while recording — it stops only the outgoing video
   track(s) and leaves the live mic track running exactly as it was. */
export async function switchCamera(){
  const nextFacing = currentFacingMode === 'environment' ? 'user' : 'environment';
  const keepMicAlive = isRecording() && !!micTrack;
  const oldStream = cameraStream;
  const oldVideoEl = previewVideoEl;
  try{
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: nextFacing },
      audio: keepMicAlive ? false : !!micTrack
    });
    if(oldStream){
      oldStream.getVideoTracks().forEach(t=>t.stop());
      if(!keepMicAlive) oldStream.getAudioTracks().forEach(t=>t.stop());
    }
    cameraStream = newStream;
    currentFacingMode = nextFacing;
    if(!keepMicAlive) micTrack = newStream.getAudioTracks()[0] || null;

    previewVideoEl = document.createElement('video');
    previewVideoEl.muted = true;
    previewVideoEl.playsInline = true;
    previewVideoEl.autoplay = true;
    previewVideoEl.srcObject = newStream;
    await previewVideoEl.play().catch(()=>{});
    if(oldVideoEl) oldVideoEl.srcObject = null;

    const videoTrack = newStream.getVideoTracks()[0];
    const capabilities = videoTrack && videoTrack.getCapabilities ? videoTrack.getCapabilities() : null;
    return { stream: newStream, videoEl: previewVideoEl, capabilities, error: null };
  }catch(err){
    const msg = 'Could not switch camera: ' + (err && err.message ? err.message : String(err));
    emitError(msg);
    return { stream:null, videoEl:null, capabilities:null, error: msg };
  }
}

/* ---------------------------------------------------------------------------
   Recording.
   --------------------------------------------------------------------------- */
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9',
  'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8',
  'video/webm'
];
function pickSupportedMimeType(){
  for(const m of MIME_CANDIDATES){
    if(window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return ''; // let the browser pick its own default
}

export function isRecording(){ return !!mediaRecorder && mediaRecorder.state !== 'inactive'; }
export function isPaused(){ return !!mediaRecorder && mediaRecorder.state === 'paused'; }
export function getElapsedMs(){
  if(!recordingStartedAt) return 0;
  const pausedNow = isPaused() ? (Date.now() - pauseStartedAt) : 0;
  return Date.now() - recordingStartedAt - pausedAccumMs - pausedNow;
}
export function setActiveTemplate(id){ currentTemplateId = id; }
export function getActiveTemplate(){ return currentTemplateId; }

/* opts = { templateId, getOverlayState, width, height, fps }
   getOverlayState is a zero-arg function supplied by the caller (app.js)
   that returns the current overlays.js buildOverlayState() result plus
   whatever tournament/team-crest extras it wants shown — called fresh
   every frame, so it always reflects the live match, not a stale copy. */
export function startRecording({ templateId = 'classic', getOverlayState, width = 1280, height = 720, fps = 30 } = {}){
  if(!cameraStream || !previewVideoEl) throw new Error('Call openCameraPreview() before startRecording().');
  if(isRecording()) throw new Error('Already recording.');

  currentTemplateId = templateId;
  getOverlayStateFn = getOverlayState;
  recordedChunks = [];
  eventQueue = [];
  activeEvent = null;
  pausedAccumMs = 0;

  compositeCanvas = document.createElement('canvas');
  compositeCanvas.width = width;
  compositeCanvas.height = height;
  compositeCtx = compositeCanvas.getContext('2d');

  // Subscribe to the ball-by-ball event stream only while actually
  // recording — the event adapter (broadcast-events.js) has no idea a
  // recording exists, this module simply listens while it cares.
  unsubscribeEvents = onBroadcastEvent(evt=>{ eventQueue.push({ ...evt, startedAt: null }); });

  const canvasStream = compositeCanvas.captureStream(fps);
  const tracks = [...canvasStream.getVideoTracks()];
  if(micTrack) tracks.push(micTrack);
  const outputStream = new MediaStream(tracks);

  const mimeType = pickSupportedMimeType();
  try{
    mediaRecorder = mimeType ? new MediaRecorder(outputStream, { mimeType }) : new MediaRecorder(outputStream);
  }catch(err){
    emitError('Could not start the recorder: ' + (err && err.message ? err.message : String(err)));
    throw err;
  }
  mediaRecorder.ondataavailable = (e)=>{ if(e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onerror = (e)=>{ emitError('Recording error: ' + (e && e.error ? e.error.message : 'unknown encoder error')); };

  mediaRecorder.start(1000); // 1s timeslice — see the memory note at the top of this file
  recordingStartedAt = Date.now();
  runCompositeLoop();
  emitTick();
  return { mimeType: mediaRecorder.mimeType || mimeType };
}

export function pauseRecording(){
  if(!isRecording() || isPaused()) return;
  mediaRecorder.pause();
  pauseStartedAt = Date.now();
  emitTick();
}
export function resumeRecording(){
  if(!isRecording() || !isPaused()) return;
  pausedAccumMs += Date.now() - pauseStartedAt;
  mediaRecorder.resume();
  emitTick();
}

/* Resolves once the encoder has actually flushed its last chunk — never
   assume the recording is "done" the instant stop() is called. */
export function stopRecording(){
  return new Promise((resolve, reject)=>{
    if(!mediaRecorder){ reject(new Error('Not recording.')); return; }
    const mimeType = mediaRecorder.mimeType || 'video/webm';
    const startedAt = recordingStartedAt;
    mediaRecorder.onstop = ()=>{
      const durationMs = Date.now() - startedAt - pausedAccumMs;
      const blob = new Blob(recordedChunks, { type: mimeType });
      cleanupAfterStop();
      resolve({ blob, mimeType, durationMs, sizeBytes: blob.size });
    };
    try{ mediaRecorder.stop(); }
    catch(err){ cleanupAfterStop(); reject(err); }
  });
}

function cleanupAfterStop(){
  if(rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if(unsubscribeEvents){ unsubscribeEvents(); unsubscribeEvents = null; }
  mediaRecorder = null;
  recordingStartedAt = 0;
  pausedAccumMs = 0;
  activeEvent = null;
  eventQueue = [];
}

/* Fully tears down camera + any in-progress recording — call on navigating
   away from the record screen, e.g. if the organizer backs out without
   saving, so tracks/mic don't keep running in the background. */
export async function teardown(){
  if(isRecording()){
    try{ await stopRecording(); }catch(e){ /* best-effort */ }
  }
  stopCameraPreview();
}

/* ---------------------------------------------------------------------------
   Composite loop — draws camera frame + overlay onto the canvas every
   animation frame. This is the one place camera pixels and overlay pixels
   actually get merged into a single image, which is what makes the score
   genuinely part of the saved video rather than a floating on-screen layer.
   --------------------------------------------------------------------------- */
function runCompositeLoop(){
  const draw = ()=>{
    if(!compositeCtx || !previewVideoEl){ rafId = null; return; }
    const w = compositeCanvas.width, h = compositeCanvas.height;

    if(previewVideoEl.readyState >= 2){
      // Cover-fit the camera frame into the canvas — handles the video's
      // native aspect ratio not exactly matching the recording resolution
      // (e.g. after a mid-recording rotation) without ever stretching it.
      const vw = previewVideoEl.videoWidth || w, vh = previewVideoEl.videoHeight || h;
      const scale = Math.max(w / vw, h / vh);
      const dw = vw * scale, dh = vh * scale;
      compositeCtx.drawImage(previewVideoEl, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      compositeCtx.fillStyle = '#000';
      compositeCtx.fillRect(0, 0, w, h);
    }

    advanceActiveEvent();
    const state = getOverlayStateFn ? getOverlayStateFn() : null;
    drawOverlay(currentTemplateId, compositeCtx, w, h, state, activeEvent);

    emitTick();
    rafId = requestAnimationFrame(draw);
  };
  rafId = requestAnimationFrame(draw);
}

function advanceActiveEvent(){
  const now = Date.now();
  if(activeEvent){
    const dur = eventDuration(activeEvent.type);
    const progress = (now - activeEvent.startedAt) / dur;
    if(progress >= 1) activeEvent = null;
    else activeEvent.progress = progress;
  }
  if(!activeEvent && eventQueue.length){
    activeEvent = eventQueue.shift();
    activeEvent.startedAt = now;
    activeEvent.progress = 0;
  }
}

export function getStatus(){
  return {
    recording: isRecording(),
    paused: isPaused(),
    elapsedMs: getElapsedMs(),
    templateId: currentTemplateId,
    chunkCount: recordedChunks.length
  };
}

/* ---------------------------------------------------------------------------
   Recordable resolution/framerate options — filtered to what the device's
   actual camera capabilities report, per "only show what the device
   actually supports". Falls back to a conservative single option if the
   browser doesn't expose getCapabilities() at all (Safari, some Android
   WebViews).
   --------------------------------------------------------------------------- */
export function availableQualityOptions(capabilities){
  const all = [
    { id:'720p30', label:'720p · 30fps', width:1280, height:720, fps:30 },
    { id:'720p60', label:'720p · 60fps', width:1280, height:720, fps:60 },
    { id:'1080p30', label:'1080p · 30fps', width:1920, height:1080, fps:30 },
    { id:'1080p60', label:'1080p · 60fps', width:1920, height:1080, fps:60 }
  ];
  if(!capabilities || !capabilities.width || !capabilities.height){
    return [all[0]]; // safest guaranteed-supported default
  }
  const maxW = capabilities.width.max || 1280;
  const maxH = capabilities.height.max || 720;
  const maxFps = (capabilities.frameRate && capabilities.frameRate.max) || 30;
  const supported = all.filter(o=>o.width <= maxW && o.height <= maxH && o.fps <= maxFps + 0.01);
  return supported.length ? supported : [all[0]];
}
