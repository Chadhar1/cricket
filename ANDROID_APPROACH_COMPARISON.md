# TWA vs. Capacitor vs. Full Native — Full Comparison

Three ways to get CricketConnect onto the Play Store, compared in detail. You already have the first one mostly built.

## Quick comparison table

| | TWA (current) | Capacitor (hybrid) | Full native (Kotlin / Flutter / RN) |
|---|---|---|---|
| Code reuse | ~100% | ~90-95% | 0% (new build) |
| Time to Play Store | Days | Weeks | Months |
| Camera/recording quality ceiling | Browser-limited (WebM, memory grows, no background guarantee) | Native plugin — real MP4, hardware encoding, background-capable | Best possible — full Camera2/CameraX + MediaCodec |
| Feature updates | Instant, no store review | Instant for web code; native plugin changes need a store review | Every change needs a store review |
| App size | Tiny (thin wrapper) | Medium (15-40MB+, bundled WebView runtime) | Varies, typically larger |
| iOS support | No (Android-only) | Yes, same project | Yes, but a separate native codebase unless using Flutter/RN |
| Ongoing maintenance | Lowest — one codebase, one skillset | Medium — native plugins to keep updated | Highest — two+ codebases, two+ skillsets |
| Skill required | What you already have (web) | Mostly web + a little native glue code | Real native mobile engineering |
| Best native "feel"/perception | Weakest | Good | Best |

## Option 1 — TWA (Trusted Web Activity) — what you have now

**Pros**
- Zero code duplication — it's literally your live website, wrapped. Nothing to build twice.
- Every deploy to Vercel updates the Play Store app instantly, for every installed user, with no store review wait.
- You're already most of the way there — signed keystore, working build, `twa-manifest.json` all exist from earlier work.
- Tiny app size (a few hundred KB to low single-digit MB), since it's just a launcher shell.
- One team, one skillset — no separate mobile codebase or mobile-specific hiring/expertise needed.
- The offline scoring you already built (service worker, localStorage-first saves) works identically inside the app.
- Officially supported by Google as a legitimate Play Store app category since 2020 — not a workaround, a real path.

**Cons**
- Bound by whatever Chrome exposes to a web page — no true native camera pipeline. This is exactly what caused the WebM-not-MP4 and memory-growth limitations in the recording feature.
- Needs Digital Asset Link verification (`assetlinks.json`) hosted correctly, or the app degrades to showing a browser address bar and loses the "real app" feel.
- No deep native API access (Bluetooth accessories, native biometric auth, guaranteed background execution, live widgets, etc.) beyond a small set of TWA extensions.
- Android-only — doesn't extend to an iOS app at all; iOS would need a completely separate approach (Safari's "Add to Home Screen," which is weaker than even this).
- Play Store review can occasionally scrutinize TWAs more closely to confirm they're substantial apps and not bare websites — a real risk mitigated by CricketConnect already having a lot of genuine functionality.

## Option 2 — Capacitor (hybrid wrapper)

**Pros**
- Keeps ~90-95% of your code as-is — the same HTML/CSS/JS runs inside a native WebView with a bridge to native code, so `engine.js`, `tournament.js`, `cloud.js`, all your UI, stay untouched.
- Real native plugins available — camera, filesystem, native push (FCM instead of Web Push), biometrics, Bluetooth, geolocation, and more, official and community-maintained.
- Solves the recording feature's specific ceiling directly: a native camera + MediaCodec plugin can produce genuine MP4 output with hardware-accelerated encoding and proper background recording, without rewriting the scoring engine or UI at all.
- One project builds for both Android and iOS — opens the App Store as a real possibility without a second codebase.
- Migration can be incremental — you could move just the recording feature to a native plugin first, leave everything else running as web code inside the same wrapper, and expand later only if it's worth it.
- Ships in weeks, not months, since there's no UI/business-logic rewrite involved.

**Cons**
- More build tooling overhead than a TWA — proper Android Studio setup, and Xcode if you target iOS too, plus a build pipeline to maintain.
- Larger app size — a full WebView + native runtime bundled in, typically 15-40MB or more, versus a TWA's near-zero footprint.
- Every native plugin is an ongoing dependency — Capacitor version bumps, OS updates, and plugin compatibility become something you have to track, unlike a pure TWA.
- Loses some of the "instant update" magic: pure web/UI changes still deploy instantly like today, but any change to a native plugin (e.g., improving the camera plugin itself) needs a full Play Store/App Store resubmission and review wait.
- Requires a bit of native glue code (Kotlin or Swift) for anything beyond what's pre-built as a plugin — a small but real skill investment beyond pure web development.
- Slightly below fully-native performance/feel, since the UI is still WebView-rendered underneath — rarely noticeable for an app like this, but real.

## Option 3 — Full native (Kotlin/Jetpack Compose, or Flutter/React Native for cross-platform)

**Pros**
- The best possible camera and media performance available on the platform — full Camera2/CameraX and MediaCodec access, hardware-accelerated MP4 recording with no browser-imposed ceiling at all.
- Best possible UI performance and platform feel — genuinely native widgets, animations, and gestures.
- No native API is off-limits — anything the OS exposes is available (accessories, live activities/widgets, deep system integration).
- Generally perceived as higher quality by both app store reviewers and users compared to a wrapped web app.
- Doesn't depend on your web hosting for the app shell itself to load (your data would still need Supabase either way).

**Cons**
- By far the biggest cost — realistically a multi-month project just to rebuild what already exists and works today (tournaments, admin tooling, roles, notifications, live scoring, and now recording), before adding anything new.
- Creates two (or three, counting iOS) codebases to maintain forever afterward — every future feature gets built twice, or the web app gets abandoned, which throws away everything invested in it so far.
- Requires genuine native mobile engineering skill (Kotlin/Swift, or deep Flutter/React Native expertise) — a different discipline than what's built this app to date.
- Every change, however small, needs an app store submission and review cycle — the "deploy and it's live everywhere instantly" workflow you have today goes away entirely.
- Highest ongoing cost of the three: native dependency updates, OS version compatibility work, two full sets of bugs, two release pipelines.
- Given the current pace of feature work (a lot has shipped in a short window), this option would slow feature velocity the most, by a wide margin, of any of the three.

## How to actually decide

The honest framing: TWA and Capacitor aren't really competing options, they're sequential — TWA gets you into the Play Store now with what you already have, and Capacitor is the specific fix if and when the browser-based recording ceiling (WebM, memory growth, no background guarantee) actually becomes a real complaint from real organizers. Full native is a different kind of decision entirely — it only makes sense if CricketConnect's future is "professional native app with a dedicated mobile team," not "one person shipping features fast," which isn't where this project is today.
