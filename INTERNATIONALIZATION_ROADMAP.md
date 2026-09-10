# CricketConnect — Roadmap to International Users

Planning only — nothing below has been built. Read this, tell me which phases/decisions you want to move on, and I'll start there.

## The honest starting point

There is currently zero internationalization infrastructure in this app. Every piece of text — buttons, labels, error messages, toasts, admin screens, everything — is hardcoded English directly inside `app.js` and `index.html` template strings. That's not a criticism, it's just been the right call for a fast-moving single-market app so far. It does mean this isn't a small feature — it's closer in scope to the Tournament Organizer Control Center or Recording work than a quick addition, so I want to lay out the real size of it before you commit to it.

## Phase 0 — Decisions only I can't make for you

Before any building, three things genuinely need your call, since they change the entire shape of the work:

1. **Which language(s) first?** Cricket's biggest markets suggest Hindi and/or Urdu as strong first candidates, but you know your actual user base — where your organizers and players actually are — better than I do. I'd strongly recommend picking exactly one language to go end-to-end with first (infrastructure + full translation + real testing), not several at once.
2. **Right-to-left (RTL) support?** Urdu and Arabic both read right-to-left, which isn't just translation — it's a real layout/CSS audit (mirrored nav, mirrored icons, text alignment throughout). If Urdu is a priority, RTL has to be budgeted as its own real chunk of work, not a translation afterthought.
3. **Who reviews the translations?** I can produce a solid first-pass translation, but I'm not a substitute for a native speaker reviewing sports/UI terminology before it ships publicly — cricket has enough borrowed/untranslated jargon (over, wicket, no-ball) that machine translation alone risks sounding wrong to the people it's for. Worth deciding now whether you have someone for this, or whether that review step should block launch.

## Phase 1 — i18n infrastructure (foundation, language-agnostic)

This has to happen before any translation work, regardless of which language you pick.

- A lightweight, dependency-free translation system that fits the existing no-build-step architecture: JSON dictionaries per language, a small `t(key, vars)` lookup helper, no heavy library like i18next needed.
- Language detection (browser locale) with a manual override in Account settings, saved to `localStorage` and to the Supabase profile so it follows a signed-in user across devices.
- Proper pluralization handling — "1 wicket" vs "2 wickets" is trivial in English but genuinely complex in many other languages, and needs to be built into the system from the start rather than retrofitted.
- RTL layout support at the CSS level (if Phase 0 includes an RTL language) — `dir="rtl"` switching and auditing every layout for mirroring issues.

## Phase 2 — Date, time, and timezone correctness

This matters for international users even before a second language exists, and I'd actually prioritize it early regardless of which language you pick.

- Audit whether match/tournament timestamps are currently stored in a timezone-safe way, or implicitly assume the device's local timezone (this needs verification — a real risk for a "Live Now" feature meant to be watched across timezones).
- Switch all date/time display to `Intl.DateTimeFormat` (built into every browser, no library needed) so times render correctly in each viewer's own locale/timezone automatically.
- Let organizers set an explicit timezone when scheduling a match/tournament, rather than relying on their device's timezone at creation time, so the start time is correct for viewers everywhere, not just the organizer.

## Phase 3 — Content translation

- Extract every hardcoded string in `app.js`/`index.html` into the Phase 1 dictionary format — mechanical but large, given the app's current size (thousands of individual strings across auth, live scoring, tournaments, admin, notifications, profile, everything).
- Produce a first-pass translation into the Phase 0 target language.
- Decide, term by term, which cricket vocabulary stays in English even in the translated UI (very common in real cricket coverage — "wicket" and "over" are often left as-is even in Hindi/Urdu commentary) versus what gets fully translated.

## Phase 4 — Regional/legal considerations

- If EU users are in scope: proper cookie/data-processing consent flow (not just a privacy policy page) and data export/deletion handling to match GDPR expectations.
- Region-appropriate legal text where needed.
- Payments/currency localization is explicitly out of scope for now — there's no monetization system in this app at all today, so nothing to localize there yet.

## Phase 5 — Testing

- Layout testing in the new language specifically — some languages (German, French) run noticeably longer than English and can break tight layouts; RTL languages need a full pass of their own.
- Native-speaker review of the Phase 3 translations before anything ships publicly.
- Timezone edge cases: DST transitions, matches that span midnight UTC, tournaments with fixtures across multiple timezones.

## Phase 6 — Rollout

- Ship the language switcher plus the first fully-reviewed non-English language.
- Update the Play Store listing (once you're on that path) with localized description/screenshots for the new language/region — ties directly into the Play Store roadmap from earlier.
- Treat every additional language after the first as a much smaller, repeatable unit of work, since Phases 1-2 (the actual engineering) are done once and reused — only Phase 3/5 (translate + test) repeat per language.

## What I'd actually do, if it were my call

Build Phase 1 and Phase 2 together first, fully, even before picking a translation partner or committing hard to a specific language — timezone correctness benefits every international user immediately, and the i18n plumbing needs to exist regardless of which language comes first. Then take exactly one language all the way through Phases 3-6, get it properly reviewed and shipped, and let real usage tell you whether a second language is worth the (much smaller, by then) additional effort — rather than trying to plan for five languages up front and shipping none of them well.
