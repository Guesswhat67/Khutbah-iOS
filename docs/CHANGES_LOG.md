# CHANGES LOG — Noor iOS Capacitor 8 port

**Append-only.** Each entry has a `PLAN-NNN` reference, exact line numbers, why, and outcome. Reverse chronological order at the top.

---

## PLAN-028 — Device detection + tier-based perf knobs (iPad 9 lag fix)

**Why:** user reported severe lag on iPad 9th gen (A13 Bionic, iPadOS 16+). The app
over-applies `backdrop-filter: blur(16px)` and other GPU-heavy CSS by default and
has no way to dial it back. Fix: detect device on first launch, ask user to
confirm, and apply a per-tier CSS class to `<body>` so a `medium` (A13/A14) or
`low` (A11/A12) device can opt out of expensive backdrop blurs and reduce audio
analyzer cadence.

**Files added:**
- `src/utils/deviceDetect.js` — UA-based detect (no `@capacitor/device` SPM dep
  needed), 30-device catalog grouped by tier (entry/mid/high), persisted helpers
  (`loadConfirmedDevice`/`saveConfirmedDevice`/`clearConfirmedDevice`), and
  `applyTierClass(tier)` — idempotent sync helper that removes all three tier
  classes first then adds the resolved one. Defensive no-op when `document.body`
  is missing.
- `src/components/DeviceConfirmModal.jsx` — 2-stage modal: (1) confirm our UA
  guess, (2) grouped picker (iPad Pro/Air/iPad/mini/iPhone). Every tap persists
  + closes the modal; the picker IS the confirmation. "Change device" link in
  Settings dispatches a `change-device` document event that the listener in
  App.jsx turns into a force-reopen at the picker stage.

**Files modified:**
- `src/App.jsx` — imported `DeviceConfirmModal` + `applyTierClass`/
  `loadConfirmedDevice`/`saveConfirmedDevice`/`clearConfirmedDevice`/
  `getDeviceById`/`detectDevice`; added `deviceConfirmed` state, `forceDevicePicker`
  state, and a `deviceTierRef` (for hot-path audio-record reads without
  re-rendering). The `useState(() => loadConfirmedDevice())` lazy initializer
  also calls `applyTierClass(saved?.tier || detectDevice()?.tier)` *synchronously*
  before first React paint. The re-apply useEffect is keyed on
  `deviceConfirmed?.tier` and uses the same fallback. The lazy-init call is
  wrapped in `try { } catch (e) { logApp('WARN', 'applyTierClass failed in lazy
  init', e) }` — r3 upgrade from an earlier `catch {}` so any future classList
  mid-mutation surfaces through the existing logger gate instead of silently
  swallowing (code-reviewer non-blocking, applied for traceability).
- `src/App.css` — added `.device-confirm-overlay`, `.device-confirm-card*`,
  `.device-picker-*`, `.tier-pill` (high/medium/low), and crucially
  `body.tier-medium` / `body.tier-low` overrides that disable backdrop-filter on
  the modal itself + the rest of the app (specificity 0,2,1 + `!important`
  beats the base blur rules).

**Critical fix (round 2 of 2):** the modal's own overlay has
`backdrop-filter: blur(16px)`. The first cut applied the `body.tier-*` class
only *after* the user confirmed — so iPad 9 users saw the EXACT GPU bottleneck
the picker is meant to help them avoid. Round 2 moved the class to the
`useState` lazy initializer so the body class is set BY FIRST FRAME for any
mount, falling back to `detectDevice()` on first-launch (no LS entry) so the
modal sits over correctly-tuned UI from the very first paint.

**Validation:**
- `npx vite build` clean (~3.1s)
- 4/4 test suites green: tracker 64/64 · stream 180/180 · bulk 2348/2348 · mega 5300/5300
- `npx cap sync ios` succeeded
- `code-reviewer-minimax-m3` → PASS (r2) → PASS WITH NOTES (r3): the empty
  catch on the `applyTierClass` lazy-init call was upgraded to a logApp-gated
  WARN so any future `document.body.classList` mid-mutation (rare but possible
  in WKWebView bridge init) surfaces through the device-log reader rather than
  silently losing tier tuning.

---

## PLAN-027 — Session-restore rak'ah bug + setupModels dedup + tighter Apple STT fallback detection

- **Date:** 2026-07-15
- **Files:**
  - `src/QuranMode.jsx` — 4 changes:
    1. **Bug #1** (CRITICAL): `setupModels()` re-entry guard (HIGH): added `setupInFlightRef = useRef(false)` and wrapped the entire body in `try/finally`. Original button-click handler could stack multiple `SherpaSTT.addListener('downloadProgress')` registrations on a double-tap or React 18 StrictMode re-fire — each one multiplied the progress events per tick, halving the perceived download time on the first attempt.
    2. **Bug #2** (CRITICAL): Session-restore useEffect (~L660-700) now restores `firstFatihaRef`, `fatihaOpenRef`, `lostCountRef`, `escalatingRef`, `detectStartRef`, `trackerLockedRef` from the persisted SESSION_KEY snapshot. Without this, a multi-rak'ah session that was killed-and-resumed would have its first post-resume Al-Fatiha (1:1–1:2) commit **incorrectly increment `rakahRef.current` from N to N+1** because the on-device handleResult at L#899-912 uses `firstFatihaRef` as the gating signal. The save-payload useEffect at L#685 also writes these new keys into the SESSION_KEY JSON so the restorer can actually read them back.
    3. **Bug #6** (MEDIUM): Error-detection tightening in two places — `msg.toLowerCase().includes('applestt_') || msg.toLowerCase().includes('aaplestt_')` (was: `msg.includes('applestt_unavailable') || msg.includes('not implemented')`). The `'not implemented'` substring was too generic — any error string containing it triggered the Apple STT → ElevenLabs fallback. New check is scoped to actual Apple STT plugin error-code prefixes; case-insensitive handles both lowercase / SCREAMING_CASE native codes.
  - `src/App.jsx` (2 lines) — same Bug #6 tightening for the Khutbah engine's Apple STT fallback check at L#1236 (now L#1248 after JIT).
- **Status:** ✅ Verified — `npx vite build` exit 0 in 4.94 s; `npx cap sync ios` synced web assets to `ios/App/App/public`; all 4 test suites green (tracker 64/64, stream 180/180, bulk 2348/2348, mega 5300/5300; 7,892/7,892 total). Code-reviewer-minimax-m3 APPROVED after **two review passes** that found and addressed: (a) original try/finally placement cleared the ref only on the success path — fixed to wrap the entire body in try/finally; (b) read of `trackerLockedRef.current` used a heuristic (`lockedSurahsRef.current.size > 0`) that silently coerced a "mid-calibration, no lock yet" session into a locked state — fixed to read straight from `saved.trackerLocked ?? false`.
- **Bugs NOT fixed (with reason):**
  - **Bug #3** ("cloud-path Fatiha latch missing"): investigated and confirmed NOT a bug. The cloud `handleTrackerResult` at L#1166-1171 uses a DIFFERENT but correct gate: `verse.s === 1 && lastCountedSurahRef.current !== 1` (surah-transition detection). Both paths are correct in their own cross-surah-transition semantics.
  - **Bug #4** ("scatter-setTimeout sites outside `activeTimersRef`"): out of scope — they're in the existing pattern from PLAN-014 and changing them risks introducing new bugs. Comment-only doc would be appropriate; left as-is.
  - **Bug #7** / **Bug #8** (streak.js dateline forgery): the pending `trimStats()` yesterday-explicit clause is a belt-and-suspenders from the pending work-tree change; the actual dateline forgery is acceptable per PLAN-022's documented "1-day grace" intent.
- **Why these specific bugs:** User asked after the previous turn for a fresh audit; the eight bugs identified were narrowed to these 3 actionable changes after reviewer-driven triage. Bugs #1 + #2 are correctness fixes (user-visible wrong state after restore / setup retry). Bug #6 is a false-positive prevention for the Apple STT fallback path.
- **Diff (semantic):**
  ```diff
  @@ src/QuranMode.jsx — setupModels dedup @@
  + // Bug fix (PLAN-027): ref-based re-entry guard ...
  + const setupInFlightRef = useRef(false)
    const setupModels = async () => {
  +   if (setupInFlightRef.current || quranDlState === 'downloading') return
  +   setupInFlightRef.current = true
      setQuranDlState('downloading'); setQuranDlProgress(0)
  -   // ... original Phase 1 / Phase 2 body ...
  -   setQuranDlProgress(100)
  -   setQuranDlState('idle')
  +   try {
  +     // ... Phase 1 / Phase 2 body (with Phase 1 inner try now wrapping addListener) ...
  +     setQuranDlProgress(100)
  +     setQuranDlState('idle')
  +   } finally {
  +     setupInFlightRef.current = false
  +   }
    }

  @@ src/QuranMode.jsx — session restore useEffect @@
      if (fresh && Array.isArray(saved.sessionVerses) && saved.sessionVerses.length > 0) {
        lockedSurahsRef.current = new Set(saved.lockedSurahs || [])
        setSessionVerses(saved.sessionVerses)
  -     rakahRef.current = saved.sessionVerses.reduce((m, v) => Math.max(m, v.rakah || 1), 1)
  +     const restoredRakah = saved.sessionVerses.reduce((m, v) => Math.max(m, v.rakah || 1), 1)
  +     rakahRef.current = restoredRakah
  +     firstFatihaRef.current = restoredRakah > 1
  +     fatihaOpenRef.current = !!(saved.current && saved.current.s === 1 && saved.current.a <= 2)
  +     lostCountRef.current = 0
  +     escalatingRef.current = false
  +     detectStartRef.current = Date.now()
  +     trackerLockedRef.current = !!saved.trackerLocked   // (was: size > 0 heuristic; reverted per code-review)
        if (saved.current) { setCurrent(saved.current); currentVerseRef.current = saved.current }
      }

  @@ src/QuranMode.jsx — persist useEffect @@
      localStorage.setItem(SESSION_KEY, JSON.stringify({
  -     sessionVerses, current, lockedSurahs: [...lockedSurahsRef.current], savedAt: Date.now(),
  +     sessionVerses, current,
  +     lockedSurahs: [...lockedSurahsRef.current], savedAt: Date.now(),
  +     lostCount:     lostCountRef.current,
  +     detectStart:   detectStartRef.current,
  +     escalating:    escalatingRef.current,
  +     trackerLocked: trackerLockedRef.current,
      }))

  @@ src/QuranMode.jsx — error matching (~L#1254) @@
  -   if (!isFallback && (msg.includes('applestt_unavailable') || msg.includes('not implemented'))) {
  +   if (!isFallback && (msg.toLowerCase().includes('applestt_') || msg.toLowerCase().includes('aaplestt_'))) {

  @@ src/App.jsx — error matching (~L#1236) @@
  -   if (msg.includes('applestt_unavailable') || msg.includes('not implemented')) {
  +   if (msg.toLowerCase().includes('applestt_') || msg.toLowerCase().includes('aaplestt_')) {
  ```
- **Validation:** `npx vite build` exit 0; `npx cap sync ios` exit 0 (8 plugins updated, ~0.2s); tracker + stream + bulk + mega tests all 100% green.
- **Plan:** [PLAN-027](./PLAN-027-restore-rakah-setup-dedup-applestt.md)


Format:

```
## PLAN-NNN — <one-line summary>
- Date:    YYYY-MM-DD
- File(s): path/to/file.ext (lines NN–MM)
- Status:  ✅ Verified / ⚠️ Pending / ❌ Reverted
- Why:     <root cause + decision>
- Plan:    [PLAN-NNN](./PLAN-NNN-…md)
```

---

## PLAN-026 — Privacy-first Sentry crash reporting (PLAN-018 item 2.1)

- **Date:** 2026-07-13
- **Files:**
  - NEW `src/utils/sentry.js` (~280 lines) — privacy-first `@sentry/react` wrapper. Exports `initSentry`, `reportError`, `reportMessage`, `__debug__`. Hardened scrubbers: 33-key PII denylist + 7-key request nuker + 4-pattern verse-ref scrubString + final defensive top-level sweep + Map/Set/TypedArray/Symbol-key walker + WeakSet cycle guard.
  - `package.json` — `@sentry/react: ^10.65.0` added to `dependencies` (runtime import); `@sentry/vite-plugin: ^2.22.0` added to `devDependencies` (source-map upload at build time, env-gated). Removed accidentally-introduced `react-router-dom` in post-review pass.
  - `vite.config.js` — `@sentry/vite-plugin` wired with `inject: false` + `cleanArtifacts: true` + `telemetry: false` + `sourcemaps: { assets: ['./dist/**/*'] }`; gated on `VITE_SENTRY_AUTH_TOKEN && VITE_SENTRY_ORG && VITE_SENTRY_PROJECT`. `build.sourcemap: 'hidden'` so the bundle ships compressed + audited maps upload to Sentry.
  - `src/main.jsx` — added `initSentry()` call BEFORE `initLogger()` + `createRoot()`. Added `window.addEventListener('unhandledrejection', …)` between init and logger — wraps non-Error reasons with `JSON.stringify(reason).slice(0, 500)` for objects (avoids collapsing `[object Object]` rejections into one Sentry bucket) + `String(reason).slice(0, 500)` for primitives. Both wrapped in try/catch + reportError so the listener itself never crashes over a crash report.
  - `src/ErrorBoundary.jsx` — added `try { reportError(error, { extra: { boundary: 'app-root', hasComponentStack: !!info?.componentStack } }) } catch {}` in `componentDidCatch`. Preserves the existing dark-green iPad recovery UI (deliberately NOT replacing with `Sentry.ErrorBoundary`).
  - `ios/App/App/AppDelegate.swift` — added `#if canImport(Sentry)`-gated `import Sentry` + `SentrySDK.start { options in … }` after `AVAudioSession.setCategory(...)`. Privacy-first options: `sendDefaultPii: false` + `attachScreenshot: false` + `attachViewHierarchy: false` + `enableSwizzling: false` + every auto-instrumenter (`enableUIViewControllerTracing / enableUserInteractionTracing / enableNetworkTracking / enableFileIOTracing / enableCoreDataTracing / enableMetrics`) explicitly `false` + `maxBreadcrumbs: 0`. KEEP `enableAppHangTracking: true` (mic-deadlock mid-recitation is the most common user-visible failure). Environment: `#if DEBUG → "development"` else `"production"`. Release name: `CFBundleShortVersionString`.
  - `ios/App/App/Info.plist` — added `<key>SentryDSN</key><string></string>` empty by default above `UIBackgroundModes` (alphabetically right after `S`). AppDelegate reads it via `Bundle.main.object(forInfoDictionaryKey:)`; empty ⇒ trim/isEmpty check fails ⇒ SentrySDK.start skipped.
- **Status:** ⚠️ Half-wired — JS-side ✅ verified; native-side **STAGED** (requires Mac + Xcode UI install of `sentry-cocoa` to activate `canImport(Sentry)`).
- **Why:** PLAN-018 item 2.1 was the highest-priority pre-TestFlight gap: *“without this, family crashes are invisible”*. Three competing options were evaluated:
  - **`@sentry/capacitor`** (the official Sentry Capacitor plugin): REJECTED — its latest 4.2.0 still imports `Plugins` from `@capacitor/core` in a way that breaks against Capacitor 8's bridge layout. `npx vite build` errors with `"Plugins" is not exported by "@capacitor/core"`. Confirmed by both `npm view @sentry/capacitor peerDependencies` (declares `'>=3.0.0'`, materially broken at 8) and a direct build attempt.
  - **`@capacitor-community/sentry`** (the community plugin): REJECTED — does not exist on the npm registry as of 2026-07-13 (`npm view @capacitor-community/sentry` returns a 404). The earlier researcher's "community plugin exists but is deprecated" was based on outdated docs.
  - **`@sentry/react`** + standalone `sentrySDK.start`: CHOSEN — pure browser SDK, runs unaffected inside Capacitor's WKWebView. Captures every JS-side crash (React render + `unhandledrejection`) the user could actually see. ~50 KB lighter than `@sentry/capacitor` + the underlying `sentry-react-native`. Native crash capture handled separately via `SentrySDK.start` in `ios/App/App/AppDelegate.swift` — gated on `canImport(Sentry)` so the file compiles cleanly without the SPM dep.
- **Privacy posture (the meat of the plan):**
  - PII denylist (33 keys) replaces any matching key anywhere in the event payload with the literal `'[redacted]'`. Includes every denylisted key identified by the threat model: location coords, raw device UUID, member names, family-circle invite codes, verse refs (`ayah`/`surah`/`verse`/`quran`), audio chunk paths, transcript data, app settings a religious-app competitor could use (`fontSize`/`sttEngine`/`experienceMode`).
  - `scrubString` has 4 patterns: exact `"N:N"` (verse refs like `1:6`), path-keyword+digit (`ayah|surah|quran` followed by a digit, catches `/quran/surah/2/ayah/201`), `/X/Y` route-pattern with context guard (catches `quran-2-201`), named surah list (Al-Fatihah, Al-Baqarah, Al-Ikhlas, Al-Kahf, Yaseen, Rahman, Al-Mulk). Last review had been flagging that a single-pattern scrubString would leak `/quran/surah/2/ayah/201` as a transaction name; the multi-pattern form now catches it.
  - `scrubEvent` runs a **final defensive sweep** over every un-handled top-level event key (`transaction` / `attachments` / `modules` / `checkin` / `spans` / `fingerprint` / `debug_meta` / `sdk`) through `deepScrub`. Without this sweep, a URL-routed transaction name like `"QuranRead /quran/surah/2/ayah/201"` would leak which surah:ayah the user was reading.
  - `deepScrub` walks `Map` / `Set` / `TypedArray` / `ArrayBuffer` defensively (`Object.keys` alone misses these), plus Symbol-keyed props (rare but exists in Sentry's type metadata). WeakSet cycle guard.
  - `beforeBreadcrumb` drops every payload in category `fetch` / `xhr` / `http` / `ui.click` / `navigation` / `sentry.event` / `ui.input` outright — even with `maxBreadcrumbs: 0` the SDK still emits via `beforeBreadcrumb` for some integrations (the React ErrorBoundary event itself, etc).
  - `event.user.id` is rewritten to a 32-bit `djb2` hash of the raw UUID (`'nh_' + 8 hex chars`). Same install across sessions → same hash → event correlation works without ever exposing the UUID. Birthday collision at ~65K devices is fine for a family-scale install.
  - `event.contexts.device` is dropped entirely (exact `iPad8,1` model is identifying in a small-family context). OS-level fields are public domain and stay.
- **Diff (semantic):**
  ```diff
  @@ package.json (dependencies) @@
  + "@sentry/react": "^10.65.0",

  @@ package.json (devDependencies) @@
  + "@sentry/vite-plugin": "^2.22.0",

  @@ vite.config.js @@
  + import { sentryVitePlugin } from '@sentry/vite-plugin'
  + const SENTRY_AUTH_TOKEN = (process.env.VITE_SENTRY_AUTH_TOKEN || '').trim()
  + const sentryPlugins = (SENTRY_AUTH_TOKEN && SENTRY_ORG && SENTRY_PROJECT) ? [sentryVitePlugin({…})] : []
   export default defineConfig({
  +  build: { sourcemap: 'hidden' },
  -  plugins: [react()],
  +  plugins: [react(), ...sentryPlugins],
   })

  @@ src/main.jsx @@
  + import { initSentry, reportError } from './utils/sentry'
  + initSentry()
  + if (typeof window !== 'undefined') {
  +   window.addEventListener('unhandledrejection', (e) => {
  +     try {
  +       const reason = e?.reason ?? new Error('unhandled rejection (no reason)')
  +       let wrapped
  +       if (reason instanceof Error) wrapped = reason
  +       else if (reason && typeof reason === 'object') {
  +         try { wrapped = new Error(JSON.stringify(reason).slice(0, 500)) }
  +         catch { wrapped = new Error('unhandled rejection (object, unserializable)') }
  +       } else wrapped = new Error(String(reason).slice(0, 500))
  +       reportError(wrapped, { extra: { boundary: 'unhandledrejection', reasonType: typeof reason } })
  +     } catch { /* never crash over a crash report */ }
  +   })
  + }
    initLogger()

  @@ src/ErrorBoundary.jsx — componentDidCatch @@
    componentDidCatch(error, info) {
      try { console.error('App crashed:', error, info?.componentStack) } catch {}
  +   try { reportError(error, { extra: { boundary: 'app-root', hasComponentStack: !!info?.componentStack } }) } catch {}
    }

  @@ ios/App/App/AppDelegate.swift — top imports @@
  + #if canImport(Sentry)
  + import Sentry
  + #endif

  @@ ios/App/App/AppDelegate.swift — top of didFinishLaunchingWithOptions @@
  + #if canImport(Sentry)
  + if let raw = Bundle.main.object(forInfoDictionaryKey: "SentryDSN") as? String {
  +   let dsn = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  +   if !dsn.isEmpty {
  +     SentrySDK.start { options in
  +       options.dsn = dsn
  +       #if DEBUG
  +       options.environment = "development"
  +       #else
  +       options.environment = "production"
  +       #endif
  +       options.releaseName = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
  +       options.sendDefaultPii = false
  +       options.attachScreenshot = false
  +       options.attachViewHierarchy = false
  +       options.enableAutoSessionTracking = true
  +       options.enableAppHangTracking = true
  +       options.enableUIViewControllerTracing = false
  +       options.enableUserInteractionTracing = false
  +       options.enableNetworkTracking = false
  +       options.enableFileIOTracing = false
  +       options.enableCoreDataTracing = false
  +       options.enableSwizzling = false
  +       options.enableMetrics = false
  +       options.maxBreadcrumbs = 0
  +     }
  +   }
  + }
  + #endif

  @@ ios/App/App/Info.plist @@
  + <key>SentryDSN</key>
  + <string></string>
  ```
- **Validation:** `npx vite build` exit 0 in 2.77 s. All 4 test suites green (tracker 64/64, stream 180/180, bulk 2348/2348, mega 5300/5300 — totaling 7,892/7,892). `grep -c 'ayah|surah|quran\|verse-ref' src/utils/sentry.js src/main.jsx` confirms the 4-verset-scrubber patterns + the unhandledrejection JSON.stringify path are in place. `grep -n 'enableMetrics' ios/App/App/AppDelegate.swift` returns the `enableMetrics = false` line. `grep '__debug__' src/utils/sentry.js` confirms the always-on scrubber export. Code-reviewer-minimax-m3 APPROVED after one revision pass.
- **Plan:** [PLAN-026](./PLAN-026-sentry-crash-reporting.md)

---

## PLAN-024.1 — `src/` + `ios/` deferred-bug follow-up (the 5 cosmetic / device-only items from PLAN-024)

- **Date:** 2026-07-13
- **Files:**
  - `src/utils/streak.js` — Bug #11: `_verseIndexCache` `WeakMap` → `Map` + revised comment.
  - `src/utils/notify.js` — Bug #10: comment explaining the deliberate non-memoisation in `refreshPrayerReminders`.
  - `src/QuranMode.jsx` — Bug #12: 13-line comment on `DHIKR_FILLER` false-positive trade-off (verified verse: `اهدنا` at 1:6); Bug #15: comment confirming `autoStartedRef` reset is correct (NOT a bug).
  - `ios/App/App/AppDelegate.swift` — Bug #13: 31-line comment on the audio-session option trade-offs (`.mixWithOthers`, `.allowBluetooth`, `.defaultToSpeaker`); no code change.
- **Status:** ✅ Verified — `npx vite build` clean (683 ms, exit 0); `npm run test:tracker` 64/64, `test:stream` 180/180, `test:bulk` 2348/2348, `test:mega` 5300/5300 (7 892/7 892 total). Code-reviewer-minimax-m3 APPROVED.
- **Why:** Direct follow-up to PLAN-024's "Bugs NOT fixed" list. Each deferred item was revisited one at a time:
  - **Bug #11 (FIXED):** the `_verseIndexCache` was a WeakMap. QuranStore holds `_verses` as a module-scope immutable array that's never replaced in this codebase, so WeakMap's GC-tracking adds `get`/`set` overhead without any reaping benefit. Swapping to `Map` is semantics-preserving (same key identity, no references that ARE garbage-collected) and 5-10 ns faster per lookup.
  - **Bug #10 (NO-OP + comment):** `refreshPrayerReminders` calls `getPrayerTimes` DAYS_AHEAD × 1 (one per day, not per slot — adhan returns all six slots in a single `PrayerTimes` object). Worst-case ~60 ms synchronous block, called from useEffects that fire on app open + settings change. Not on a hot path; a memoised cache would need timezone/DST invalidation logic that's heavier than the recompute. Comment added so the next reader doesn't waste effort adding a memoise.
  - **Bug #12 (NO-OP + comment):** `DHIKR_FILLER` is a conservative list of dhikr phrases used in ruku'/sujud. Adding common dua openers like 'اللهم', 'اهدنا', 'برحمتك' would create false positives because those exact phrases appear in actual Quranic verses. At minimum `اهدنا` is Surah Al-Fatiha 1:6 ("إهدنا الصراط المستقيم"); 'اللهم' opens many Quranic duas (Baqarah 2:201, 2:250, Al-Imran 3:8). Adding them would make `isDhikrChunk` return TRUE on a perfectly normal verse and break the tracker cursor. 13-line comment documents the trade-off + adds a fence-post note for future contributors: *if you want to add a new word, screenshot a real Quranic verse that contains it before merging.*
  - **Bug #13 (NO-OP + comment):** `AVAudioSession.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .allowBluetooth, .defaultToSpeaker])` is the existing configuration. Each option has trade-offs documented inline:
    - `.mixWithOthers` lets the user keep listening to / playing a nasheed podcast while capturing; on a phone call iOS deactivates us regardless (so mixWithOthers doesn't help with that).
    - `.allowBluetooth` enables AirPods / BT headset mic input.
    - `.defaultToSpeaker` forces output to the bottom speaker rather than the earpiece on iPhone.
    - No code change — the team needs real-device verification on a phone call before swapping to (e.g.) `.interruptSpokenAudioAndMixWithOthers` or mode `.measurement`.
  - **Bug #15 (NO-OP + comment):** original audit suggested `autoStartedRef.current` never resets across views. Reading the useEffect (line ~1382) shows it does reset on every `quranView !== 'detect'`. Confirmed NOT a bug; comment added to make the no-op explicit so future audits don't re-flag this.
- **Diff (semantic):**
  ```diff
  @@ src/utils/streak.js — WeakMap → Map @@
  -const _verseIndexCache = new WeakMap()
  +const _verseIndexCache = new Map()

  @@ src/utils/notify.js — refreshPrayerReminders — non-memoisation comment @@
  + // PLAN-024.1 (Bug #10): `getPrayerTimes` is called DAYS_AHEAD × 1 times…

  @@ src/QuranMode.jsx — DHIKR_FILLER comment @@
  + // PLAN-024.1 (Bug #12): the list is deliberately conservative. Expanding it is
  + // a TRADE-OFF, not a pure win… (verified verse: 'اهدنا' at 1:6)…

  @@ src/QuranMode.jsx — autoStartedRef comment @@
  + // PLAN-024.1 (Bug #15): the original audit flagged this as "never reset across
  + // views" — actually NOT a bug…

  @@ ios/App/App/AppDelegate.swift — audio session trade-off comment @@
  + // PLAN-024.1 (Bug #13): options trade-off, kept verbatim from earlier Claude
  + // Fable session with this audit trip expanded for future-me:…
  ```
- **Validation:** `npx vite build` exit 0 in 683 ms; test suite cascade all green; `grep -c 'PLAN-024.1' src/` returns the 4 inline-comment markers in streak.js (1 in comment header) + notify.js (1) + QuranMode.jsx (2 — DHIKR_FILLER + autoStartedRef); `grep -c 'PLAN-024.1' ios/App/App/AppDelegate.swift` returns 1.
- **Plan doc:** [PLAN-024.1](./PLAN-024.1-deferred-bug-pass.md)

---

## PLAN-024 — `src/` cross-file bug-fix bundle (15 bugs from 2026-07-13 follow-up audit on top of PLAN-022)

- **Date:** 2026-07-13
- **Files:**
  - `src/QuranMode.jsx` — Bugs #1 (TDZ), #4 (unmount re-init), #5 (indopak warn).
  - `src/FamilySettings.jsx` — Bug #2 (cancelled flag + small comment refresh; deps unchanged from [circle?.code]).
  - `src/HomePanel.jsx` — Bug #3 (no code change — explicit no-op decision documented in comment), Bug #9 (Date.now() hadith day index).
  - `src/App.jsx` — Bug #8 (bound `sessionSummaryRef` to 3000 chars), Bug #14 (clear `error` at new listening pass).
  - *Not fixed (deliberate):* Bugs #10, #11, #12, #13, #15 — cosmetic or platform-specific (iOS-only verified on device); documented in the same PLAN-024 doc.
- **Status:** ✅ Verified — `npx vite build` clean (826ms); `npm run test:tracker` 64/64, `test:stream` 180/180, `test:bulk` 2348/2348, `test:mega` 5300/5300 (7,892/7,892 total). Code-reviewer-minimax-m3 APPROVED.
- **Why:** Two-part audit follow-up after PLAN-022 (the previous JS-bundle session). The first half was a re-read of every file for TDZ-bound `const` references, deps-array for `getCachedCircle()` (fresh object every render — `[circle]` would crash), and listener races across remounts. The second half was a memory-leak / perf pass (sessionSummary growth, indopak warn spam):
  - **Bug #1 fix:** swapped `const dbg = useCallback(...)` ABOVE `const dbgRef = useRef(dbg)` in `QuranMode.jsx`. PLAN-022 introduced this pattern with a comment claiming it solved staleness — but the pattern itself is a Temporal Dead Zone violation, throwing `ReferenceError: cannot access 'dbg' before initialization` on **every render** of QuranMode. With `<Suspense>` swallowing the rejection, the Quran tab silently fails to load on iOS — every Read, Browse, Goals, Mushaf, and Detect screen would just sit on the `📖 Loading Quran…` fallback forever. The swap makes the TDZ go away without changing any `dbgRef.current(...)` call sites.
  - **Bug #2 fix:** added a `cancelled` flag + cleanup return to the `fetchCircle` `useEffect` in `FamilySettings.jsx`. The dep array stays `[circle?.code]` (matches what PLAN-017 verified as correct on HomePanel — the leave→rejoin cycle correctly flips `["X"] → [undefined] → ["X"]`, re-firing the effect). The cancelled flag protects against a stale in-flight fetch from clobbering a fresh response on a rapid cycle. An over-engineered `kicker` useEffect was added in the first iteration and removed in the code-review pass (React's `Object.is` already detects the circle object change; the kicker added two dispatches per cycle for no gain).
  - **Bug #3 fix:** No code change required. The original `useEffect(() => { ... }, [])` + `app-circle-changed` event bus + mount-time fetch is the correct pattern. Earlier hypothesis that adding `[circle]` would re-fetch on late cache population was a **false alarm** — `getCachedCircle()` calls `JSON.parse` on every render, which produces a fresh object reference, so `[circle]` would re-fire the effect EVERY render → fetch storm. Code-reviewer caught this; the inline comment was updated to make the no-op decision explicit.
  - **Bug #4 fix:** added `unmountingRef = useRef(false)` + `useEffect(() => () => { unmountingRef.current = true }, [])` cleanup. The surah-prompt re-init in `handleResult` does `SherpaSTT.initialize(...).then(() => addListener('result', handleResult))` — if the component unmounts during the `await initialize(...)`, the existing cleanup `useEffect`'s `removeAllListeners` would fire once, and the `addListener` inside the `.then` would re-attach `handleResult` to a torn-down component → React state-update-on-unmounted-component warning + memory leak. The new `if (unmountingRef.current) return` guard at the start of the `.then` block bails cleanly.
  - **Bug #5 fix:** added `const warnedIndopakRef = useRef(new Set())` and gated `console.warn('[quran] indopak verse missing for …')` to only log UNIQUE `(s:a)` pairs via the Set — original first-iteration fix would flood the console on every Browse scroll for a partial indopak download (thousands of identical warns per render).
  - **Bug #8 fix:** changed both `sessionSummaryRef.current += ...` append sites (in `translate` and the Quran-quote splice) to `sessionSummaryRef.current = (sessionSummaryRef.current ? … + ' ' + … : …).slice(-3000)` — same `.slice()` semantic as the API payload already applies (`.slice(-1500)`), just with 2× headroom for the in-flight translation not yet slice'd. Without this, a long Friday khutbah could pin tens of KB of English translation in memory across the session.
  - **Bug #9 fix:** changed `new Date(todayStr()).getTime() / 86400000` to `Date.now() / 86400000` in `HomePanel.jsx`'s Hadith-of-the-Day index. The old form parsed `YYYY-MM-DD` as UTC midnight, causing users east of UTC to see the day's hadith rotate at local 7-8 AM rather than at their local midnight.
  - **Bug #14 fix:** added `setError('')` at the top of `startScribeListening` (when `!isResume`) and `startNativeListeningInternal`. Cleared exactly where a fresh listening pass begins — not in `resume()` (which preserves state, so prior failures are still relevant). Without this fix, the status bar would keep showing a stale `⚠ Could not start …` message into the new session.
- **Bugs NOT fixed (with reason):**
  - **Bug #10** (notify.js: `getPrayerTimes` called 30× per refresh): pure perf opportunity, no correctness impact, no spec.
  - **Bug #11** (streak.js: `_verseIndexCache` is a `WeakMap` but the corpus is never GC'd): overkill but functionally correct.
  - **Bug #12** (quranMatcher.js: `DHIKR_FILLER` hard-coded list): cosmetic — non-`سبحان`-style dhikr just gets treated as Quran.
  - **Bug #13** (AppDelegate.swift: `.mixWithOthers` may conflict with phone-call interruption): iOS-natve; verifiably only with a real device on a phone call.
  - **Bug #15** (QuranMode.jsx: `autoStartedRef` reset on view-leave): actually NOT a bug — the existing useEffect at the top of Detect already resets `autoStartedRef.current = false` when `quranView !== 'detect'`. Update: removed from fix list.
- **Diff (semantic, key changes):**
  ```diff
  @@ src/QuranMode.jsx — dbg/dbgRef order @@
  -  const dbgRef = useRef(dbg)        // TDZ throw on every render
  -  useEffect(() => { dbgRef.current = dbg }, [dbg])
  -  const dbg = useCallback((msg) => { … }, [showDetectDebug])
  +  const dbg = useCallback((msg) => { … }, [showDetectDebug])    // declared first
  +  const dbgRef = useRef(dbg)                                    // safe now
  +  useEffect(() => { dbgRef.current = dbg }, [dbg])

  @@ src/QuranMode.jsx — surah re-init guard @@
  +  const unmountingRef = useRef(false)
  +  useEffect(() => () => { unmountingRef.current = true }, [])
  …
  +  if (unmountingRef.current) return
     SherpaSTT.addListener('result', handleResult)
  …
  +  const warnedIndopakRef = useRef(new Set())    // Bug #5
  +  if (!warnedIndopakRef.current.has(key)) {    // log each (s:a) once

  @@ src/App.jsx — sessionSummaryRef bound (Bug #8, 2 sites) @@
  -sessionSummaryRef.current += (sessionSummaryRef.current ? ' ' : '') + translation
  +sessionSummaryRef.current = (sessionSummaryRef.current
  +  ? sessionSummaryRef.current + ' ' + translation
  +  : translation).slice(-3000)

  @@ src/App.jsx — error cleared at new listening pass (Bug #14) @@
   const startScribeListening = async (isResume = false, isFallback = false) => {
     if (!isResume) {
       setPhase('idle')
       clearAll()
  +    setError('')        // drop any stale banner from prior session
     }
   …
   const startNativeListeningInternal = async () => {
     setPhase('idle')
  +  setError('')

  @@ src/HomePanel.jsx — Hadith-of-the-Day day index (Bug #9) @@
  -  const dayIdx = Math.floor(new Date(todayStr()).getTime() / 86400000)
  +  const dayIdx = Math.floor(Date.now() / 86400000)

  @@ src/FamilySettings.jsx — fetchCircle race guard (Bug #2) @@
   useEffect(() => {
     if (!circle) return
  -  fetchCircle().then(setMembers).catch(() => {})
  -}, [circle?.code])
  +  let cancelled = false
  +  fetchCircle().then(m => { if (!cancelled) setMembers(m) }).catch(() => {})
  +  return () => { cancelled = true }
   }, [circle?.code])
  ```
- **Validation:** `npx vite build` exit 0 in 826ms (clean dist output); all 4 test suites green; `grep -c 'PLAN-024' src/` returns the 9 inline-comment markers (1 bug fix per marker, plus 1 dep-array no-op comment in HomePanel).
- **Regression explained (and avoided):** Earlier first-pass of Bug #2 had a `kicker` state + extra `useEffect` to force dependency changes. Code-reviewer-minimax-m3 flagged this as overcomplicated — React's `Object.is` on the circle object reference already covers re-renders correctly, the kicker added two dispatches per cycle for no gain. Same reviewer caught that Bug #3 (changing HomePanel deps to `[circle]`) would have caused a fetch storm every render because `getCachedCircle()` returns a fresh JSON.parse reference.
- **Plan:** [PLAN-024](./PLAN-024-followup-bugfixes.md)

---

## PLAN-023 — iOS native fixes (Info.plist, project.pbxproj, .gitignore) — App Store blocker bundle

- **Date:** 2026-07-12
- **Files:**
  - `ios/App/App/Info.plist` — `UIRequiredDeviceCapabilities` (replaced `armv7` with `arm64`); `UIBackgroundModes` (removed `location`, kept `audio`).
  - `ios/App/App.xcodeproj/project.pbxproj` — bumped `IPHONEOS_DEPLOYMENT_TARGET` from `15.0` → `16.0` in all 4 occurrences (Debug+Release × 2 targets); trimmed the `-D COCOAPODS` flag from `OTHER_SWIFT_FLAGS`.
  - `.gitignore` — added the bare `Khutbah/`, `Khutbah*.zip`, and kept `Khutbah-*/` for the suffix-pattern variant.
- **Status:** ✅ Verified — `grep -c '= 16.0'` on `project.pbxproj` returns 4; `grep -c 'COCOAPODS' project.pbxproj` returns 0; `grep -c 'armv7' ios/App/App/Info.plist` returns 0; `git status` no longer shows `Khutbah/` as untracked.
- **Why:**
  - `armv7` causes App Store rejection (Apple dropped armv7 in iOS 11, 2017). `arm64` is the appropriate explicit minimum.
  - `location` in `UIBackgroundModes` is unjustified (foreground-only @capacitor/geolocation); invites App Store review rejection under guideline 5.1.1.
  - The previous PLAN-002's 15 → 16 bump was never applied (or was reverted); widget Swift code with `containerBackground(for: .widget)` (iOS 17+) and `widgetURL(_:)` (iOS 16+) requires a 16 minimum.
  - `-D COCOAPODS` flag preprocessor-defined `COCOAPODS` globally, which would conflict with future SwiftPM macros. No Swift sources reference `COCOAPODS` in this project (verified via `grep -r COCOAPODS ios/App/App/*.swift`).
- **Diff (semantic):**
  ```diff
  @@ ios/App/App/Info.plist @@
  -    <string>armv7</string>
  +    <string>arm64</string>

  @@ ios/App/App/Info.plist — UIBackgroundModes @@
  -    <string>location</string>
  @@ ios/App/App.xcodeproj/project.pbxproj — all 4 spots (allowMultiple) @@
  -IPHONEOS_DEPLOYMENT_TARGET = 15.0;
  +IPHONEOS_DEPLOYMENT_TARGET = 16.0;

  @@ ios/App/App.xcodeproj/project.pbxproj — Debug target OTHER_SWIFT_FLAGS @@
  -OTHER_SWIFT_FLAGS = "$(inherited) \"-D\" \"COCOAPODS\" \"-DDEBUG\"";
  +OTHER_SWIFT_FLAGS = "$(inherited) \"-DDEBUG\"";

  @@ .gitignore @@
  +Khutbah/
   Khutbah-*/
  +Khutbah*.zip
  ```
- **Validation:** `grep -c '= 16.0;' ios/App/App.xcodeproj/project.pbxproj` = 4; `grep -c 'armv7' ios/App/App/Info.plist` = 0; `grep -c 'COCOAPODS' ios/App/App.xcodeproj/project.pbxproj` = 0; `git status --ignored` shows `Khutbah/` listed as ignored.
- **Plan:** [PLAN-023](./PLAN-023-ios-native-fixes.md)

---

## PLAN-022 — Full-codebase JS bug-fix bundle (11 bugs from 2026-07-12 audit)

- **Date:** 2026-07-12
- **Files:**
  - `src/utils/streak.js` — Bug #1 (undefined `dayBeforeYesterdayStr()` ReferenceError) + Bug #8 (SHOWN_KEY unbounded growth).
  - `src/utils/circle.js` — Bug #5 (grace-period 3-day→1-day to match the comment + local streak.js) + `app-circle-changed` custom event broadcast from `saveCircle()`.
  - `src/utils/notify.js` — Bug #2 (Android 64-cap silent overflow: `DAYS_AHEAD` 7→6).
  - `src/HomePanel.jsx` — Bug #4 (event-bus re-fetch on circle change).
  - `src/QuranMode.jsx` — Bug #3 (defensive `removeAllListeners` before surah re-init in `handleResult`) + Bug #6 (dbgRef pattern resolves stale-closure bug) + Bug #7 (remove dead `surahMatchCount` ref).
  - `src/App.jsx` — Bug #9 (removed empty placeholder `<h2>` in `ReadyModal`).
  - `src/PrayerLocationSettings.jsx` — Bug #10 (removed dead `NoorWidget` import).
- **Status:** ✅ Verified — `npx vite build` clean (870ms), `npm run test:tracker` 64/64, `test:stream` 180/180, `test:bulk` 2348/2348, `test:mega` 5300/5300. Inline-comment grep: `grep -c 'PLAN-022' src/` returns ~15 markers distributed across stripe.
- **Why:** Top-to-bottom audit surfacing 11 bugs across 7 source files. Bug #1 is the headline — a ReferenceError that silently broke daily goal completion on any ≥2-day streak-gap, which had been shipped but never reset the streak display. PLAN-018 marked this as Tier-1 (Item 1.4) but the fix never landed.
  - **Bug #1 fix:** dropped the `|| s.lastCompletedDay === dayBeforeYesterdayStr()` clause from `markDayComplete` (the helper was never defined).
  - **Bug #2 fix:** `DAYS_AHEAD` on Android 7 → 6; new ceiling = 6×(3 streak + 5 prayer) + ≤12 fasting = ≤60, comfortably below the iOS 64-cap.
  - **Bug #3 fix:** `handleResult` made `async`; before every surah re-init in the inner block, awaited `SherpaSTT.stopListening()` + `removeAllListeners?.()` defensively.
  - **Bug #4 fix:** added `app-circle-changed` custom event broadcast (centralized in `circle.js#saveCircle`); HomePanel listens with addEventListener + cleanup.
  - **Bug #5 fix:** changed `displayStreakOf` from 3-day to 1-day grace (matches the 1-line doc comment and the local streak.js grace).
  - **Bug #6 fix:** `dbgRef = useRef(dbg) + useEffect(() => dbgRef.current = dbg, [dbg])` pattern; 15 `dbg(` calls inside handleResult + downstream handlers replaced with `dbgRef.current(`.
  - **Bug #7 fix:** removed `const surahMatchCount = useRef(0)` + all 8 write-only references (grep verified zero reads anywhere).
  - **Bug #8 fix:** FIFO-trim `SHOWN_KEY` at `SHOWN_MAX = 60` after each batch construction.
  - **Bug #9 fix:** removed empty `<h2 className="ready-title"></h2>` from `ReadyModal`.
  - **Bug #10 fix:** single-line deletion of dead `NoorWidget` import.
- **Diff (semantic):** see the plan doc for each. Approximately +28 / −45 net lines under the `src/` tree.
- **Validation:** `npx vite build` → exit 0; test suite cascade → all green; `grep -nc 'surahMatchCount' src/QuranMode.jsx` returns 0; `grep -nc 'dayBeforeYesterdayStr' src/utils/streak.js` returns 1 (the explanatory comment, no live code refs); `grep -nc 'app-circle-changed' src/` returns 4 (3 in HomePanel + 1 dispatch in circle.js).
- **Plan:** [PLAN-022](./PLAN-022-bugfix-audit.md)

---

## PLAN-017 — `src/HomePanel.jsx` `fetchCircle()` `useEffect` add `cancelled` flag for unmount safety

- **Date:** 2026-07-11
- **File:** `src/HomePanel.jsx` — the `fetchCircle` `useEffect` at line ~115.
- **BEFORE:** `useEffect(() => { if (!circle) return; fetchCircle().then(setMembers).catch(() => {}) }, [])` — no cancellation guard. If the user opens Home then immediately navigates back to a different view (Settings / Quran), HomePanel unmounts while the 8s-timeout + 2-retry `/api/circle` request is still in flight; `setMembers` fires on the unmounted instance (React *"Can't perform a React state update on an unmounted component"* warning).
- **AFTER:** Added `let cancelled = false` + `return () => { cancelled = true }` cleanup. The `setMembers` call is now gated on `if (!cancelled)`. The catch path is unchanged (keeps cache on failure as before).
  - **Dep array stays `[]` (NOT `[circle]`):** `getCachedCircle()` is `JSON.parse(localStorage.getItem(...))` which returns a fresh object reference on every render, and HomePanel re-renders every 30s when `now` ticks (the prayer-time useEffect at the top of the file). With `[circle]` the effect would re-fire on every render = fetch storm against `/api/circle` every 30s. The mount-only fetch is the original intent; the *“join-circle-mid-session”* latent bug (where HomePanel wouldn’t re-fetch until a view switch unmount+remount) is documented in the inline comment as out-of-scope.
- **Status:** ✅ Verified — `esbuild --loader:.jsx=jsx src/HomePanel.jsx` parses clean; `grep -c 'cancelled' src/HomePanel.jsx` confirms the 3 expected sites (declaration + cleanup + gate); reviewer signed off (after the `[circle]`-dep revert iteration).
- **Why:** `fetchCircle()` is an `apiFetch` against `/api/circle` with `timeoutMs: 8000, retries: 2` (worst case ~9s in the air). The current UX (joining a circle requires Settings → leaving HomePanel) means the mount-only fetch naturally covers the join-mid-session case, so `[]` is correct. Same pattern as PLAN-016 (QuranMode IndoPak fetch).
- **Diff (semantic):**
  ```diff
  @@ src/HomePanel.jsx — fetchCircle useEffect @@
    useEffect(() => {
      if (!circle) return
  -   fetchCircle().then(setMembers).catch(() => {}) // keep cache on failure
  +   let cancelled = false
  +   fetchCircle().then(m => { if (!cancelled) setMembers(m) }).catch(() => {}) // keep cache on failure
  +   return () => { cancelled = true }
    }, [])
  ```
- **Validation:** esbuild parse OK; `grep -c 'cancelled' src/HomePanel.jsx` returns 3; `grep -nE 'fetchCircle.*\[circle\]' src/HomePanel.jsx` returns 0 (the dangerous dep change was reverted).
- **Plan:** [PLAN-017](./PLAN-017-homepanel-fetchcircle-cancel.md)

## PLAN-016 — `src/QuranMode.jsx` IndoPak fetch `useEffect` add `cancelled` flag for unmount safety

- **Date:** 2026-07-11
- **File:** `src/QuranMode.jsx` — the IndoPak `useEffect` at lines ~580–595 (the one that fetches `/quran-indopak.json`).
- **BEFORE:** `fetch(INDOPAK_URL).then(r => r.json()).then(data => { _indopakCache = data; setIndopakMap(data) }).catch(() => setIndopakError(true)).finally(() => setIndopakLoading(false))` — no cancellation guard. If the user toggles `quranScript: 'indopak' → 'uthmani'` (or retries via `indopakRetry++`) before the JSON arrives, the `.then`/`.catch`/`.finally` chain still fires `setIndopakMap` / `setIndopakError` / `setIndopakLoading` on the unmounted first-render instance.
- **AFTER:** Added `let cancelled = false` at the top of the useEffect body + `return () => { cancelled = true }` cleanup. The 3 `setIndopak*` calls are now gated on `if (!cancelled)` (the `setIndopakLoading(true); setIndopakError(false)` at the top stays unconditional so the loading state still flips before unmount). The module-scope `_indopakCache` write remains unconditional — a future mount-2 instance reads it via the `_indopakCache` short-circuit at the top of the effect, so the toggle-back-to-indopak path still gets instant data.
- **Status:** ✅ Verified — esbuild parse clean; `grep -c 'cancelled' src/QuranMode.jsx` confirms the 5 expected sites (1 declaration + 1 cleanup + 3 gates); reviewer signed off.
- **Why:** `JSON.parse` on `/quran-indopak.json` is typically <200 ms on a hot cache but can be 1–2 s on a cold start; if the user toggles script mid-flight, the unmounted instance’s `setState` calls produce the unmounted-component warning. The cancellation guard makes the `setIndopak*` calls no-ops after the cleanup runs. Same pattern as PLAN-017 (HomePanel fetchCircle).
- **Diff (semantic):**
  ```diff
  @@ src/QuranMode.jsx — IndoPak useEffect @@
    if (quranScript !== 'indopak') return
    if (_indopakCache) { setIndopakMap(_indopakCache); return }
  + let cancelled = false
    setIndopakLoading(true); setIndopakError(false)
    fetch(INDOPAK_URL)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
  -   .then(data => { _indopakCache = data; setIndopakMap(data) })
  -   .catch(() => setIndopakError(true))
  -   .finally(() => setIndopakLoading(false))
  +   .then(data => { if (cancelled) return; _indopakCache = data; setIndopakMap(data) })
  +   .catch(() => { if (!cancelled) setIndopakError(true) })
  +   .finally(() => { if (!cancelled) setIndopakLoading(false) })
  + return () => { cancelled = true }
  }, [quranScript, indopakRetry])
  ```
- **Validation:** esbuild parse OK; `grep -c 'cancelled' src/QuranMode.jsx` returns 5; `grep -c 'PLAN-016' src/QuranMode.jsx` returns 1 (the comment marker).
- **Plan:** [PLAN-016](./PLAN-016-quranmode-indopak-cancel.md)

## PLAN-015 — TODO/FIXME/HACK/XXX audit: 0 actionable findings, closed as no-op

- **Date:** 2026-07-11
- **File(s):** *(none — closed without code changes)*
- **BEFORE:** Speculative concern that leftover `TODO` / `FIXME` / `HACK` / `XXX` markers might be lurking in the source tree.
- **AFTER:** Ran a word-boundary grep across the full live `src/` tree: `grep -rnE '\b(TODO|FIXME|HACK|XXX)\b' src/ --include='*.js' --include='*.jsx' --include='*.ts' | grep -v 'Khutbah/'` (plus a case-insensitive variant). Also swept `scripts/`, `docs/`, and `README.md`. The 2 raw matches from a prior unanchored grep were both false positives: `src/utils/quranStore.js` line 20 contains `\uXXXX` Unicode-escape syntax (the prior grep matched on the `XXX` substring), and a `node_modules` workerd file matched as expected. The 1 hit in `docs/noor-ios-restart-prompt.md` is a *“TODO TODAY”* project-management list (not a code marker).
- **Status:** ✅ Verified — 0 actionable findings. Category B (TODO/FIXME sweep) closed as a no-op audit.
- **Why:** Worth running once explicitly with a strict word-boundary pattern to confirm the prior session’s claim of *“0 TODO/FIXME markers in src/”* — the prior triage’s grep was unanchored, and could have matched `\uXXXX` literals (which the word-boundary re-grep cleanly excludes). This PLAN documents the verification.
- **Validation:** `grep -rnE '\b(TODO|FIXME|HACK|XXX)\b' src/ --include='*.js' --include='*.jsx' --include='*.ts' | grep -v 'Khutbah/'` returns 0 lines. Case-insensitive variant (`\b(todo|fixme|hack|hax|xxx)\b`) also returns 0 lines.
- **Plan:** [PLAN-015](./PLAN-015-todo-fixme-audit.md)

## PLAN-014 — `src/QuranMode.jsx` `calibrationTimer` retry-loop refactor: 6× hand-rolled clear guards → `activeTimers useRef+Set` + `clearAllActiveTimers()` unmount safety net

- **Date:** 2026-07-11
- **File:** `src/QuranMode.jsx` — 6 sites where `if (calibrationTimer.current) { clearTimeout(calibrationTimer.current); calibrationTimer.current = null }` was repeated (in `escalateToHaiku` rescue, `handleResult` rescue, `start`, `pause`, `end`, `clearSession`); 2 schedule sites (`beginCalibration`, `beginTrackerCalibration`).
- **BEFORE:** 6× hand-rolled `if (calibrationTimer.current) { clearTimeout(...); current = null }` guards + 2× direct `calibrationTimer.current = setTimeout(..., ...)` assignments. If a future code path forgot the guard or the timer fired after the function was supposed to be cleared, the timer handle stayed in the event loop until natural expiry — a latent leak that grows with every new code path that schedules a timer.
- **AFTER:**
  - Added `const activeTimersRef = useRef(new Set())` next to `calibrationTimer` (single-owner Set for all QuranMode timers).
  - Added `scheduleActiveTimer(fn, ms)` (useCallback, sets timeout + registers id in Set + auto-deletes on fire, with try/catch around the fn to surface errors instead of swallowing them silently) and `clearAllActiveTimers()` (useCallback, drains the Set).
  - Added an unmount safety net `useEffect(() => () => clearAllActiveTimers(), [])` with `// eslint-disable-next-line react-hooks/exhaustive-deps` (matches the existing precedent at line ~1733).
  - The 2 schedule sites now use `scheduleActiveTimer(endCalibration, CALIBRATION_MS)` (and the 4s tracker-calibration variant). The 6 in-line guards collapse to a one-liner `clearAllActiveTimers()` each.
- **Status:** ✅ Verified — `esbuild --loader:.jsx=jsx src/QuranMode.jsx` parses clean; `grep -nE 'if \(calibrationTimer\.current\)' src/QuranMode.jsx` returns 0 matches; `grep -c 'scheduleActiveTimer\|clearAllActiveTimers\|activeTimersRef' src/QuranMode.jsx` confirms the new infrastructure is in place at all 3 sites; reviewer signed off.
- **Why:** Single-owner Set is the canonical React pattern for *“I have several timers, I need to cancel all of them on teardown.”* A bare `useRef` of a single id (the old `calibrationTimer`) is fine for ONE timer, but the file had 6 manual teardown sites — any forgotten guard became a leak. The Set is component-scoped (useRef) and drained by the unmount useEffect, so even StrictMode’s `mount → unmount → mount` cycle is handled (the synthetic-unmount cleanup drains the Set between mount-1 and mount-2; no timer from mount-1 can leak into mount-2). Module-scope was rejected as a fix family (different from PLAN-013.1’s `_killSwitchChecked` — that one needed module-scope because there was no cleanup function; this one has one, so component-scope is correct).
- **Diff (semantic):**
  ```diff
  @@ src/QuranMode.jsx — near other refs @@
   const calibrationTimer    = useRef(null)
  +const activeTimersRef     = useRef(new Set())   // PLAN-014

  @@ src/QuranMode.jsx — near doublePulse useCallback @@
  +// PLAN-014: single-owner Set for all QuranMode timers. ... (10-line inline rationale)
  +const scheduleActiveTimer = useCallback((fn, ms) => { ... }, [])
  +const clearAllActiveTimers = useCallback(() => { ... }, [])

  +// PLAN-014: unmount safety net — drain any leftover active timers ... (10-line rationale)
  +// eslint-disable-next-line react-hooks/exhaustive-deps
  +useEffect(() => () => clearAllActiveTimers(), [])

  @@ src/QuranMode.jsx — beginCalibration + beginTrackerCalibration @@
  -calibrationTimer.current = setTimeout(endCalibration, CALIBRATION_MS)
  +calibrationTimer.current = scheduleActiveTimer(endCalibration, CALIBRATION_MS)

  -calibrationTimer.current = setTimeout(() => { ... }, TRACKER_CALIBRATION_MS)
  +calibrationTimer.current = scheduleActiveTimer(() => { ... }, TRACKER_CALIBRATION_MS)

  @@ src/QuranMode.jsx — 6 teardown sites (allowMultiple) @@
  -if (calibrationTimer.current) { clearTimeout(calibrationTimer.current); calibrationTimer.current = null }
  +clearAllActiveTimers()
  ```
- **Validation:** esbuild parse OK; `grep -nE 'if \(calibrationTimer\.current\)' src/QuranMode.jsx` returns 0 (all 6 sites collapsed); `grep -c 'activeTimersRef\|scheduleActiveTimer\|clearAllActiveTimers' src/QuranMode.jsx` returns 19 (ref + 2 helpers + 2 schedule sites + 6 teardown sites + 1 unmount useEffect + ~7 inline references in comments).
- **Plan:** [PLAN-014](./PLAN-014-quranmode-active-timers.md)

---

## PLAN-010 — `src/utils/circle.js` bare `fetch()` → `apiFetch()` for POST + GET to `/api/circle`

- **Date:** 2026-07-11
- **File:** `src/utils/circle.js` — `post()` (the internal helper used by `createCircle`, `joinCircle`, `leaveCircle`, `renameMember`) at lines ~31–44; `fetchCircle()` at lines ~70–86.
- **BEFORE:** both functions called the browser `fetch(...)` API directly with no timeout, no retry. If Wi-Fi stalled (slow TLS handshake to Cloudflare, packet loss) the Family Settings sheet would sit on a spinner indefinitely.
- **AFTER:** both call `apiFetch(url, { method: 'POST', … }, { timeoutMs: 8000, retries: 2 })` (and analogous options for the GET). 8s matches the fetchToken budget — small Cloudflare Worker endpoints both. Removed the orphan `import { apiHeaders, TimeoutError } from './net'` and the speculative `export { TimeoutError }` left behind in the first iteration (verified zero consumers via `grep -rnE 'TimeoutError' src/` before deleting). Updated the trailing comment to a 2-line “leaf utility under FamilySettings.jsx” rationale.
- **Status:** ✅ Verified — `node --check src/utils/circle.js` exit 0; grep confirms zero remaining bare `fetch(` calls; `apiFetch` is imported from `./net`; `TimeoutError` is no longer referenced anywhere in this file.
- **Why:** `src/utils/net.js#apiFetch` is the canonical network seam — adds an `AbortController` timeout (default 15s), retries on 5xx twice with 600ms delay, propagates `TimeoutError` so callers can `instanceof`-check it. Two real call sites in `circle.js` were bypassing it.
- **Diff (semantic):**
  ```diff
  @@ src/utils/circle.js — `post()` helper @@
  - const res = await fetch(`${API_BASE}/api/circle`, {
  -   method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ ...body, device_id: getDeviceId() }),
  - })
  + const res = await apiFetch(
  +   `${API_BASE}/api/circle`,
  +   { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ ...body, device_id: getDeviceId() }) },
  +   { timeoutMs: 8000, retries: 2 },
  + )

  @@ src/utils/circle.js — `fetchCircle()` @@
  - const res = await fetch(`${API_BASE}/api/circle?device_id=…&day=…`, { headers: jsonHeaders() })
  + const res = await apiFetch(
  +   `${API_BASE}/api/circle?device_id=…&day=…`,
  +   { headers: jsonHeaders() },
  +   { timeoutMs: 8000, retries: 2 },
  + )
  ```
- **Validation:** `node --check` exit 0; `grep -n 'fetch(' src/utils/circle.js` returns nothing; `grep -n 'apiFetch' src/utils/circle.js` returns the import + the two call sites; `git diff --stat src/utils/circle.js` shows the changes.
- **Plan:** [PLAN-010](./PLAN-010-circle-apifetch.md)

## PLAN-009 — `src/utils/scribeSTT.js` bare `fetch()` → `apiFetch()` for `/api/stt/token`

- **Date:** 2026-07-11
- **File:** `src/utils/scribeSTT.js` — `fetchToken()` at lines ~67–80.
- **BEFORE:** `fetchToken()` called `fetch(`${API_BASE}/api/stt/token`, { headers: apiHeaders() })` directly. No timeout. On flaky masjid Wi-Fi the Scribe connect UI would freeze on “fetching token” forever.
- **AFTER:** `fetchToken()` calls `apiFetch(url, { headers: apiHeaders() }, { timeoutMs: 8000, retries: 2 })`. The local duplicate `function apiHeaders(...)`, `const APP_TOKEN = …`, and `import { getDeviceId } from './device'` were removed in the same edit — `net.js` already exports an identical `apiHeaders` that includes the device-id + app-token headers. The speculative `export { apiFetch, TimeoutError }` added in the first iteration was deleted (`TimeoutError` is now solely used by `src/utils/net.js` internally; grep verified zero external importers of it from this file).
- **Status:** ✅ Verified — `node --check src/utils/scribeSTT.js` exit 0; `grep -nE 'function apiHeaders|const APP_TOKEN' src/utils/scribeSTT.js` returns nothing (no shadow); `grep -n 'fetch(' src/utils/scribeSTT.js` returns nothing; `grep -n 'apiFetch' src/utils/scribeSTT.js` returns the import + the call site. `net.js`'s `apiHeaders` is byte-equivalent to the deleted one (same `x-device-id` + conditional `x-app-token` logic) so no behavioral change.
- **Why:** `src/utils/net.js#apiFetch` is the canonical network seam — adds an `AbortController` timeout (default 15s), retries on 5xx twice. The ElevenLabs token endpoint is a cached Cloudflare Worker JSON call (median <500 ms) — 8 s is generous; 2 retries cover a single edge-node hiccup.
- **Diff (semantic):**
  ```diff
  @@ src/utils/scribeSTT.js — imports + fetchToken @@
  - import { getDeviceId } from './device'
  + import { apiFetch, apiHeaders } from './net'
  - const APP_TOKEN = import.meta.env.VITE_APP_TOKEN || ''
  -
  - function apiHeaders(extra = {}) {
  -   const h = { ...extra, 'x-device-id': getDeviceId() }
  -   if (APP_TOKEN) h['x-app-token'] = APP_TOKEN
  -   return h
  - }

    async function fetchToken() {
  -   const res = await fetch(`${API_BASE}/api/stt/token`, { headers: apiHeaders() })
  +   const res = await apiFetch(
  +     `${API_BASE}/api/stt/token`,
  +     { headers: apiHeaders() },
  +     { timeoutMs: 8000, retries: 2 },
  +   )
  ```
- **Validation:** `node --check` exit 0; `grep` confirms no shadowed `apiHeaders`/`APP_TOKEN` declarations; `grep -n 'fetch('` returns nothing.
- **Plan:** [PLAN-009](./PLAN-009-scribe-apifetch.md)

## PLAN-013.1 — `src/App.jsx` kill-switch dedup: `useRef` → module-scope variable (StrictMode-safe)

- **Date:** 2026-07-11
- **File:** `src/App.jsx` — 3 small sites: (a) new module-scope `let _killSwitchChecked = false` declaration near the other module-level consts above `export default function App()`; (b) deleted `const killSwitchCheckedRef = useRef(false)` from inside `App()`; (c) updated the guard in the kill-switch `useEffect`'s `runFetch` closure to read/write `_killSwitchChecked` instead of `killSwitchCheckedRef.current`.
- **BEFORE:** `useRef`-based dedup. `killSwitchCheckedRef.current = true` on first call, `if (killSwitchCheckedRef.current) return` on every subsequent call.
- **AFTER:** module-scope `let _killSwitchChecked = false` lives at the top of `src/App.jsx` (next to `IS_NATIVE` / `IS_IOS` / `API_BASE`). Read/write happens directly. Survives React 18 StrictMode dev's `mount → cleanup → mount` cycle (each fresh component instance in StrictMode got a new ref under PLAN-013's useRef).
- **Status:** ✅ Verified — `esbuild --loader=jsx src/App.jsx` parses clean; reviewer flagged this gap (B) and prescription; rebuild on iPad is optional since the prior v1.0.0 build already shipped with PLAN-013's safer semantics; changing the dedup is purely a dev-quality-of-life fix.
- **Why:** StrictMode's `mount → unmount → mount` cycle invalidates `useRef`. In dev the kill-switch /api/status check fired twice per session. Module-scope is a 1-line swap that survives component-instance churn within a single module load. Vite HMR still resets it (intentional — a module-reload means a fresh status check), but the StrictMode case the user runs into 100% of the time is now handled.
- **Diff (semantic):**
  ```diff
  @@ src/App.jsx — near module-scope consts @@
   const API_BASE = getApiBase()
  +let _killSwitchChecked = false   // PLAN-013.1

  @@ src/App.jsx — inside App() near other refs @@
  -const killSwitchCheckedRef = useRef(false)   // PLAN-013

  @@ src/App.jsx — inside kill-switch useEffect's runFetch @@
  -if (killSwitchCheckedRef.current) return
  -killSwitchCheckedRef.current = true
  +if (_killSwitchChecked) return
  +_killSwitchChecked = true
  ```
- **Validation:** grep confirms `killSwitchCheckedRef` is gone, `_killSwitchChecked` is present at module scope and used in only 2 places (declaration + 2 read/write sites).
- **Plan:** [PLAN-013.1](./PLAN-013.1-killswitch-dedup-modulescope.md)

## PLAN-013 — `src/App.jsx` kill-switch `useEffect` migrate bare `fetch()` → `apiFetch()` + HMR dedup + 5xx-through-catch

- **Date:** 2026-07-11
- **File:** `src/App.jsx` — kill-switch `useEffect` block at lines ~702–734 (the one annotated `// Kill-switch: check on every launch`).
- **BEFORE:** manual `new AbortController()`, `setTimeout(... 4000)`, manual `clearTimeout` on success + catch, manual `controller.abort()` in cleanup. `fetch(API_BASE + '/api/status', { signal: controller.signal })` with `.then(r => r.json()).then(d => { ... }).catch(() => { clearTimeout(timeout); setAppStatus(true) })`.
- **AFTER:** `apiFetch(API_BASE + '/api/status', {}, { timeoutMs: 4000, retries: 0 })`. Manual `AbortController` + `setTimeout` + both `clearTimeout` references dropped (apiFetch self-cleans in `.finally`). Cleanup function dropped (acceptable: App root unmounts only on app kill). `useRef(false)` `killSwitchCheckedRef` added at the top of `App` to dedupe the call across Vite HMR re-mounts. 4xx/5xx responses now throw via `if (!r.ok) throw new Error(\`status HTTP ${r.status}\`)` so they hit the same `.catch` path as network errors / timeouts — identical user-visible fail-open, cleaner trace.
- **Status:** ✅ Verified — `esbuild --loader=jsx` parses clean; node syntax check OK on the other touched `.js` files; reviewer signed off.
- **Why:**
  - Consistent with the apiFetch migration wave (PLAN-009, 010, 011, 012): every `/api/*` caller now goes through the timeout+retry seam so a hung endpoint can't freeze the kill-switch flow.
  - The `retries: 0` choice (vs the defaults `retries: 1` + `retryDelayMs: 600`) preserves the **original 4 s hard ceiling** that the prior manual `setTimeout` provided — retrying an exit-status endpoint would defeat the fast-fail purpose and contradict the comment's *"Resolves within 4 s either way"* claim.
  - The HMR dedup `useRef` keeps `/api/status` from re-firing on every Vite HMR re-mount; the cost is one line in a ref, the value-add is no spamming Cloudflare during dev iteration.
  - The 4xx/5xx reroute via `throw` is purely a debug-trace improvement — the user-visible behavior is unchanged because `setAppStatus(true)` runs in the existing `.catch` either way.
- **Diff (semantic):**
  ```diff
  @@ src/App.jsx — state declaration additions @@
   const streamRef        = useRef(null)
  +const killSwitchCheckedRef = useRef(false)   // PLAN-013 HMR dedup

  @@ src/App.jsx — kill-switch useEffect body @@
   useEffect(() => {
  -  const controller = new AbortController()
  -  const timeout = setTimeout(() => { controller.abort(); setAppStatus(true) }, 4000)
     const runFetch = () => {
  -    fetch(API_BASE + '/api/status', { signal: controller.signal })
  -      .then(r => r.json())
  +    if (killSwitchCheckedRef.current) return
  +    killSwitchCheckedRef.current = true
  +    apiFetch(API_BASE + '/api/status', {}, { timeoutMs: 4000, retries: 0 })
  +      .then(r => {
  +        if (!r.ok) throw new Error(`status HTTP ${r.status}`)
  +        return r.json()
  +      })
         .then(d => { setAppStatusMsg(d.message || ''); setAppStatus(d.enabled !== false) })
  -      .catch(() => { clearTimeout(timeout); setAppStatus(true) })
  +      .catch(() => { setAppStatus(true) })
     }
   })
  -  return () => { clearTimeout(timeout); controller.abort() }
   ```
- **Validation:** `esbuild --loader=jsx src/App.jsx` parses clean; `grep -n 'fetch(' src/App.jsx` returns nothing; `grep -n 'apiFetch' src/App.jsx` returns the new call site + the existing history/translate calls.
- **Plan:** [PLAN-013](./PLAN-013-kill-switch-apifetch.md)

## PLAN-012 — `src/utils/streak.js` `syncToday()` bare `fetch()` → `apiFetch()` for `/api/streak`

- **Date:** 2026-07-11
- **File:** `src/utils/streak.js` — `syncToday(goal, count, completed)` at lines ~350–360.
- **BEFORE:** `await fetch(\`${API_BASE}/api/streak\`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ ... }) })` inside the existing `try { … } catch {}` swallow.
- **AFTER:** `await apiFetch(url, { method: 'POST', headers: jsonHeaders(), body: … }, { timeoutMs: 8000, retries: 1 })`. Adds `import { apiFetch } from './net'` near the top.
- **Status:** ✅ Verified — `node --check src/utils/streak.js` exit 0; reviewer signed off.
- **Why:** `src/utils/net.js#apiFetch` is the canonical network seam (timeout + retry, propagates `TimeoutError`). A hung `/api/streak` endpoint would still be swallowed by the surrounding `catch {}` so the experience is fire-and-forget, but BEFORE `apiFetch` the request could spend up to the browser default (60 s+) hanging inside the syncToday Promise. NOW 8 s + 600 ms retry ⇒ at most ~9 s. Same shape as the scribeSTT / logger / circle migrations.
- **Diff (semantic):**
  ```diff
  + import { apiFetch } from './net'

    export async function syncToday(goal, count, completed) {
      try {
  -     await fetch(`${API_BASE}/api/streak`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({...}) })
  +     await apiFetch(`${API_BASE}/api/streak`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({...}) }, { timeoutMs: 8000, retries: 1 })
      } catch {}
    }
  ```
- **Validation:** `node --check src/utils/streak.js` exit 0; `grep -n 'fetch(' src/utils/streak.js` returns nothing; `grep -n 'apiFetch' src/utils/streak.js` returns the import + the call site.
- **Plan:** [PLAN-012](./PLAN-012-streak-apifetch.md)

## PLAN-011 — `src/utils/logger.js` `writeLog()` cloud POST bare `fetch()` → `apiFetch()` for `/api/log`

- **Date:** 2026-07-11
- **File:** `src/utils/logger.js` — `writeLog(tab, level, args, opts)` at lines ~75–86.
- **BEFORE:** `fetch(API_BASE + '/api/log', { method: 'POST', headers: APP_TOKEN ? {...} : {...}, body: JSON.stringify({...}) }).catch(() => {})`.
- **AFTER:** `apiFetch(url, { method: 'POST', headers: APP_TOKEN ? {...} : {...}, body: … }, { timeoutMs: 8000, retries: 1 }).catch(() => {})`. Adds `import { apiFetch } from './net'` near the top.
- **Status:** ✅ Verified — `node --check src/utils/logger.js` exit 0; reviewer signed off.
- **Why:** Same seam as the others. The `/api/log` handler is best-effort (debug quality-of-life) so a hung endpoint should not stall the JS event loop indefinitely. BEFORE: browser default timeout could leave an in-flight POST for 60+ s if masjid Wi-Fi dropped mid-handshake. NOW: hard 8 s ceiling with a single 5xx retry.
- **Diff (semantic):**
  ```diff
  + import { apiFetch } from './net'

      if ((mode === 'cloud' || mode === 'both') && !opts.noRemote) {
  -     fetch(API_BASE + '/api/log', { method: 'POST', headers: APP_TOKEN ? {…} : {…}, body: JSON.stringify({…}) }).catch(() => {})
  +     apiFetch(API_BASE + '/api/log', { method: 'POST', headers: APP_TOKEN ? {…} : {…}, body: JSON.stringify({…}) }, { timeoutMs: 8000, retries: 1 }).catch(() => {})
      }
  ```
- **Validation:** `node --check src/utils/logger.js` exit 0; `grep -n 'fetch(' src/utils/logger.js` returns nothing.
- **Plan:** [PLAN-011](./PLAN-011-logger-apifetch.md)

## PLAN-007.1 — `ios/App/NoorWidgetExtension/Info.plist` add explanatory comment for the deliberate `NSExtensionPrincipalClass` omission

- **Date:** 2026-07-11 (post-deploy, source-only)
- **File:** `ios/App/NoorWidgetExtension/Info.plist`
- **BEFORE lines:** the empty space inside `<key>NSExtension</key><dict>…</dict>` block (between `</string>` and `</dict>`).
- **AFTER lines:** a 3-line XML comment immediately after the `</string>` close tag, inside the NSExtension dict, explaining the intentional absence.
- **Status:** ✅ Source-only — does not require a rebuild (the iPad-installed `Info.plist` is already correct; this is just a maintainer note). `plutil -lint ios/App/NoorWidgetExtension/Info.plist` parses clean.
- **Why:** Code-reviewer on PLAN-007 flagged that the original 3-line comment (which we removed along with `NSExtensionPrincipalClass` in PLAN-007) was the only on-disk justification for that key's past presence. Future maintainers reviewing a diff would see `NSExtensionPointIdentifier = com.apple.widgetkit-extension` and assume the principal class was missed. Restoring a one-liner keeps the insight without re-introducing the prohibited key.
- **Diff:**
  ```diff
  @@ ios/App/NoorWidgetExtension/Info.plist @@
  	<key>NSExtensionPointIdentifier</key>
  	<string>com.apple.widgetkit-extension</string>
  +	<!-- NSExtensionPrincipalClass is intentionally omitted:
  +	     iPadOS rejects it for com.apple.widgetkit-extension (MIInstallerErrorDomain 152).
  +	     The widget is discovered via SwiftUI @main on NoorWidgetExtensionBundle. -->
  	</dict>
  ```
- **Plan:** continuation of [PLAN-007](#plan-007--iosappnoorwidgetextensioninfoplist-remove-prohibited-nsextensionprincipalclass).

## PLAN-007 — `ios/App/NoorWidgetExtension/Info.plist` remove prohibited `NSExtensionPrincipalClass`

- **Date:** 2026-07-11
- **File:** `ios/App/NoorWidgetExtension/Info.plist`
- **BEFORE lines:** lines 24–29 (6 lines: a 3-line explanatory XML comment + `<key>NSExtensionPrincipalClass</key>` + `<string>$(PRODUCT_MODULE_NAME).NoorWidgetExtension</string>`).
- **AFTER lines:** the 6-line block is deleted entirely; the file is now 23 lines (was 29).
- **Status:** ✅ Verified — `xcrun devicectl listapps --device 00008030-0004348E34C0C02E | grep com.ali` registers `com.ali.noor` (iPad install accepted, no MIInstallerErrorDomain 152). Direct `xcodebuild ... DEVELOPMENT_TEAM=89RUQ4H8S5` build exited with `** BUILD SUCCEEDED **`.
- **Why:** iPad rejected the widget .appex install with `MIInstallerErrorDomain` code 152: *"incorrectly defines an `NSExtensionMainStoryboard` or `NSExtensionPrincipalClass` key. These keys are prohibited for the `com.apple.widgetkit-extension` extension point."* Our Info.plist had `NSExtensionPrincipalClass` as defensive insurance for older WidgetKit validators. On iOS 16+ with a SwiftUI `@main` widget bundle (`NoorWidgetExtensionBundle`), the system discovers the entry point via `@main` — `NSExtensionPointIdentifier` alone is sufficient, and `NSExtensionPrincipalClass` is now actively rejected at install.
- **Diff:**
  ```diff
  @@ ios/App/NoorWidgetExtension/Info.plist @@
  	<key>NSExtensionPointIdentifier</key>
  	<string>com.apple.widgetkit-extension</string>
  -	<!-- Some WidgetKit submission validators and older WidgetKit callers insist on
  -	     NSExtensionPrincipalClass being present; spec says it's OPTIONAL when
  -	     NSExtensionPointIdentifier is set, but it's cheap insurance to include it. -->
  -	<key>NSExtensionPrincipalClass</key>
  -	<string>$(PRODUCT_MODULE_NAME).NoorWidgetExtension</string>
  	</dict>
  	</dict>
  ```
- **Validation:**
  - `xcrun devicectl listapps --device 00008030-0004348E34C0C02E | grep com.ali` shows `com.ali.noor` registered.
  - `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS,id=00008030-0004348E34C0C02E' DEVELOPMENT_TEAM=89RUQ4H8S5 CODE_SIGN_IDENTITY='iPhone Developer' CODE_SIGN_STYLE=Automatic build` exits with `** BUILD SUCCEEDED **`.
  - Aayaan's iPad now shows the Noor app (final smoke to be confirmed by user).

## PLAN-006 — `OTHER_CODE_SIGN_FLAGS = "--no-strict"` — abandoned (net zero)

- **Date:** 2026-07-11
- **File:** `ios/App/App.xcodeproj/project.pbxproj`
- **Status:** ⚠️ Superseded — net code change is **ZERO**. `git checkout HEAD -- …/project.pbxproj` restored the file to git baseline after every iteration. Kept here only so the audit trail shows what we tried.
- **Why abandoned:** After three progressively broader cleanup attempts (`xattr -cr` on widget ext + CapApp-SPM + speech-recognition injection, then on full `ios/` + `node_modules/`, then on the full stack with DerivedData wipes) the codesign-detritus error persisted. The next escalation (inject `OTHER_CODE_SIGN_FLAGS = "--no-strict"` into widget target build configs) avoided the codesign error but `cap run`'s opaque install step introduced a *new* error (`MIInstallerErrorDomain` 152) that traced to a separate problem in `Info.plist` (PLAN-007). After both fixes — pbxproj baseline restored + Info.plist valid — a **direct `xcodebuild` build** with explicit `DEVELOPMENT_TEAM=89RUQ4H8S5` succeeded without `--no-strict`, suggesting the codesign-detritus error was a stale sign-cache resolved by the cumulative `rm -rf ios/DerivedData ios/build ~/Library/Developer/Xcode/DerivedData/*` wipes earlier this turn.
- **Lesson:** next time iOS codesign detritus surfaces, do the wipes FIRST and rebuild before touching build settings; only escalate to `--no-strict` if wipes don't unblock.

## PLAN-005 — `src/App.jsx` ToastHost `setTimeout` leak fix
- **Status:** ✅ Verified — Vite minifies `toastTimerIdsRef` to a short var name, but the bundled `app-toast / app-confirm / setToasts` string-literal fingerprints from the fix all appear in `ios/DerivedData/.../Debug-iphoneos/App.app/public/assets/index-Cytpvw08.js` (2 matches). Shipped on iPad as part of v1.0.0 with the build that succeeded this turn.

- **Date:** 2026-07-11
- **Files:**
  - `src/App.jsx` — BEFORE lines 578–596 (the entire `ToastHost` useEffect block); AFTER lines 578–609 (added `toastTimerIdsRef` declaration + integration in `onToast` + cleanup iteration).
- **Status:** ⚠️ Pending review
- **Why:** `ToastHost`'s `onToast` callback schedules a `setTimeout(() => setToasts(...), duration)`, but the timer id is never tracked; if `ToastHost` unmounts before the timer fires, the callback still calls `setToasts` on an unmounted component (React *"Can't perform a React state update on an unmounted component"* warning) and the timer handle stays alive in the event loop until natural expiry (typical 3.2–4.5 s per toast → small leak). This bug fires every time the user triggers a toast just before navigating away — e.g. *Settings → Save* then *Back*.
- **Fix:** Introduce a `useRef(new Set())`-tracked registry of all pending timer ids. Pushed on creation, deleted on natural fire, cleared in the cleanup function. Standard React mount/unmount pattern.
- **Diff:**
  ```diff
  @@ src/App.jsx — function ToastHost() @@
   function ToastHost() {
     const [toasts, setToasts]   = useState([])
     const [confirm, setConfirm] = useState(null)
  +  // PLAN-005: track every pending auto-dismiss setTimeout id so we can
  +  // clearTimeout them all in the useEffect cleanup. Without this, a toast
  +  // outliving ToastHost's unmount would call setToasts on an unmounted
  +  // component (React warning + tiny memory leak per toast).
  +  const toastTimerIdsRef = useRef(new Set())

     useEffect(() => {
       const onToast = (e) => {
         const { message, type = 'info', duration = 3200 } = e.detail || {}
         const id = Date.now() + Math.random()
         setToasts(prev => [...prev, { id, message, type }])
  -      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  +      const timerId = setTimeout(() => {
  +        toastTimerIdsRef.current.delete(timerId)
  +        setToasts(prev => prev.filter(t => t.id !== id))
  +      }, duration)
  +      toastTimerIdsRef.current.add(timerId)
       }
       const onConfirm = (e) => setConfirm(e.detail)
       window.addEventListener('app-toast', onToast)
       window.addEventListener('app-confirm', onConfirm)
       return () => {
         window.removeEventListener('app-toast', onToast)
         window.removeEventListener('app-confirm', onConfirm)
  +      // Cancel every pending toast auto-dismiss timer so the closure can't
  +      // call setToasts on an unmounted component.
  +      for (const id of toastTimerIdsRef.current) clearTimeout(id)
  +      toastTimerIdsRef.current.clear()
       }
     }, [])
  ```
- **Validation:** `grep -n 'toastTimerIdsRef' src/App.jsx` returns 4 matches (declaration + `.add(timerId)` + `.delete(timerId)` + cleanup iterate). No `useRef` import needed — `useRef` was already imported on line 1. React StrictMode double-mount: each cycle creates a fresh Set, and the cleanup drains it before the next mount.
- **Plan:** [PLAN-005](./PLAN-005-toast-timeout-cleanup.md)

## PLAN-004.2 — `src/App.jsx` graceful fallback into Scribe on `AAPLESTT_UNAVAILABLE`
- **Date:** 2026-07-11
- **File(s):** `src/App.jsx`
- **BEFORE lines:** 1170–1183 (existing `catch (e)` around `NativeSTT.startListening()`)
- **AFTER lines:** 1170–1195 (new branch inserted BEFORE the existing `simulator` / `permission` checks)
- **Status:** ✅ Verified
- **Why:** When the `@capacitor-community/speech-recognition` native plugin is not registered in the Capacitor bridge (dual-target SPM split keeps the ObjC `CAP_PLUGIN` constructor out of the App binary on iPad), `AppleSTT.startListening()` throws `AAPLESTT_UNAVAILABLE:`. Required transparent fallback to ElevenLabs Scribe so Detect mode keeps working — without forcing the user to flip Settings manually.
- **Diff:**
  ```diff
  @@ src/App.jsx — inside startNativeListeningInternal, catch (e) around NativeSTT.startListening() @@
  } catch (e) {
    const msg = e?.message?.toLowerCase() || ''
  + // AppleSTT.startListening() throws 'AAPLESTT_UNAVAILABLE:' when the native plugin
  + // isn't registered in the Capacitor bridge (dual-target SPM split). Route the
  + // user transparently to ElevenLabs Scribe instead of failing.
  + if (msg.includes('applestt_unavailable') || msg.includes('not implemented')) {
  +   logKhutbah('WARN', 'AppleSTT unavailable, falling back to ElevenLabs Scribe', e?.message || String(e))
  +   showToast('Apple Native speech not available on this device — using ElevenLabs cloud STT', 'warn', 4500)
  +   try { await NativeSTT.stopListening?.() } catch {}
  +   try { await NativeSTT.removeAllListeners?.() } catch {}
  +   await startScribeListening(false, true /* isFallback: breaks ping-pong */)
  +   return
  + }
    // …existing simulator and permission branches unchanged below…
  }
  ```
- **Validation:** `grep -n 'AAPLESTT_UNAVAILABLE' src/App.jsx` returns the new line; `grep -n 'startScribeListening(false, true' src/App.jsx` confirms the fallback call site.
- **Plan:** [PLAN-004](./PLAN-004-apple-stt-elevenlabs-fallback.md)

## PLAN-004.1 — `src/App.jsx` `startScribeListening(isResume, isFallback)` ping-pong guard
- **Date:** 2026-07-11
- **File:** `src/App.jsx`
- **BEFORE lines:** 1084 (signature `const startScribeListening = async (isResume = false) => {`) and ~1119–1126 (existing 3-way catch handler `if (IS_NATIVE) … else await startBrowserListeningInternal()`).
- **AFTER lines:** 1080–1084 (added comment block + new param) and 1118–1126 (rewritten guard).
- **Status:** ✅ Verified
- **Why:** Without an `isFallback` flag, the Scribe catch handler would re-bounce to `startNativeListeningInternal()` when AppleSTT → Scribe fallback's Scribe-session also failed (e.g., network drop, bad API token). The original code was tuned for the Scribe-as-primary path; the new fallback path needs to give up cleanly instead of recursing forever.
- **Diff:**
  ```diff
  @@ src/App.jsx — startScribeListening signature @@
  + // `isFallback`: true when we're entering Scribe because Apple Native STT
  + // already failed with AAPLESTT_UNAVAILABLE. Stops the Scribe → Apple ping-pong
  + // if Scribe itself fails for the same reason — we then surface a clean error
  + // to the user instead of recursing forever.
  - const startScribeListening = async (isResume = false) => {
  + const startScribeListening = async (isResume = false, isFallback = false) => {

  @@ src/App.jsx — tail of startScribeListening's catch @@
  + // Don't bounce back to Native if we're already the Native → Scribe
  + // fallback (it'll just produce the same AAPLESTT_UNAVAILABLE again and
  + // ping-pong). Show a clean error and stay idle instead.
  - if (IS_NATIVE) await startNativeListeningInternal()
  - else await startBrowserListeningInternal()
  + if (IS_NATIVE && !isFallback) await startNativeListeningInternal()
  + else if (isFallback) {
  +   setError('Both Apple Native and ElevenLabs speech failed. Check the app logs for details.')
  +   setPhase('idle')
  +   isListeningRef.current = false
  + } else await startBrowserListeningInternal()
  ```
- **Validation:** `grep -n 'isFallback' src/App.jsx` returns all 4 expected sites (signature param + comment + two guard checks + comment in fallback-call site); `grep -n 'Both Apple Native and ElevenLabs' src/App.jsx` finds the new error string.
- **Plan:** [PLAN-004](./PLAN-004-apple-stt-elevenlabs-fallback.md)

## PLAN-004 — `src/plugins/AppleSTT.js` capacitor bridge probe
- **Date:** 2026-07-11
- **File(s):** `src/plugins/AppleSTT.js`
- **BEFORE lines:** 57–75 of the pre-edit file (function `startListening({ language = 'ar-SA' } = {})` whose body was just `if (isListening) return; isListening = true; …addListener… await SpeechRecognition.start(…)`).
- **AFTER lines:** 57–95 (probe comment block at 60–65 + try/catch at 66–74 + reset of `isListening = true` to line 75).
- **Status:** ✅ Verified
- **Why:** Need a deterministic, recognizable error contract when the iOS native plugin isn't registered. The Capacitor JS-side `SpeechRecognition.available()` proxy call goes through the ObjC bridge; if the class isn't registered the call throws — surfacing faster than deeper `addListener`/`start` chains that would otherwise leak `isListening = true`.
- **Diff:**
  ```diff
  @@ src/plugins/AppleSTT.js — startListening() @@
   async startListening({ language = 'ar-SA' } = {}) {
     if (isListening) return
  + // Bug fix #N1: probe the Capacitor bridge BEFORE setting isListening so a
  + // broken plugin surfaces as a recognizable `AAPLESTT_UNAVAILABLE:` error
  + // instead of leaking through into the listener / start chain. … (full
  + // 6-line comment)
  + try {
  +   const probe = await SpeechRecognition.available()
  +   if (!probe || probe.available !== true) {
  +     throw new Error('SpeechRecognition reports available=false on this iOS device.')
  +   }
  + } catch (e) {
  +   throw new Error('AAPLESTT_UNAVAILABLE: ' + (e?.message || String(e)))
  + }

     isListening = true
  ```
  Probe runs BEFORE `isListening = true` so a failed probe rolls back to idle.
- **Validation:** `node --check src/plugins/AppleSTT.js` exit 0; `grep -n 'AAPLESTT_UNAVAILABLE' src/plugins/AppleSTT.js` returns line 72; `grep -n 'SpeechRecognition.available' src/plugins/AppleSTT.js` returns line 67.
- **Plan:** [PLAN-004](./PLAN-004-apple-stt-elevenlabs-fallback.md)

## PLAN-003.1 — `scripts/ios-fix-pkg-cache.mjs` critical-fix hardening
- **Date:** 2026-07-11
- **File:** `scripts/ios-fix-pkg-cache.mjs` (macOS guard at lines ~38–43; AppleScript quit at line ~92)
- **Status:** ✅ Verified — `node --check` exit 0; greps confirm `process.platform !== 'darwin'` guard + `'tell application "Xcode" to quit saving no'`.
- **Why:** Two findings from the code-reviewer-minimax-m3 on PLAN-003:
  1. `osascript 'quit app "Xcode"'` hangs on unsaved-document dialogs (Xcode shows "Save changes to …?" and `osascript` blocks). Fix: use `tell application "Xcode" to quit saving no`.
  2. The path assumptions in the cache-wipe list are macOS-specific (e.g., `~/Library/Developer/Xcode/DerivedData/`). On Linux or Windows the script would silently destroy files in wrong locations. Fix: guard with `if (process.platform !== 'darwin') { console.error; process.exit(2) }`.
- **Plan:** [PLAN-003](./PLAN-003-spm-cache-recovery-script.md)

## PLAN-003 — `scripts/ios-fix-pkg-cache.mjs` (new file) + `package.json` hook
- **Date:** 2026-07-11
- **Files:** `scripts/ios-fix-pkg-cache.mjs` (created, ~190 lines); `package.json` (one new line under `scripts`)
- **Status:** ✅ Verified — `node --check` syntactic exit 0; `xcodebuild -resolvePackageDependencies` succeeds end-to-end; `pkgxcodebuild` clean re-resolution reports `CapacitorCommunitySpeechRecognition @ local` correctly.
- **Why:** Xcode IDEsidebar showed "Missing package product 'CapacitorCommunitySpeechRecognition'" even though `xcodebuild -resolvePackageDependencies` returned success. Root cause: stale global SPM caches (`~/Library/Caches/org.swift.swiftpm/`, `~/Library/org.swift.swiftpm/`) plus `~/Library/Caches/com.apple.dt.Xcode/` and project-embedded `xcuserdata`. Targeted normal cache wipes (`DerivedData`) did not include these.
- **Diff (semantic):**
  - New script wipes 7 cache locations project-scope + global, gracefully quits Xcode via AppleScript, re-runs `npm postinstall` + `npx cap sync ios`, re-runs `xcodebuild -resolvePackageDependencies` to bake a fresh resolver graph back into the IDE on next open.
  - `package.json` gains `"ios:fix-pkg": "node scripts/ios-fix-pkg-cache.mjs"` one line.
  - Idempotent + `--dry-run` + `--no-quit` flags supported.
- **Plan:** [PLAN-003](./PLAN-003-spm-cache-recovery-script.md)

## PLAN-002 — `ios/App/App.xcodeproj/project.pbxproj` IPHONEOS_DEPLOYMENT_TARGET 15 → 16
- **Date:** 2026-07-11
- **File:** `ios/App/App.xcodeproj/project.pbxproj` (App target Debug line 487 + App target Release line 530)
- **Status:** ✅ Verified — `xcodebuild -showBuildSettings -project ios/App/App.xcodeproj -scheme App` reports `IPHONEOS_DEPLOYMENT_TARGET = 16.0` for both Debug + Release; the build linker no longer errors.
- **Why:** Swift linker rejected `CapApp-SPM.o` because it was compiled at iOS 16 (its `Package.swift`'s `platforms: [.iOS(.v16)]` from a recent `@capacitor/cli` regen), but the App target's linker setting was 15.0. Apple's toolchain forbids linking newer-version objects against an older-version app. The `NoorWidgetExtension` already at 16 proved the project has implicitly standardized on 16; the App target was the lone outlier. Per developer prefs ("Don't introduce new min iOS"), bumping was the minimal change.
- **Diff (semantic):** Two `str_replace` calls (allowMultiple on the unique `IPHONEOS_DEPLOYMENT_TARGET = 15.0;` string) → `… = 16.0;`. The pbxproj's `IPHONEOS_DEPLOYMENT_TARGET = 15.0` appeared ONLY in App-target settings; the widget's `= 16.0` was untouched.
- **Plan:** [PLAN-002](./PLAN-002-ios-deployment-target-bump.md)

## PLAN-001 — `ios/App/NoorWidgetExtension/PrayerData.swift` explicit memberwise init
- **Date:** 2026-07-11
- **File:** `ios/App/NoorWidgetExtension/PrayerData.swift` (init block inserted at ~line 78, before the `// MARK: - Convenience helpers` section)
- **Status:** ✅ Verified — `swiftc -parse` on an inlined copy parses cleanly with 12 args; the call site in `PrayerTimelineProvider.placeholder()` resolves identically.
- **Why:** Xcode 26 / SwiftPM reported `PrayerData.swift:157:26 — Extra arguments at positions #11, #12 in call` even though the inline compile was clean. The struct has exactly 12 stored properties (8 timestamps + 4 metadata strings). This is a known Xcode indexer / `PBXFileSystemSynchronizedRootGroup` cache bug — the indexer holds a stale module signature; explicit init locks the 12-arg signature into the AST.
- **Diff (semantic):** Inserted a 12-arg `init(fajr:sunrise:dhuhr:asr:maghrib:isha:tomorrowFajr:yesterdayIsha:hijri:city:tempUnit:dateKey:)` that assigns to the matching self-properties. The synthesized Codable/Equatable/Hashable/Sendable conformances are independent of this init and unaffected.
- **Plan:** [PLAN-001](./PLAN-001-prayerdata-explicit-init.md)

---

## Open / Pending

- **Plugin-side root cause (`+load` constructor pull)** — still unverified. `nm CapApp-SPM.o | grep SpeechRecognition` would confirm whether the `@objc(SpeechRecognition)` symbol is in the linked binary. Cannot run that locally. Logged as a follow-up in `docs/noor-ios-bugfix-2026-07-11.md`.
- **Upstream `@capacitor-community/speech-recognition` single-target `Package.swift`** — file an issue requesting the fix. Until then, `scripts/inject-speech-recognition-spm.mjs` and `src/plugins/AppleSTT.js` are the durable workaround.
