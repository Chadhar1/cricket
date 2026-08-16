# CricketConnect — Local Match Recording + Broadcast Overlay: Inspection Findings & Proposed Implementation

This is the inspection-first report you asked for. No code has been written yet. Read this, then tell me to proceed (or adjust scope) before I touch anything.

## 1. The most important finding: there is no native Android app

`cricket-connect-android/` is a Bubblewrap-generated **Trusted Web Activity** — a thin shell (`LauncherActivity`, `DelegationService`, near-empty Java subclasses of Google's `androidbrowserhelper` library) that opens `cricket-pied-ten.vercel.app` inside a Custom-Tabs-backed container. Its manifest requests only `POST_NOTIFICATIONS`. There is zero native camera, video, or media code anywhere in that folder.

This means the entire feature has to be built as **web platform APIs running inside the PWA** — `getUserMedia`, `<canvas>`, `MediaRecorder`. There's no native encoder to call into, and adding one would mean replacing the TWA with a real native app, which you've explicitly ruled out. I'm treating this as fixed: everything below is a browser-based design.

Two direct consequences worth flagging now rather than discovering later:

- **Output container:** `MediaRecorder` on Chrome/Android (your real-world target) reliably produces **WebM** (VP8/VP9 + Opus), not MP4. True `video/mp4` recording support in `MediaRecorder` is essentially Safari-only. Getting an actual `.mp4` file means either (a) shipping WebM and renaming the deliverable, which breaks your "must be a real MP4" requirement, or (b) transcoding WebM→MP4 client-side (e.g. ffmpeg.wasm), which is CPU/memory-heavy, works on a single in-memory buffer rather than a stream (in tension with your "never load the whole video into RAM" rule), and would need real testing on mid-range Android phones before I'd trust it for a full match. I'm not going to pretend this is solved — it's the single biggest open technical question and I want your call on it (see §5).
- **iOS**: no iOS app exists for this project at all today (the TWA is Android-only). If anyone opens the PWA in iOS Safari, `canvas.captureStream()` + `MediaRecorder` support is present in modern Safari but has a history of bugs and is far less battle-tested than Chrome/Android. I'd scope this as **Android/Chrome first**, iOS best-effort, unless you tell me iOS matters now.

## 2. What already exists that this feature can reuse

- **Scoring engine is untouched-and-reusable.** `engine.js`'s `playBall()` returns `{overJustEnded, inningsOver, wicketEndedInnings, ...}`, and each ball is recorded into `inn.thisOverBalls` with `{four, six, wicket, extra, freeHit}` flags already computed. There's no existing FOUR/SIX/WICKET toast or animation anywhere in the current UI — today those events only show up as static scoreboard numbers and a commentary log line. So the overlay's event-detection is new code, but it can read flags the engine already computes rather than reimplementing scoring logic. Fifty/century and over/innings/match-complete detection will be new (simple threshold/flag checks on data the engine already exposes — `batter.runs`, `res.overJustEnded`, `res.inningsOver`, `match.completed`).
- **Local-first pattern to mirror.** Every save in this app writes to `localStorage` first and treats Supabase as optional (`cloud.js`: "the whole app keeps working as a local-only scorer"). The recording feature should follow the identical philosophy — nothing about it should touch Supabase or require a connection.
- **Blob/download pattern already in the codebase.** `app.js` already builds a `Blob`, calls `URL.createObjectURL`, and triggers a download for JSON backups; and `navigator.share(...)` with a clipboard fallback is already used in four places (results, player profile, live match, tournament). The post-recording "Open Video / Share / Delete" card can reuse both patterns directly instead of inventing new ones.
- **Design tokens exist and are reusable** for template visuals: `--bg-0/1/2/3` (navy scale), `--acc`/`--acc-2` (brand green), `--gold`, `--live` (red), `--ink` scale. All 5 templates can be built from these so they feel like CricketConnect rather than a bolt-on.
- **No sponsor/ad system exists at all** in this codebase — I searched thoroughly. So "keep sponsor controls admin-only and separate" has nothing to actually separate from today. I'll design the recording feature so it doesn't preclude a future sponsor layer (e.g. leave a slot in the overlay renderer for a sponsor badge later), but there's no existing system to protect right now.
- **Gap worth flagging for Template 5 (Tournament Premium):** team objects are currently just `{id, name}` — there is **no per-team logo field** anywhere in the schema or data model, only a single tournament-level `bannerUrl`. "Reuse existing DB logos" isn't fully possible as literally stated because per-team logos don't exist yet. I'd propose Template 5 use team-initial badges in team colors (generatable client-side, no new upload UI) unless you want me to add an optional per-team logo field as a small, separate scope item.

## 3. Proposed architecture (kept decoupled, per your future-compatibility requirement)

```
Scoring Engine (engine.js, unmodified)
        │  reads existing match/innings/ball state — no changes to scoring logic
        ▼
Event Adapter (new, small)  — polls/observes match state after each playBall(),
        │                     turns it into typed events: FOUR, SIX, WICKET, FIFTY,
        │                     CENTURY, OVER_COMPLETE, INNINGS_COMPLETE, MATCH_COMPLETE
        ▼
Broadcast Overlay Renderer (new, overlays.js) — 5 pure canvas-draw modules (one per
        │                     template), each takes (ctx, match, event?) and draws
        │                     score bug + event animation. No video/recording knowledge.
        ▼
Video Compositor (new, recorder.js) — drives requestAnimationFrame: draws camera
        │                     <video> frame + overlay canvas onto a composite canvas,
        │                     captures it via canvas.captureStream(), merges with mic
        │                     audio track, feeds MediaRecorder
        ▼
Local Save (existing Blob/share patterns) — Blob → object URL → download / Web Share,
                              no Supabase Storage involved, ever
```

This mirrors what you asked for: the overlay renderer doesn't know it's being recorded (so it could later feed a live-streaming layer instead), and the recorder doesn't know anything about cricket scoring (so it could composite any camera+overlay pair later). Nothing here modifies `engine.js`, `cloud.js`'s auth/sync logic, or existing tournament/team/admin code.

## 4. What I'm confident is genuinely achievable

- A "🎥 Record Match" button on the organizer's live scoring screen, gated the same way your existing organizer-only controls are gated.
- Camera preview + 5 selectable templates with live thumbnails, before recording starts.
- Real-time score overlay burned into the actual output file (not a floating HTML layer) — this is exactly what canvas compositing gives you, verifiable by opening the file outside the app.
- FOUR/SIX/WICKET/FIFTY/CENTURY/over/innings/match-complete animations drawn into the same canvas, timed off real scoring events.
- **Mid-recording template switching** — good news here: since overlay drawing is just "which function runs this frame," switching templates live is one of the *easier* parts of this design, not a risky one. I don't expect to need a documented limitation here.
- Fully offline operation (getUserMedia/canvas/MediaRecorder are 100% local browser APIs).
- Pre-recording storage estimate via `navigator.storage.estimate()`, with a low-storage warning before recording starts.
- Resolution/framerate options limited to what `getUserMedia`'s `getCapabilities()` reports the device actually supports.

## 5. What I need your decision on before I start building

1. **WebM vs. MP4.** Ship WebM (fast, reliable, plays fine on Android/VLC/most modern players and can be renamed with a `.webm` extension) and treat "MP4" as aspirational v2, or take on client-side WebM→MP4 transcoding (ffmpeg.wasm) now, accepting the performance/memory trade-offs and extra testing burden that come with it? I'd recommend starting with WebM to get a real, working, verifiably-burned-in-overlay recording proven first, then evaluating transcoding as a follow-up — but it's your call.
2. **iOS scope.** Android/Chrome-first with iOS as best-effort-not-guaranteed, or does iOS need to be a first-class target from day one?
3. **Template 5 logos.** Team-initial badges (no new scope) or do you want me to add a real per-team logo upload field first (small separate task)?

Once you confirm these three, I'll build incrementally — starting with camera preview + a single template's static overlay + basic start/stop recording, verified by actually opening the saved file, before adding the remaining templates, animations, and controls.
