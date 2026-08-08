# Noor iOS — Complete Build Specification & Handoff
_Created 7 July 2026 by Claude Fable 5, derived from the shipped Android app (Noor v8.23.0, versionCode 90) at `C:\Khutbah` / GitHub `aliyaqoob7575160/Khutbah` branch `aliandroidv2`._

**Audience:** the AI (and human) building the iOS version of Noor from scratch.
**Goal:** an iOS app with the same name, features, design, backend, and databases as the Android app, distributed to Ali's family via TestFlight.

---

## ⚡ LIVE PROGRESS — read this before anything else

_Updated 2026-07-13 by Buffy (Freebuff). Developer: **Aayaan** (MacBook Pro). Previous sessions: Claude Fable 5 (2026-07-07), MiniMax/Buffy (2026-07-11), MiniMax/Buffy (2026-07-12)._

**State: Phases 1–4 code-complete ✅ · First iPad build SUCCEEDED ✅ · 19 plans shipped (PLAN-001→PLAN-017) + PLAN-022 + PLAN-023 + PLAN-024 + PLAN-024.1 ✅ · Vite build clean ✅ · All 7,892 test scenarios green ✅ · Next-steps roadmap v2 (PLAN-018) · Widget extension target is the only remaining blocker to ship.**

Done so far (all on this branch, all verified):
1. Full app source ported from Android v8.23.0 (every platform-neutral file copied verbatim — engine, utils, data, UI, worker). Vite build clean.
2. **All 7,892 test scenarios green** on this branch: tracker 64/64, stream 180/180, bulk 2348/2348, mega 5300/5300.
3. iOS-safe stubs for the Android-native plugins (`src/plugins/SherpaSTT.ts` — safe no-op). `src/plugins/NoorWidget.ts` is a **real** Capacitor plugin on iOS (calls `registerPlugin('NoorWidget')`, native side `NoorWidget.swift` writes to App Group UserDefaults + calls `WidgetCenter.shared.reloadAllTimelines()`); the web fallback is a no-op. However, the widget **extension target is not in the Xcode project** — see PLAN-018 item 1.3 for the fix. Battery/exact-alarm banners never show on iOS.
4. Native shell generated (`ios/` — Capacitor 8 uses **SwiftPM, no CocoaPods needed**). Info.plist already has mic + location + motion permission strings and `UIBackgroundModes: audio`.
5. Wake lock routed through the native KeepAwake plugin on iOS (App.jsx + QuranMode.jsx).
6. Settings hides the "Local" speech engine on iOS; stale `local` settings coerce to ElevenLabs.
7. App icon (1024×1024, same mihrab-lamp motif as Android) generated into the Xcode asset catalog via `node scripts/gen-ios-icon.cjs`.
8. **Live ElevenLabs pipeline VERIFIED end-to-end from this repo** (`node scripts/test-elevenlabs.mjs`): token minted from the deployed `/api/stt/token` with this build's `.env.local`, WebSocket connected, 20 real recitation clips streamed as 16kHz PCM, transcripts received. Kill switch (`/api/status`) also verified live. The only untested links left are iPhone mic capture + WKWebView — everything server-side works from this codebase.
9. Native pre-fixes for the two remaining device risks: `AppDelegate.swift` configures AVAudioSession (`.playAndRecord` + `.mixWithOthers`) so mic capture survives screen lock; Info.plist forces a light status bar. Launch splash regenerated dark-green with the lamp motif (`node scripts/gen-ios-splash.cjs`) — no white flash.
10. CI on GitHub Actions (`.github/workflows/tests.yml`): every push to this branch must build clean and keep all four tracker suites green.

### 2026-07-11 session — 17 plans shipped (PLAN-001 → PLAN-017)

The 2026-07-11 session (MiniMax/Buffy) built the app on the Mac, installed it on Aayaan's iPad (UDID `00008030-0004348E34C0C02E`), and shipped 17 formal plans covering native build fixes, runtime fallbacks, and JS hardening:

- **PLAN-001** — `PrayerData.swift` explicit memberwise init (Xcode indexer cache bypass)
- **PLAN-002** — `IPHONEOS_DEPLOYMENT_TARGET` 15 → 16 (linker alignment with `CapApp-SPM`)
- **PLAN-003 / 003.1** — `scripts/ios-fix-pkg-cache.mjs` SPM cache recovery script + macOS guard
- **PLAN-004 / 004.1 / 004.2** — AppleSTT bridge probe (`AAPLESTT_UNAVAILABLE`) + ElevenLabs Scribe graceful fallback + ping-pong guard
- **PLAN-005** — ToastHost `setTimeout` leak fix (unmount safety)
- **PLAN-006** — Codesign detritus cleanup (`xattr -cr` + DerivedData wipes)
- **PLAN-007 / 007.1** — Widget extension `NSExtensionPrincipalClass` removal (install rejection fix)
- **PLAN-008** — QuranMode `setTimeout` retry-loop unmount leaks (superseded by PLAN-014's `activeTimersRef` Set)
- **PLAN-009** — `scribeSTT.js` bare `fetch()` → `apiFetch()` migration
- **PLAN-010** — `circle.js` bare `fetch()` → `apiFetch()` migration
- **PLAN-011** — `logger.js` bare `fetch()` → `apiFetch()` migration
- **PLAN-012** — `streak.js` `syncToday()` bare `fetch()` → `apiFetch()` migration
- **PLAN-013 / 013.1** — Kill-switch bare `fetch()` → `apiFetch()` + module-scope dedup (StrictMode-safe)
- **PLAN-014** — QuranMode `calibrationTimer` refactor → `activeTimers useRef+Set` + unmount safety net
- **PLAN-015** — TODO/FIXME/HACK/XXX audit (0 findings, closed as no-op)
- **PLAN-016** — QuranMode IndoPak fetch `useEffect` `cancelled` flag for unmount safety
- **PLAN-017** — HomePanel `fetchCircle()` `useEffect` `cancelled` flag for unmount safety

Full audit trail: [`docs/CHANGES_LOG.md`](./docs/CHANGES_LOG.md). Narrative spec: [`docs/noor-ios-bugfix-2026-07-11.md`](./docs/noor-ios-bugfix-2026-07-11.md). Session-restore prompt: [`docs/noor-ios-restart-prompt.md`](./docs/noor-ios-restart-prompt.md). Workflow rules: [`docs/WORKFLOW.md`](./docs/WORKFLOW.md).

### 2026-07-12 session — PLAN-022 (JS bug-fix bundle, 11 bugs fixed) + PLAN-023 (iOS native fixes)

**Two plan docs from this session:**
- [`docs/PLAN-022-bugfix-audit.md`](./docs/PLAN-022-bugfix-audit.md) — 11 JS bugs fixed (1 critical streak crash, 1 high Android 64-cap overflow, 3 medium listener/closure bugs, 4 low dead-code/minor UI bugs, 2 mid grace-period + event-bus).
- [`docs/PLAN-023-ios-native-fixes.md`](./docs/PLAN-023-ios-native-fixes.md) — 3 iOS native fixes: removed `armv7` (App Store blocker), removed stale `location` from `UIBackgroundModes`, bumped `IPHONEOS_DEPLOYMENT_TARGET` 15.0→16.0 in all 4 pbxproj spots, removed `-D COCOAPODS` stale flag, ignored `Khutbah/` and `Khutbah*.zip` in `.gitignore`.

**What got fixed in PLAN-022:**
- `src/utils/streak.js` — removed `dayBeforeYesterdayStr()` call (the helper was never defined) + FIFO cap `SHOWN_KEY` at `SHOWN_MAX = 60`
- `src/utils/circle.js` — `displayStreakOf()` 3-day → 1-day grace (matches the comment + local streak.js) + dispatches `app-circle-changed` event
- `src/utils/notify.js` — `DAYS_AHEAD` 7 → 6 on Android (8 days → 6 days rolling; new ceiling 60 < 64-cap)
- `src/QuranMode.jsx` — `dbgRef` pattern in `handleResult` (stale-closure fix), defensive `removeAllListeners` before surah re-init, removed dead `surahMatchCount` ref (8 writes, 0 reads)
- `src/HomePanel.jsx` — event-bus re-fetch on circle change
- `src/App.jsx` — removed empty `<h2>` placeholder
- `src/PrayerLocationSettings.jsx` — removed dead `NoorWidget` import

**What got fixed in PLAN-023:**
- `ios/App/App/Info.plist` — replaced `armv7` with `arm64` in `UIRequiredDeviceCapabilities`; removed `location` from `UIBackgroundModes`
- `ios/App/App.xcodeproj/project.pbxproj` — `IPHONEOS_DEPLOYMENT_TARGET = 16.0` × 4; removed `-D COCOAPODS` flag
- `.gitignore` — added `Khutbah/`, `Khutbah*.zip`

**Validation:**
- `npx vite build` clean (870ms, exit 0)
- `npm run test:tracker` 64/64 ✓
- `npm run test:stream` 180/180 ✓
- `npm run test:bulk` 2,348/2,348 ✓
- `npm run test:mega` 5,300/5,300 ✓
- `grep -c '= 16.0'` on `project.pbxproj` = 4
- `grep -c 'armv7'` on `Info.plist` = 0
- `grep -c 'dayBeforeYesterdayStr'` on `src/utils/streak.js` = 1 (the explanatory comment, no live refs)
- `grep -c 'surahMatchCount'` on `src/` = 0

**Remaining blockers** (from PLAN-018 v2, unchanged):
- 🔴 `NoorWidgetExtension` target not in `project.pbxproj`. Swift code exists but doesn't compile or ship. → PLAN-018 item 1.3.
- 🔴 No crash reporting → PLAN-018 item 2.1.

See [`docs/CHANGES_LOG.md`](./docs/CHANGES_LOG.md) for the append-only audit trail of every plan.

### 2026-07-13 session — PLAN-024 (full-codebase JS bug-fix bundle, 9 fixes) + PLAN-024.1 (deferred-bug follow-up pass, 5 actions)

A top-to-bottom JS bug audit found **15 bugs** (1 critical, 2 high, 5 medium, 7 low) — across PLAN-022, PLAN-024, and PLAN-024.1, all 15 are now addressed: 9 fixes in PLAN-024 + 5 actions in PLAN-024.1 + 1 pre-fixed in PLAN-022 (duplicate dead `surahMatchCount` ref). Changes are concentrated in **`src/QuranMode.jsx`** and **`src/App.jsx`** with smaller touchpoints in **`src/HomePanel.jsx`**, **`src/FamilySettings.jsx`**, **`src/utils/streak.js`**, **`src/utils/notify.js`**, and **`ios/App/App/AppDelegate.swift`**. PLAN-024.1 is a documentation/comment-only follow-up. No native iOS or scheme changes.

**What got fixed in PLAN-024:**
- 🔴 **Bug #1 — `src/QuranMode.jsx` TDZ ReferenceError**: `useRef(dbg)` was declared on a line **above** `const dbg = useCallback(...)`. The function body ran top-down, evaluating `dbg` from the Temporal Dead Zone on every render → thrown `ReferenceError: cannot access 'dbg' before initialization`. The component never mounted; `<Suspense>` swallowed the rejection; the Quran tab sat on `📖 Loading Quran…` forever. **Fix:** swapped declaration order so `dbg` precedes `dbgRef`. The iPad Quran tab will now render Read / Browse / Goals / Mushaf / Detect for the first time.
- **Bug #2 — `src/FamilySettings.jsx`**: added `cancelled` flag + return cleanup so a slow response from a stale `fetchCircle()` cannot clobber the post-leave/rejoin state.
- **Bug #4 — `src/QuranMode.jsx`** surah-prompt re-init `.then`: guarded SherpaSTT listener registration with `unmountingRef.current` so a late initialize() resolution can't attach to a torn-down component.
- **Bug #5 — `src/QuranMode.jsx` getAr**: added `warnedIndopakRef = useRef(new Set())` so console.warn fires once per missing `(s:a)` key during a partial indopak download (not on every render).
- **Bug #8 — `src/App.jsx` sessionSummaryRef**: now `.slice(-3000)` after each append so translation pin growth is bounded.
- **Bug #9 — `src/HomePanel.jsx`**: hadith-of-day index now uses `Math.floor(Date.now() / 86400000)` so the day rotates at **local** midnight instead of UTC midnight drift.
- **Bug #14 — `src/App.jsx`**: `setError('')` at the start of `startScribeListening` and `startNativeListeningInternal` so a stale error toast clears when a new session begins.
- **Bug #3 (intentionally deferred)**: HomePanel mount-time fetch keeps deps `[]` — `[circle]` would re-fire every render because `getCachedCircle()` does a fresh `JSON.parse` and returns a new object each call. The event-bus listener handles subsequent updates correctly.
- **Bug #6 (deferred as documented)**: a defensive `removeAllListeners?.()` is called before surah re-init in `handleResult`, with a comment. Mitigated further by Bug #4's `unmountingRef`.

**What got documented in PLAN-024.1:**
- **Bug #11 — `src/utils/streak.js`**: `_verseIndexCache` swapped from `WeakMap` to `Map` (the QuranStore corpus is module-scope immutable; WeakMap's GC-tracking was pure overhead).
- **Bug #10 — `src/utils/notify.js`**: brief comment explaining why `getPrayerTimes` is deliberately not memoised in `refreshPrayerReminders` (not on a hot path; DAYS_AHEAD = 6 days × 1 call each ≈ 60ms worst case).
- **Bug #12 — `src/QuranMode.jsx` DHIKR_FILLER**: comment explaining the false-positive trade-off if the cue list were expanded (e.g., `اهدنا` is Quran 1:6 — adding single dua words would regress detection in Quran recitation; verified example included with a fence-post note).
- **Bug #13 — `ios/App/App/AppDelegate.swift` AVAudioSession**: comment explaining the `.playAndRecord + .mixWithOthers + .allowBluetooth + .defaultToSpeaker` option trade-offs (defaultToSpeaker doesn't apply on iPad; mixWithOthers lets user keep a nasheed podcast playing while mic-capturing).
- **Bug #15 (noted, no code change)**: `autoStartedRef` reset was already correct — the useEffect resets `current = false` whenever `quranView !== 'detect'`, so re-entering Detect arms it again.

**Validation (both PLAN-024 + PLAN-024.1):**
- `npx vite build` clean (~700ms, exit 0)
- `npm run test:tracker` 64/64 ✓
- `npm run test:stream` 180/180 ✓
- `npm run test:bulk` 2,348/2,348 ✓
- `npm run test:mega` 5,300/5,300 ✓
- Code-reviewer-minimax-m3: **APPROVED** after one revision round (caught an inaccurate Quran citation in Bug #12's initial comment — corrected to cite Al-Fatiha 1:6 with a verification fence-post note).

**Remaining blockers** (unchanged):
- 🔴 `NoorWidgetExtension` target not in `project.pbxproj`. Swift code exists but doesn't compile or ship. → PLAN-018 item 1.3.
- 🔴 No crash reporting → PLAN-018 item 2.1.

See [`docs/CHANGES_LOG.md`](./docs/CHANGES_LOG.md) for the full append-only audit trail.

### Aayaan: your exact next steps

The first iPad build already succeeded (PLAN-001→PLAN-007, 2026-07-11). The app is installed on the iPad. The next steps are now driven by **[PLAN-018](./docs/PLAN-018-ios-next-steps-roadmap.md)** — a 15-item prioritized roadmap:

**Session 1 — Info.plist + pbxproj fixes (on the Mac, no device needed, ~45 min):**
- Remove `armv7` from `UIRequiredDeviceCapabilities` (App Store blocker)
- Bump `IPHONEOS_DEPLOYMENT_TARGET` from 15.0 → 16.0 in all 4 pbxproj occurrences
- Remove `location` from `UIBackgroundModes` (app only does foreground one-shot geolocation)
- Remove stale `COCOAPODS` flag from `OTHER_SWIFT_FLAGS`

**Session 2 — Widget target + JS bug fixes (on the Mac, no device needed, ~75 min):**
- Add `NoorWidgetExtension` target in Xcode (the most involved task — 30-60 min of Xcode UI work)
- Fix the critical streak crash (`dayBeforeYesterdayStr()` undefined in `streak.js`)
- Fix the grace-period mismatch in `circle.js`
- Fix the SherpaSTT listener accumulation in `QuranMode.jsx`
- Verify the built `.app` contains `PlugIns/NoorWidgetExtension.appex`

**Session 3 — Crash reporting + device verification (on the Mac + iPad, ~2 hrs):**
- Integrate Sentry crash reporting (`@sentry/capacitor`)
- Build, install on iPad
- Verify background audio (mic survives screen lock) — the #1 device risk
- Verify local notifications actually fire on iOS
- Verify Qibla compass permission flow

**Session 4 — Polish + TestFlight (on the Mac, ~3 hrs):**
- Accessibility audit (VoiceOver labels, `prefers-reduced-motion`)
- iPad 600px wide layout verification
- Safe areas on notched iPhone (if an iPhone is available)
- Minor code cleanup (unused import, empty `<h2>`, stale closure)
- Archive + upload to TestFlight (invite family as external testers)

**Session 5 (future):**
- File upstream issue for `@capacitor-community/speech-recognition`
- Sherpa on-device STT (Phase 5, optional)
- Feature parity items from Android (Tasbih, verse cards, AI Assistant, etc.)

The original first-build checklist (kept for reference — most items already verified):
- [x] App boots → onboarding → Home renders (dark green theme, prayer bar)
- [x] Quran → Read: browse, resume position, bookmark
- [ ] Quran → Detect: recite Al-Fatiha → locks < 2s, karaoke highlight follows, rak'ah badge
- [ ] Khutbah tab: speak Arabic → live English translation cards appear
- [ ] Lock the screen mid-Detect → recitation tracking continues (background audio)
- [x] Settings → prayer location, fonts, engine picker shows ElevenLabs + Apple Native

### Known risks & open items (updated 2026-07-12 after PLAN-022 + PLAN-023)

**🔴 Critical — App Store blocker (still pending):**
1. **Widget extension not in Xcode project** — `NoorWidgetExtension` target is not registered in `project.pbxproj`. The Swift code exists but doesn't compile or ship. → PLAN-018 item 1.3. **The widget does NOT appear on the home screen. This is the last remaining App Store blocker.** (PLAN-022 + PLAN-023 cleared `armv7`, deployment target 15→16, `location` background mode, `COCOAPODS` flag, and the streak crash.)

**🔴 Critical — pre-TestFlight gap:**
- **No crash reporting** — zero Sentry/Crashlytics/Firebase. TestFlight crashes invisible. → PLAN-018 item 2.1 (next priority item after widget target).

**Device verification needed (PLAN-018 Tier 2):**
1. **Mic capture with screen locked** — `UIBackgroundModes=audio` is set + `AppDelegate.swift` configures AVAudioSession (`.playAndRecord` + `.mixWithOthers`), but WKWebView `getUserMedia` in background needs on-device confirmation. This is the #1 thing to test. (PLAN-018 item 2.2 → PLAN-027)
2. **Local notifications firing on iOS** — `notify.js` `DAYS_AHEAD` is 4 on iOS (64-cap fix), but reminders have never been verified to actually fire on device. (PLAN-018 item 2.3 → PLAN-028)
3. **Qibla compass permission flow** — `QiblaCompass.jsx` shows a "🧭 Enable compass" button when mount-time permission is rejected. Code-complete, not yet device-verified. (PLAN-018 item 2.4 → PLAN-029)
4. **Safe areas on notched iPhone** — `.bottom-nav` has `env(safe-area-inset-bottom)`; `.header` has `env(safe-area-inset-top)`. Needs a notched iPhone to verify (iPad has no notch). (PLAN-018 item 3.4 → PLAN-032)
5. **`@objc(SpeechRecognition)` symbol** — open investigation: is the ObjC constructor in the linked binary? Run `nm CapApp-SPM.o | grep SpeechRecognition`. (PLAN-018 item 5.1 → PLAN-035)

**Already verified ✅:**
- Browser smoke test PASSED on Windows (vite dev, mobile viewport): all tabs, zero console errors.
- iPad build succeeded (`xcodebuild … DEVELOPMENT_TEAM=89RUQ4H8S5` → `** BUILD SUCCEEDED **`).
- iPad install confirmed (`xcrun devicectl listapps` shows `com.ali.noor`).
- Widget extension Info.plist `NSExtensionPrincipalClass` removed (PLAN-007) — _historical: the extension target was subsequently lost from `project.pbxproj` (see PLAN-018 item 1.3 → PLAN-021 for re-adding it)._
- Status bar: light-content style set in Info.plist.
- Header version string: v1.0.0.

### How to continue this document
After every working milestone: update this section + the §16 version table, commit, push. Same discipline as NOOR_HANDOFF.md on Android — the next AI session depends on it.

---

## 0. READ THIS FIRST — Rules for the AI building this app

These rules exist because each one was learned the hard way on Android. Violating them produces bugs that took days to find.

1. **NEVER retype Arabic text or write regex character ranges with literal Arabic.** Editors byte-scramble RTL text invisibly. In v8.18.0 a literal Arabic regex range in `norm()` got corrupted and silently stripped ALL Arabic letters — the Quran tracker never locked and nothing looked wrong in the source. Any Arabic in code must be either (a) fetched verbatim from the existing repo files, or (b) written as `\uXXXX` escapes (ASCII-safe). All Quran text comes from `quran.json` at runtime — never hardcode verses.
2. **Do NOT rebuild the backend.** The Cloudflare Pages backend (`khutbah-v2`), both D1 databases, and the R2 bucket are shared with Android and already deployed. The iOS app is *just another client*. You need zero server changes (CORS already allows `capacitor://localhost`, which is what Capacitor iOS uses).
3. **Fetch the proven engine files from the repo — do not rewrite them.** `quranTracker.js`, `quranStore.js`, `scribeSTT.js`, `sttSanity.js`, `quranMatch.js`, `duaDetector.js` and `public/quran.json` passed 10,748 automated test scenarios. Rewriting them from a description will reintroduce solved bugs. Source of truth: branch `aliandroidv2` (NOT any other iOS-attempt branch — start the iOS project fresh, but reuse these battle-tested platform-independent JS files).
4. **Never commit `.env.local`** — it holds `VITE_APP_TOKEN`. Every build must have it present or the app gets 401 on all AI features. Get the token value from Ali.
5. **Run the test harnesses after touching anything in the tracker path:** `node scripts/test-tracker.mjs`, `node scripts/test-stream.mjs`, `node scripts/test-bulk.mjs`, `node scripts/test-mega.mjs`. They are plain Node scripts — they run on any OS, no device needed. All must stay green.
6. **The old offline matcher functions (`findVerse`/`trackVerse`/`handleResult` in QuranMode.jsx) are the Sherpa/offline fallback.** If you port QuranMode, keep the ElevenLabs path (`handleTrackerResult`) and offline path separate exactly as they are.
7. **When in doubt about a feature's behavior, read `NOOR_HANDOFF.md`** on branch `aliandroidv2` — it is the Android bible (586 lines) and this document's parent.
8. **Wrong-verse matches are unacceptable in Salah.** The tracker's proven invariant: it never confidently locks the wrong surah — it defers on genuinely ambiguous input (Basmala, muqatta'at families, verbatim-twin ayat) and lets the Haiku rescue resolve it. Any change that trades accuracy for speed is wrong.
9. **iOS builds require a Mac** (Xcode). Ali develops on Windows — see §14 for Mac/CI options. Plan every step so the Windows-side work (all the JS) is done first and the Mac is only needed for the final native shell.
10. **Keep this file updated** the same way NOOR_HANDOFF.md is maintained for Android: version table, progress log, known issues. Future sessions depend on it.

---

## 1. What Noor Is

**Noor** is an Islamic companion app for Ali's family. Two headline capabilities plus a daily-worship layer:

1. **Khutbah (live translation)** — during the Friday sermon, the phone listens to the Arabic khutbah and shows a live English translation feed, with AI analysis afterwards. Detects du'a segments and marks them in the feed.
2. **Quran (browse + recitation detection)** — full Quran reader (translation view + Mushaf view), and **Detect mode**: listen to someone reciting (e.g., the imam in salah or tarawih), identify the surah/ayah in real time, karaoke-highlight the words as they're recited, count rak'ahs, and offer per-rak'ah AI analysis afterwards.
3. **Daily worship layer** — prayer times + reminders, Qibla compass, daily reading streak with goals (daily verses, Friday Al-Kahf, nightly protective surahs), morning/evening adhkar counter, sunnah fasting reminders (with Ramadan mode), family streak circles, Hadith of the Day, Maktaba (hadith library + AI concept search), and per-device history.

Android is React 18 + Vite 5 + Capacitor 8. **The iOS app uses the identical stack** — that is the whole porting strategy (§3).

---

## 2. Identity & Naming

| Item | Value |
|---|---|
| App display name | **Noor** (if taken on the App Store, fall back to "Noor — Quran & Khutbah") |
| Bundle ID (iOS) | `com.ali.noor` (register in Ali's Apple Developer account; Android uses `com.ali.khutbah` but Apple IDs are independent — pick this once and NEVER change it) |
| Capacitor appId | same as bundle ID |
| Version scheme | Start at **1.0.0** (build 1). iOS versions are independent of Android's v8.x. Record the Android feature-parity point in the version table (§16). |
| Icon | Generate from `src/assets/noor-icon.svg` in the repo (mihrab lamp motif). Background `#0A3D24` deep green. iOS needs a single 1024×1024 PNG (no alpha) — Xcode generates the rest. |
| GitHub | `aliyaqoob7575160/Khutbah`, branch **`NoorAliIOS`** (fresh orphan branch — do not merge or copy from other branches; fetch individual proven files from `aliandroidv2` as listed in §5) |

---

## 3. Architecture Decision (already made — do not relitigate)

**Use Capacitor 8 + React 18 + Vite 5, exactly like Android.**

Why this and not SwiftUI:
- ~90% of Noor is platform-independent JavaScript (the tracker engine, the Quran store, the Scribe WebSocket client, all React UI, all the data modules). It is tested by 10k+ automated scenarios that run in Node.
- The design is a single dark-green CSS theme — it ports pixel-perfect for free.
- The backend contract, auth headers, quota headers, and STT protocol are already implemented in the shared JS.
- A native Swift rewrite would mean re-implementing (and re-testing) the alignment engine, `norm()`, the streaming state machine, dua detection, prayer calc, Hijri calc… with a high risk of the exact RTL/normalization bugs that took weeks to fix.

What is genuinely native on iOS (small, well-bounded — §12):
- Info.plist permissions (mic, location, notifications)
- Background audio mode (replaces Android's `RecordingService` foreground service)
- Haptics, local notifications, geolocation — all already abstracted by the same Capacitor plugins used on Android
- (Phase 5) on-device Sherpa STT (Sherpa-onnx iOS C API binding) and a WidgetKit prayer-clock widget — **WidgetKit prayer-clock code written but NOT shipped** (the `NoorWidgetExtension` target was never added to `project.pbxproj`; see PLAN-018 item 1.3). Sherpa iOS binding still pending.
---

## 4. Backend Contract (REUSE AS-IS — zero changes)

### 4.1 Base

- **API base URL:** `https://khutbah-v2.pages.dev` (Cloudflare Pages project `khutbah-v2`)
- **Auth:** every `/api/*` request sends header `x-app-token: <VITE_APP_TOKEN>` (from `.env.local` at build time). Missing/wrong → 401 `{"error":"unauthorized"}`.
- **Device identity:** every request also sends `x-device-id: <uuid>` — a `crypto.randomUUID()` stored in localStorage key `noor-device-id`. The server uses a truncated SHA-256 of it for daily quotas; never displayed, never logged client-side.
- **CORS:** server allowlist is `https://khutbah-v2.pages.dev, https://localhost, http://localhost, capacitor://localhost`. Capacitor iOS serves the app from `capacitor://localhost` → **already allowed, nothing to do**.
- **Kill switch:** `GET /api/status` (public, no token) reads D1 `app_config`; if `enabled=false` the app must show a full-screen "unavailable" message (with the custom message from the response) and block usage. Check on every launch; fail-open if the request errors.

### 4.2 Databases (shared with Android — do NOT create new ones)

| Binding | D1 name | database_id |
|---|---|---|
| `DB` | `khutbah-logs` | `1f69ce27-74a3-4921-990d-a6c8c63ed4cc` |
| `ANALYSIS_DB` | `noor-analysis-cache` | `0cdf352b-a1e1-4893-b580-25d87f190d76` |
| R2 `AUDIO_BUCKET` | `khutbah-audio` | — |

These are Cloudflare-side bindings; the iOS client never talks to them directly, only through `/api/*`. Listed here so you never provision duplicates.

### 4.3 Endpoints (all under `https://khutbah-v2.pages.dev/api/`)

| Endpoint | Method | Request → Response | Daily quota/device |
|---|---|---|---|
| `/api/stt/token` | GET | → `{token}` — single-use 15-min ElevenLabs Scribe realtime token | 200 |
| `/api/translate` | POST | `{text, ...}` → `{translation}` (Arabic→English via Claude; server strips model commentary) | 4000 (per segment) |
| `/api/analyze` | POST | `{text, type: 'khutbah'\|'quran'\|'quran-surah'\|'hadith', cacheKey}` → `{analysis, cached?}` — structured markdown with emoji section headers; Quran refs embedded as `[QURAN:S:A]` tokens the client renders as tappable links | 150 |
| `/api/identify` | POST | recent transcript → `{surah, ayah, confidence}` — Haiku rescue for the tracker (client must NOT trust `ayah`; see §8.4) | 300 |
| `/api/transcribe` | POST | audio blob → `{text}` (Cloudflare Whisper; web-only fallback path) | — |
| `/api/history` | GET/POST/PATCH/DELETE | khutbah/quran/maktaba history rows, always scoped `?device_id=<DEVICE_ID>` | — |
| `/api/streak` | GET/POST | streak_days + streak_state per device_id (email columns reserved for future) | — |
| `/api/circle` | GET/POST | family circles: create/join/leave/rename with `XXX-XXX` invite codes; GET returns members + streaks (never other members' device_ids) | — |
| `/api/related` | POST | `{concept}` → `{quran:[{s,a,why}], hadith:[{collection,snippet,why}]}` — client verifies locally before display (§11.4) | — |
| `/api/autocomplete` | POST | partial query → concept suggestions (Haiku) | — |
| `/api/log` | POST | debug log line → D1 (2KB cap). Only when Developer Options ON | — |
| `/api/status` | GET | → `{enabled, message?}` kill switch (public) | — |

Quota exceeded → HTTP 429 `{"error":"daily limit reached"}` — degrade gracefully (show a toast, keep local features working).

### 4.4 Client networking rules (port from `src/utils/net.js` + `apiHeaders()`)

```js
// Every fetch to /api/* must be built like this:
const apiHeaders = (extra = {}) => {
  const h = { ...extra, 'x-device-id': DEVICE_ID }
  if (APP_TOKEN) h['x-app-token'] = APP_TOKEN
  return h
}
```
Use `apiFetch()` (timeout + retry wrapper from `net.js`) rather than bare `fetch`.

---

## 5. Files to Fetch Verbatim from `aliandroidv2`

Fetch these raw from GitHub (`https://raw.githubusercontent.com/aliyaqoob7575160/Khutbah/aliandroidv2/<path>`) into the new project **unchanged**. They contain zero Android-specific code:

**Engine (never retype — Arabic + tested):**
- `src/utils/quranTracker.js` — the alignment engine (§8)
- `src/utils/quranStore.js` — corpus loader + THE `norm()` (§8.2)
- `src/utils/scribeSTT.js` — ElevenLabs realtime session (§7)
- `src/utils/sttSanity.js` — hallucination/wrong-script gates
- `src/utils/quranMatch.js` — khutbah Quran-quote splicing
- `src/utils/duaDetector.js` — du'a segment state machine
- `public/quran.json` — 6,236 verses `{s, a, sName, sAr, ar, en}` (Uthmani; ayah 1 of each surah has the Basmala embedded — see §10.6)

**Data modules:**
- `src/data/surahs.js` (114 names + ayah counts), `src/data/goals.js`, `src/data/adhkar.js`, `src/data/cities.js`, `src/data/synonyms.js`, `src/data/quotes.json`

**Utilities (platform-neutral):**
- `src/utils/streak.js`, `src/utils/prayer.js` (uses `adhan` npm lib + tabular Hijri), `src/utils/fasting.js`, `src/utils/device.js`, `src/utils/net.js`, `src/utils/toast.js`, `src/utils/backstack.js`, `src/utils/circle.js`, `src/utils/logger.js`, `src/utils/icons.jsx`, `src/utils/maktabaData.js`, `src/utils/haptics.js` (Capacitor Haptics — works on iOS as-is), `src/utils/notify.js` (Capacitor LocalNotifications — works on iOS; see §12.3)
- `src/workers/searchWorker.js`

**Test harnesses (run with plain `node`):**
- `scripts/test-tracker.mjs`, `scripts/test-stream.mjs`, `scripts/test-bulk.mjs`, `scripts/test-mega.mjs`, `scripts/test-elevenlabs.mjs`

**UI components** — you may fetch and adapt `App.jsx`, `App.css`, `QuranMode.jsx`, `ReferenceMode.jsx`, `HomePanel.jsx`, `AdhkarPanel.jsx`, `QiblaCompass.jsx`, `Onboarding.jsx`, `PrayerLocationSettings.jsx`, `FamilySettings.jsx`, `ErrorBoundary.jsx`, `main.jsx`. They are 95% platform-neutral React; the Android-specific bits to strip/replace are enumerated in §12. This is strongly recommended over re-writing the UI: it guarantees the "same design" requirement.

**Do NOT fetch:** anything under `android/`, `src/plugins/NoorWidget.ts` (Android widget), and only stub `src/plugins/SherpaSTT.ts` (see §12.5).

---

## 6. Secrets & Environment

| Where | Name | Purpose |
|---|---|---|
| `.env.local` (gitignored, per-machine) | `VITE_APP_TOKEN` | baked into the JS at build; sent as `x-app-token`. **Get the current value from Ali** — same one Android uses. |
| Cloudflare (already set — don't touch) | `APP_GATE_TOKEN` | server side of the same token |
| Cloudflare (already set) | `ANTHROPIC_API_KEY` | Claude for analyze/translate/identify/related |
| Cloudflare (already set) | `ELEVENLABS_API_KEY` | mints Scribe tokens server-side |

The iOS app bundle contains ONLY `VITE_APP_TOKEN` (abuse mitigation, not authentication — the server quotas in §4.3 are the real backstop). No other key ever ships in the app.

---

## 7. ElevenLabs Scribe v2 Realtime — exact protocol (used by Khutbah AND Quran Detect)

Implemented in `src/utils/scribeSTT.js` (fetch it; this section is for understanding/debugging).

1. `GET /api/stt/token` → `{token}` (single-use, ~15 min).
2. Open WebSocket to `wss://api.elevenlabs.io/v1/speech-to-text/realtime` with query params: `model_id=scribe_v2_realtime`, `token=<token>`, `language_code=ar`, `commit_strategy=vad`.
3. Mic capture: `getUserMedia({audio: {sampleRate: 16000, ...}})` → `AudioContext` → `ScriptProcessor(4096)` → **downsample from the ACTUAL context rate to 16 kHz** (`ctx.sampleRate` is 48 kHz on iOS — the code already handles this; the v8.16.x "clean transcripts" breakthrough was exactly this resample fix) → PCM16 → base64 → send `{message_type:'input_audio_chunk', audio_chunk:<b64>, sample_rate:16000}`.
4. Receive `{message_type:'partial_transcript'|'committed_transcript', text}`. Partials are **cumulative within a segment**; VAD commits end a segment and reset.
5. `commitWatchdogMs` — if partials flow but no VAD commit for N ms, force a manual commit. **Khutbah session: 8000. Detect session: 1500.** (Detect needs tight commits so the confirmed green highlight keeps up with the amber provisional one.)
6. Keyterms: **leave empty** for Detect (multi-word diacritic keyterms caused WS 1008 `invalid_request` rejections on Android).
7. Credit saver: RMS silence gating (SILENCE_RMS 0.008, SILENCE_GATE_MS 5000) — one commit on entering sustained silence, stop streaming, resume instantly on voice.
8. On any WS error, surface the server's error detail string to the UI/status log (unknown error types included) — silent drops cost days of debugging on Android.

**iOS specifics for this pipeline (§12.2):** mic permission string, background-audio mode, and verifying `getUserMedia` + `AudioContext` in WKWebView (supported since iOS 14.3+ in Capacitor). ScriptProcessor is deprecated but works in WKWebView; if it misbehaves, port to AudioWorklet — keep the identical downsample→PCM16 path.

**Fallbacks by platform:** Android falls back to on-device Sherpa Whisper; iOS Phase 1–4 has **no offline STT** (Settings should hide the "Local" engine option until Phase 5 §12.5 ships Sherpa-iOS).

---

## 8. The Quran Tracker (Detect engine) — how it works

You get this for free by fetching `quranTracker.js` + `quranStore.js`. Understand it before touching it:

### 8.1 Alignment model
- The corpus (6,236 verses) is flattened into one linear token array `WORDS[]`; a trigram index `Map<"w1 w2 w3", startPos[]>` (~65k entries) is built at load.
- Each transcript is aligned by tallying trigram-hit origins and scoring the longest consecutive chain, forward-biased near the current cursor. Locks when chain ≥ 3 (≈5 clean words, <2s typically). A trigram unique in the whole Quran pins a location and can lock from ~3 words.
- Advances a monotonic `cursorPos`; far jumps require their own ≥3 chain (far-origin penalty 160); cross-surah jump uses only the freshest ~12 words and ignores targets in the Basmala prefix of ayah 1 (identical across 113 surahs).
- `norm()` + `stripAl()` make matching diacritic- and definite-article-insensitive (Scribe drops "ال" often).
- Rolling-buffer feed: committed segments accumulate (cap 40 words) with partials appended on top, so 2–3-word ayat still have trigram context. Tail-window alignment (last 24 tokens) self-corrects drift.
- Client wiring lives in QuranMode's `handleTrackerResult` (`committedTextRef`), calibration via `beginTrackerCalibration` (4s, `TRACKER_CALIBRATION_MS`).
- Tunables at the top of `quranTracker.js`: `LOCK_CONF`, `NEAR_BACK`, `NEAR_FWD`, `WINDOW`.

### 8.2 `norm()` — THE hazard
`norm()` in `quranStore.js` is the single shared normalizer (corpus AND transcript). It is written entirely with `\u` escapes because a literal Arabic regex range was once byte-scrambled by an editor into a range spanning the letter block, silently normalizing everything to empty string. **Never rewrite it, never "clean it up", never let a formatter touch it.** There must be exactly ONE norm in the codebase — QuranMode imports it; do not create a local copy.

### 8.3 Rak'ah counting
Increment when **entering Al-Fatiha from a different surah** (`lastCountedSurahRef`) — robust to the jump landing mid-Fatiha (e.g., at 1:3) and to skipped opening ayat. Double haptic pulse on each new rak'ah. Live rak'ah badge on the current verse card; per-rak'ah groups drive the post-session "Analyze by rak'ah" picker.

### 8.4 Haiku rescue
When the tracker is cold (no lock 7s after start, `COLD_ESCALATE_MS`) or lost (3 committed chunks with no anchor, `LOST_MAX`), POST the recent transcript to `/api/identify` (rate-limited 8s, single-flight). Trust only `surah`; snap position locally via `tracker.lockToSurah(text, surah, ayahHint)`; an anchor-less soft seed is adopted only when `confidence ≥ 0.7`. Rescue failure = keep listening (fail soft).

### 8.5 Highlighting
Two-tone karaoke: committed words solid green (`.quran-highlight`), words heard only in a live partial amber (`.quran-highlight-pending`), settling to green on commit. Highlight is layout-neutral: `box-shadow: 0 0 0 3px var(--highlight-bg)` — **no padding/font-weight changes** (words must never change width). The Detect verse card renders `getAr(current)` (Basmala-embedded) so the tracker's word indices align — don't switch it to the stripped display text.

---

## 9. Design System (make iOS look identical)

### 9.1 Colors (App.css `:root` — copy exactly)
```css
--bg: #02120B;                     /* near-black green */
--surface: rgba(255,255,255,0.05);
--surface-solid: #082218;
--green-dark: #062b1a;
--green: #0a4f2d;
--green-light: #10804b;
--green-btn: rgba(16,128,75,0.8);
--highlight-color: #2dd4bf;        /* teal — active/highlight accent */
--highlight-bg: rgba(45,212,191,0.15);
--highlight-border: rgba(45,212,191,0.4);
--text: #f0fdf4;
--muted: #94a3b8;
--border: rgba(255,255,255,0.1);
--interim: rgba(255,255,255,0.5);
```
Body background adds two radial gradients (top-right green glow `rgba(16,128,75,0.15)` → 50%, bottom-left `rgba(2,60,30,0.3)` → 60%). Dark theme only — there is no light mode.

### 9.2 Typography
- UI font: `'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`, base 15px, line-height 1.5. Bundle Outfit or let it fall back to SF (acceptable).
- Arabic: the system Arabic font is used with **separate user-adjustable Arabic and English/translation font-size sliders** in Settings (`getFontStyle(arabicSize, translationSize)`).
- Analyze modal has its own A/AA/AAA size pills: sm=0.92rem, md=1.18rem, lg=1.5rem, persisted in localStorage `analyze-text-size`.

### 9.3 Layout & chrome
- Bottom tab bar (`.nav-btn`, active = `--highlight-color`), tabs gated by experience mode (§11.7). Home is the default tab.
- Cards on `--green-dark`/`--surface` with 1px `--border`, generous radius; buttons `--green-btn`.
- All icons are inline SVG React components (`src/utils/icons.jsx`) — no icon font. Custom bookmark: dark-green ribbon, gold border, gold crescent+star, solid fills, `em`-sized.
- Z-index hierarchy: browse overlay 200, detect-debug 250, modals 300, log reader 9999.
- Wide screens (`min-width: 600px` — on iOS this means **iPad**): single-column layout, `browseScale = 1.45`, and the critical rule `.browse-body { display: contents }` (removing it breaks scrolling — the wrapper otherwise breaks the flex chain's bounded height).
- iOS additions: respect safe areas (`viewport-fit=cover` + `env(safe-area-inset-*)` padding on the tab bar and headers). This is the only CSS you should need to ADD.

### 9.4 Feedback
- Toasts + confirm dialogs via CustomEvents (`toast.js`).
- Haptics (`haptics.js` via `@capacitor/haptics`, works on iOS unchanged): light tick per adhkar tap, heavy success buzz at goal, single medium pulse on tracker lock, double pulse on new rak'ah.

---

## 10. Feature Specifications

### 10.1 Home tab (default)
- Week calendar strip with ✓ per completed streak day.
- Prayer window bar: previous ↔ next prayer with live countdown centered (e.g. "Shuruq → Dhuhr"); bar turns red in the final 15 minutes. Below it, the full 6-prayer pill row (Fajr/Sunrise/Dhuhr/Asr/Maghrib/Isha).
- Date line: Gregorian + Hijri. **Hijri must use the self-contained tabular (Kuwaiti) algorithm in `utils/prayer.js`** — never `Intl` islamic calendars (WebView ICU builds silently return Gregorian month names; this exact bug shipped on Android).
- "Today" section: Read Quran tile (with continue position), Goals tile (active goals: Daily always, Al-Kahf on Fridays, nightly set 6pm–3am, with % progress), Hadith of the Day card, Adhkar tile (visible Fajr→Dhuhr as morning, Asr→Isha as evening), "Next sunnah fast" chip, Family circle tile with per-member streaks, Qibla shortcut.
- Ramadan mode: date line shows Suhoor-ends / Iftar times.

### 10.2 Quran tab
Opens to a **4-card menu**: Read with Translation / Mushaf / Goals / Detect my recitation (`quranView` state).
- **Read**: verse list with Arabic + English, resume position (localStorage `quran-browse-pos`), bookmark (`quran-bookmark`, custom SVG icon), per-ayah Analyze button (→ `/api/analyze` type `quran`, cached by `s:a`), surah Analyze on the surah banner (type `quran-surah`, cacheKey `surah:N`), jump-to-surah, streak banner on top (🔥 + progress bar), mic button in the header to enter Detect.
- **Mushaf**: continuous Arabic-only flowing page with ۝ ayah markers; own resume position (`quran-mushaf-pos`); tap an ayah → modal with Analyze + bookmark.
- **Goals** (`data/goals.js`, ordered sections): Daily reading (N distinct verses, configurable 5/10/20 default 10); Friday Al-Kahf (resumes where you left off within the day, partial % persists); Nightly recitation — one continuous Arabic-only reader: Ikhlas → Falaq → Nas → Ayat al-Kursi → last-2-Baqarah, auto-completing at the end, with Al-Mulk optional after the finish point. Goal reader is Arabic-only, per-goal progress bar, records verses incrementally as they scroll past.
- **Detect**: one-tap — the view auto-starts listening. Shows current verse card with two-tone karaoke highlight + live rak'ah badge; screen kept awake; session verse log grouped by rak'ah (persisted in localStorage with a 6h freshness guard so process death doesn't lose the salah log — Android learned this the hard way); after stopping: Analyze button (opens rak'ah picker if >1 rak'ah); in-session Prev/Next manual correction.
- **Bismillah display rules** (v8.15.1): the dataset embeds the Basmala inside ayah 1 of each surah. For DISPLAY, strip it from ayah-1 text (token-based comparison via `norm(BISMILLAH)` — never a hand-typed literal) and render a standalone Bismillah line before every surah — EXCEPT Al-Fatiha (it IS verse 1) and At-Tawbah (has none). Detection/tracker text stays Basmala-embedded.
- **Streak**: reading N distinct verses completes the day; one-day grace (miss one day → streak survives; two in a row → reset). Local-first (localStorage `streak-today`, `streak-state`), mirrored best-effort to `/api/streak`.

### 10.3 Khutbah tab
- Big mic button; phases `idle → listening → paused`. Live feed: Arabic segment → English translation cards (via `/api/translate` per committed segment), interim text shown dimmed (`--interim`).
- Pipeline: Scribe WS (§7) → `sttSanity` gates (hallucination/repetition/wrong-script) → Quran-quote splicing (`quranMatch.js` — recognized verses render with the canonical text/translation from the local corpus) → translate → feed.
- Du'a detection (`duaDetector.js`): weighted Arabic cue scoring inserts "Du'ā" / "Resumes khutbah" divider chips in the feed.
- After stopping: Analyze (type `khutbah`) → structured summary modal (theme/key points/references/takeaways; `[QURAN:S:A]` tokens become tappable links that navigate to the Quran tab); Save to History; Share.

### 10.4 Maktaba tab
- Shelf of downloadable hadith books + Hadith of the Day + bookmarks (`maktaba-bookmarks`); read hadith-by-hadith paginated, bookmark/analyze each (type `hadith`); grade badges (Sahih/Da'if…) on all results.
- Search: instant local search with smart synonym expansion (`synonyms.js`: Satan→Shaitan/Shaytan/Iblis…); AI concept search via `/api/related` — **resolve results locally**: Quran by verified `s:a` against the corpus, hadith by verbatim snippet match against local book text; never display an unverified reference. Autocomplete dropdown via `/api/autocomplete`.

### 10.5 History tab
- Per-device (D1 via `/api/history?device_id=`), normalized list of saved khutbahs/quran sessions/maktaba analyses; view, share, delete; export/clear all.

### 10.6 Settings tab (grouped, Prayer Times first)
- Prayer: location (manual city search from `data/cities.js` + "Use my location" GPS one-shot), calculation method, Hanafi/Shafi Asr, per-prayer reminder toggles.
- Speech engine: ElevenLabs (default) / Local — **hide Local on iOS until Phase 5**.
- Daily streak: goal size, reminder toggle (6 AM/4 PM/8 PM with rotating quotes from `quotes.json`).
- Fasting reminders toggle (default ON): white days 13/14/15 (excluding tashreeq/Ramadan), Tasu'a/Ashura, Arafah, Shawwal-6; NEVER Eids/tashreeq; no weekly Mon/Thu (Ali's preference). Nudges 3-days-before + evening-before 8 PM, with moonsighting caveat. Notification ID range 2000–2999.
- Family circle: create/join/leave/rename with `XXX-XXX` codes (`FamilySettings.jsx`).
- Fonts: Arabic size slider + Translation size slider.
- Temperature unit (used by weather — Android widget only; keep the setting harmless on iOS or hide).
- Experience mode (Basic/Medium/Expert) — re-pickable.
- Developer Options: debug logging (gates `/api/log` remote traces + detect overlay), log reader.
- Onboarding replay + Help/FAQ.

### 10.7 Cross-cutting
- **ErrorBoundary** wraps the app (catches silent blank-screen crashes, shows a reload card).
- **Onboarding** first-run walkthrough + experience-mode picker (Basic/Medium/Expert) gating which bottom-nav tabs show.
- **Back navigation**: Android hardware back is a no-op concern on iOS; keep the `backstack.js` registry driving in-app back buttons and iOS swipe-back should be left to default WebView behavior (test modals).
- **AnalyzeModal** is shared by Khutbah/Quran/Maktaba: props `loading, result, error, onClose, onSave, onShare, onNavigateToQuran, textSize, onTextSize`.

### 10.8 localStorage keys (identical to Android)
| Key | Purpose |
|---|---|
| `noor-device-id` | UUID scoping history/streak/quota |
| `khutbah-settings` | all settings incl. `sttEngine` |
| `quran-browse-pos`, `quran-mushaf-pos`, `quran-bookmark` | positions |
| `streak-today`, `streak-state`, `streak-quotes-shown` | streak engine |
| `adhkar-today` | day-scoped adhkar counts |
| `analyze-text-size` | `'sm'\|'md'\|'lg'` |
| `maktaba-bookmarks` | hadith bookmarks |
| `noor-circle`, `noor-circle-members` | family circle cache |
| Quran detect session log | localStorage w/ 6h freshness guard (NOT sessionStorage) |

---

## 11. Quran corpus & IndexedDB

- `public/quran.json` (~5.5 MB): array of `{s, a, sName, sAr, ar, en}`.
- `quranStore.js` loads it into IndexedDB, derives normalized `.n = norm(v.ar)` — and **re-runs `ensureDerived()` on every cache read** (self-healing when norm changes; a stale-cache bug once broke all detection). Cache health check: if the built word index is empty, fall back to re-loading `/quran.json`.
- WKWebView supports IndexedDB fine. Note: iOS may evict WKWebView storage under disk pressure — the store already self-heals by re-fetching the bundled JSON, so this is safe; just ensure `quran.json` ships inside the app bundle (it's in `public/`, so Vite copies it into `dist/` automatically).

---

## 12. iOS-native replacements for Android-native pieces

| Android piece | iOS replacement | Phase |
|---|---|---|
| `RecordingService` (foreground mic service + wake lock + battery-optimization banner) | **`UIBackgroundModes: audio`** in Info.plist — an active AVAudioSession recording keeps running with screen locked. Remove the Android battery banners. | 2 |
| `navigator.wakeLock` (screen awake during Detect) | `@capacitor-community/keep-awake` (`idleTimerDisabled`) — `navigator.wakeLock` is unreliable in WKWebView. Keep the same acquire-on-start / re-acquire-on-visibilitychange sites. | 2 |
| `SherpaSTT.startForegroundSession()` (keeps process alive during JS Scribe sessions) | Not needed — background audio mode covers it. Stub the plugin (§12.5). | 2 |
| `@capacitor/local-notifications` (streak/prayer/fasting reminders) | Same plugin, works on iOS. Keep ID ranges (streak / prayer separate / fasting 2000–2999). iOS pending-notification limit is 64 — the rolling 7-day window (3/day streak + prayers + fasting) can exceed it; **trim the scheduling window to ~3 days on iOS**. No exact-alarm concept on iOS → delete the "Allow exact alarms" banner code path. | 3 |
| `@capacitor/geolocation` | Same plugin. Info.plist: `NSLocationWhenInUseUsageDescription`. Foreground one-shot only (same as Android). | 3 |
| `@capacitor/haptics` | Same plugin, unchanged. | 2 |
| Qibla compass (deviceorientation) | iOS requires **`DeviceOrientationEvent.requestPermission()`** from a user gesture, and use `webkitCompassHeading` (true heading) instead of `alpha` where available. Wrap in a "Point me to Qibla" tap-to-start. | 3 |
| Home-screen prayer widget (`NoorWidget` Capacitor plugin + App Group UserDefaults + `NoorWidgetExtension` WidgetKit target) | **Code written but NOT shipped.** The Swift plugin (`NoorWidget.swift`) and widget extension source files exist, but the `NoorWidgetExtension` target was **never added to `project.pbxproj`** — it doesn't compile or ship. The `NoorWidget` Capacitor plugin calls `WidgetCenter.shared.reloadAllTimelines()` but there's no widget to reload. **Must add the target in Xcode before the widget works.** See PLAN-018 item 1.3 (→ PLAN-021). | 5 (not yet shipped) |
| Sherpa on-device Whisper (`SherpaSTTManager.java`) | Optional Phase 5: `sherpa-onnx` has iOS support (C API via Swift). Same model files, same Dropbox URLs (§13). Until then: ElevenLabs only; hide "Local" engine; if offline, show a clear "needs internet" state. | 5 (optional) |
| `getUserMedia` mic in WebView | Works in Capacitor iOS (WKWebView, iOS 14.3+). Info.plist: `NSMicrophoneUsageDescription` = "Noor listens to the khutbah or recitation to translate and track it. Audio is transcribed live and not stored." | 2 |
| Launcher icons via `gen-icons.cjs` | Generate a 1024×1024 PNG from `noor-icon.svg`; drop into `ios/App/App/Assets.xcassets/AppIcon.appiconset`. | 1 |
| Kill switch, everything JS | unchanged | 1 |

**Info.plist checklist:** `NSMicrophoneUsageDescription`, `NSLocationWhenInUseUsageDescription`, `UIBackgroundModes` = `audio`, `NSMotionUsageDescription` (compass on some devices). Set `UIViewControllerBasedStatusBarAppearance` per Capacitor default; status bar light-content over the dark theme.

---

## 13. Sherpa model files (Phase 5 only) — same Dropbox links as Android

| File | URL |
|---|---|
| Silero VAD | `https://www.dropbox.com/scl/fi/y7ardhn50o3dg64mq2nci/silero_vad.onnx?rlkey=r4mg0oqai2bk6uo24tt77fz3o&dl=1` |
| Khutbah model — tokens (small) | `https://www.dropbox.com/scl/fi/pyaen9ph5meo6093w31pv/small-tokens.txt?rlkey=5nicjs10z9lzrm405z47qz9lm&dl=1` |
| Khutbah model — encoder (small, int8) | `https://www.dropbox.com/scl/fi/p9oyq415truv69bdndlco/small-encoder.int8.onnx?rlkey=0jhl51xxlq4jj496vmi392g47&dl=1` |
| Khutbah model — decoder (small, int8) | `https://www.dropbox.com/scl/fi/r9yv433fxtz9gr4mtaa91/small-decoder.int8.onnx?rlkey=75c9vyc5ygq43rvvgc7a6ayrv&dl=1` |
| Quran model — tokens (base) | `https://www.dropbox.com/scl/fi/akbfjawvnkynbd1yf0we4/base-tokens.txt?rlkey=l4zq28wxwx16c0cy8cnggfhi2&dl=1` |
| Quran model — encoder (base, int8) | `https://www.dropbox.com/scl/fi/olpzsds7n02nfgw08tnzt/base-encoder.int8.onnx?rlkey=h0wdh9l49dzp7jv925ybvmdu3&dl=1` |
| Quran model — decoder (base, int8) | `https://www.dropbox.com/scl/fi/tza85brc2edi200qpx3fg/base-decoder.int8.onnx?rlkey=bh9pbc09d7ibhl3xqi3i90mfy&dl=1` |

Download with redirect-following (Dropbox redirects to `dl.dropboxusercontent.com`). Show a single unified "Set up Noor" progress like Android. Recommended: pin SHA-256 checksums (Android audit item L3).

---

## 14. Build environment & step-by-step plan

### Phase 0 — Prerequisites (Ali)
1. Apple Developer Program membership ($99/yr) on Ali's Apple ID — needed for TestFlight family distribution.
2. Mac access, one of: (a) any physical Mac with Xcode 16+, (b) a cloud Mac (MacStadium/Scaleway), or (c) **CI-only**: GitHub Actions `macos-14`/`macos-15` runner or Codemagic building + uploading to TestFlight via an App Store Connect API key — with this option NO local Mac is ever needed; all dev happens on Windows against the browser (`npm run dev`) and the phone only gets TestFlight builds.
3. `VITE_APP_TOKEN` value from Ali into `.env.local`.

### Phase 1 — Project scaffold + static app (Windows-only work)
```bash
git clone https://github.com/aliyaqoob7575160/Khutbah.git noor-ios
cd noor-ios
git checkout NoorAliIOS        # fresh branch, contains this file
npm create vite@latest . -- --template react   # React 18 + Vite 5 (match Android's package.json versions)
npm i @capacitor/core@^8 @capacitor/cli@^8 @capacitor/ios@^8 \
      @capacitor/app @capacitor/filesystem @capacitor/geolocation \
      @capacitor/haptics @capacitor/local-notifications @capacitor/share \
      @capacitor-community/keep-awake adhan
```
- `capacitor.config.json`: `{ "appId": "com.ali.noor", "appName": "Noor", "webDir": "dist", "plugins": { "LocalNotifications": { "iconColor": "#10804b" } } }`
- Fetch all §5 files from `aliandroidv2` raw URLs. Strip/stub Android bits per §12.
- Port `App.jsx`/`App.css`/tabs; add safe-area CSS.
- Milestone: **`npm run dev` in a desktop browser shows Home, Quran Read/Mushaf/Goals, Settings, onboarding — pixel-matching Android.** (Khutbah/Detect buttons present but show "coming in next build" if mic work isn't done.)
- Run all four test harnesses → green.

### Phase 2 — Mic + live STT (the core)
- Wire `scribeSTT.js` (unchanged), Khutbah tab, Quran Detect + tracker + Haiku rescue.
- Test in desktop browser first (getUserMedia works; the whole pipeline is testable on Windows against the real backend).
- `npx cap add ios`, Info.plist entries (§12), background audio mode, keep-awake.
- First device build: `npm run build && npx cap sync ios` then Xcode (or CI) → TestFlight build 1.
- Device acceptance: recite Al-Fatiha → locks < 2s, karaoke highlight tracks, lock survives screen-off (background audio), rak'ah counts on a 2-rak'ah mock salah, khutbah translation feed works.

### Phase 3 — Daily worship layer
- Prayer times + reminders (trimmed scheduling window, §12), streak + goals + nightly reader, adhkar, fasting reminders, Hijri (tabular only), Qibla (with iOS permission flow), Maktaba, History, family circles, kill-switch check, Hadith of the Day.

### Phase 4 — Polish & release
- App icon + splash (dark green `#0A3D24`), haptics pass, onboarding, experience modes, error boundary, toasts, iPad layout check (600px wide rules), TestFlight external testing for the family.

### Phase 5 (later)- Sherpa-onnx on-device STT (offline mode) with §13 models; WidgetKit prayer widget.

### Never do
- Don't enable `Intl` islamic calendar for Hijri. Don't add multi-word Arabic keyterms to Scribe. Don't create new D1 databases. Don't put `VITE_APP_TOKEN` in git. Don't let any formatter/linter touch `quranStore.js`'s `norm()` or any file containing Arabic literals.

---

## 15. Acceptance checklist (definition of "parity")

- [ ] All 4 Node harnesses green in the iOS repo (`test-tracker`, `test-stream`, `test-bulk`, `test-mega`)
- [ ] Kill switch respected on launch; 401 shows friendly re-auth/update message; 429 shows quota toast
- [ ] Khutbah: live Arabic→English feed, du'a chips, analyze/save/share; watchdog 8s
- [ ] Detect: one-tap start, <2s lock on clear recitation, two-tone highlight, rak'ah badge + picker, Haiku rescue fires when lost, screen stays on, works with screen locked (background audio), session survives app kill (6h guard)
- [ ] Quran: read/mushaf/goals + resume positions, bookmark, per-ayah + per-surah analyze (cache hits show instantly), Bismillah rules correct on all 114 surahs, separate font sliders
- [ ] Home: prayer bar + countdown + red final-15-min, correct tabular Hijri, goals/hadith/adhkar/fasting tiles
- [ ] Streak: goal completion, one-day grace, reminders fire with rotating quotes, D1 mirror
- [ ] Maktaba: local search + synonyms, verified-only AI concept results, book reading + bookmarks
- [ ] History: per-device list, delete/export
- [ ] Family circle: create/join with code, member streaks visible
- [ ] iPad: single-column wide layout, browse scroll works
- [ ] Design: colors/typography/spacing match Android screenshots side-by-side

---

## 16. Version table (maintain like Android's)

| iOS version | Build | Date | Notes |
|---|---|---|---|
| — | — | 2026-07-07 | Spec created (this file). Parity target: Android v8.23.0 (versionCode 90). |
| 1.0.0 (pre-build) | — | 2026-07-07 | **Phase 1 complete + Phase 2 code-complete (Windows side).** Full source ported from Android v8.23.0; all 7,892 test scenarios green; iOS plugin stubs; native `ios/` shell (SwiftPM); Info.plist permissions + background audio; KeepAwake wake lock; ElevenLabs-only engine on iOS; app icon generated. Awaiting first Mac/Xcode build — see LIVE PROGRESS section. |
| 1.0.0 (pre-build) | — | 2026-07-07 (later) | **Everything Windows-side is DONE.** Live ElevenLabs pipeline verified end-to-end from this repo (20 real clips, exact app path); browser smoke test of every tab passed (Home, Read, Mushaf, Khutbah, Maktaba, History, Settings) with zero console errors; iOS fixes: notification 64-cap, Qibla tap-to-enable, safe-area header+nav, AVAudioSession background audio in AppDelegate, light status bar, dark-green splash (no white flash), header v1.0.0; CI workflow added. **The ONLY remaining work needs a Mac: Xcode signing + on-device testing (LIVE PROGRESS §steps).** |
| 1.0.0 (build 1) | 1 | 2026-07-11 | **First iPad build SUCCEEDED.** 17 plans shipped (PLAN-001→PLAN-017): PrayerData.swift explicit init; deployment target 15→16; SPM cache recovery script; AppleSTT bridge probe + ElevenLabs Scribe fallback; ToastHost setTimeout leak fix; codesign detritus cleanup; widget Info.plist NSExtensionPrincipalClass removal; apiFetch migration wave (scribeSTT, circle, logger, streak, kill-switch); QuranMode activeTimers refactor; TODO/FIXME audit; unmount-safety guards (IndoPak fetch, fetchCircle). App installed on iPad (UDID `00008030-0004348E34C0C02E`), `xcrun devicectl listapps` confirms `com.ali.noor`. Widget extension Info.plist fixed (PLAN-007) — _note: the extension target was subsequently lost from `project.pbxproj`; see PLAN-018 v2 item 1.3 for re-adding it._ See `docs/CHANGES_LOG.md` for the full audit trail. |
| 1.0.0 (build 1) | 1 | 2026-07-12 | **PLAN-022 (JS bug-fix bundle) + PLAN-023 (iOS native fixes).** 11 JS bugs fixed in 7 source files (1 critical: `dayBeforeYesterdayStr` ReferenceError in streak.js; 1 high: Android notify 64-cap overflow; 3 medium: SherpaSTT listener accumulation + dbgRef stale-closure + circle grace-period; 4 low: dead `surahMatchCount` ref, empty `<h2>`, dead `NoorWidget` import, FIFO cap on SHOWN_KEY, event-bus Family tile refresh). 3 iOS native fixes: removed `armv7` (App Store blocker), removed `UIBackgroundModes: location` (unjustified for foreground-only geolocation), bumped `IPHONEOS_DEPLOYMENT_TARGET` 15.0→16.0 in all 4 pbxproj spots (matches widget API minimum), removed stale `-D COCOAPODS` flag from `OTHER_SWIFT_FLAGS`, ignored `Khutbah/` + `Khutbah*.zip` in `.gitignore`. Validation: `npx vite build` clean (870ms), all 4 test suites green (tracker 64/64, stream 180/180, bulk 2348/2348, mega 5300/5300). Two plan docs: [`docs/PLAN-022-bugfix-audit.md`](./docs/PLAN-022-bugfix-audit.md), [`docs/PLAN-023-ios-native-fixes.md`](./docs/PLAN-023-ios-native-fixes.md). Remaining blockers: widget target in pbxproj (PLAN-018 item 1.3), crash reporting (PLAN-018 item 2.1). |
| 1.0.0 (build 1) | 1 | 2026-07-13 | **PLAN-026 (privacy-first Sentry crash reporting = PLAN-018 item 2.1 half-wired).** Wired `@sentry/react@^10.65.0` (NOT `@sentry/capacitor` — broken against Capacitor 8's `Plugins` removal as of 2026-07) + `@sentry/vite-plugin@^2.22.0`. New `src/utils/sentry.js` privacy-first wrapper (33-key PII denylist + 4-pattern verse-ref scrubString + Map/Set/TypedArray/Symbol defensive walker + final top-level defensive sweep + djb2 hash of install UUID). `vite.config.js#build.sourcemap: 'hidden'` + skip plugin when env secrets missing. `src/main.jsx#initSentry()` runs BEFORE `initLogger()` + `createRoot()`; `window.addEventListener('unhandledrejection')` forwards every uncaught promise with `JSON.stringify(reason).slice(0,500)` (avoids Sentry collapsing every object-rejection into one bucket). `src/ErrorBoundary.jsx#componentDidCatch` calls `reportError` (try-wrapped). `ios/App/App/AppDelegate.swift` adds `#if canImport(Sentry)`-gated `SentrySDK.start` — **STAGED** until Mac installs sentry-cocoa via Xcode UI. `ios/App/App/Info.plist` adds empty `<key>SentryDSN</key><string></string>` (paste DSN to activate). Privacy posture: `sendDefaultPii:false` + `enableSwizzling:false` + `maxBreadcrumbs:0` + every UIKit/network/file-IO/metric auto-tracer explicitly off + `event.contexts.device` dropped + `event.user.id` hashed. Plan doc: [`docs/PLAN-026-sentry-crash-reporting.md`](./docs/PLAN-026-sentry-crash-reporting.md). Validation: `npx vite build` clean (2.77 s), all 4 test suites green (tracker 64/64, stream 180/180, bulk 2348/2348, mega 5300/5300). |
| 1.0.0 (build 1) | 1 | 2026-07-13 | **PLAN-024 (full-codebase JS bug-fix bundle) + PLAN-024.1 (deferred-bug follow-up pass).** Top-to-bottom audit found 15 bugs (1 critical, 2 high, 5 medium, 7 low). 9 fixed + 6 documented. **Critical fix:** `src/QuranMode.jsx` Temporal Dead Zone ReferenceError — `useRef(dbg)` was evaluated before `const dbg = useCallback(...)`, throwing on every render and silently breaking the entire Quran tab on iOS (it sat on `📖 Loading Quran…` forever via Suspense's catch-all). Fix swaps declaration order so `dbg` precedes `dbgRef`. Other fixes: FamilySettings cancelled flag (race-safe), `unmountingRef` guard before surah re-init `.then` (no torn-down listeners), missing-indopak console dedup, `sessionSummaryRef` bounded at `.slice(-3000)`, `Date.now()` for hadith day rotation (no UTC drift), `setError('')` at session start. PLAN-024.1 follow-up: WeakMap→Map in streak.js (immutable corpus), getPrayerTimes non-memoisation note, DHIKR_FILLER trade-off comment, AppDelegate AVAudioSession option rationale, autoStartedRef documentation. Validation: `npx vite build` clean (~700ms), all 4 test suites green (tracker 64/64, stream 180/180, bulk 2348/2348, mega 5300/5300). Code-reviewer APPROVED after one revision (corrected an inaccurate Quran citation in DHIKR_FILLER comment). No native or scheme changes. |

---

## 17. Session-start prompt (paste to begin any build session)

```
We're building the Noor iOS app (React 18 + Vite 5 + Capacitor 8 iOS).
Repo: aliyaqoob7575160/Khutbah, branch NoorAliIOS. Local folder: C:\KhutbahiOS (JS work on Windows; native builds via Mac/CI).
Read NOOR_IOS.md in the repo root FIRST and follow its rules exactly — especially §0 (never retype Arabic; reuse the tested engine files from branch aliandroidv2; never touch norm(); reuse the existing Cloudflare backend and D1 databases — no server changes).
Current state: <fill in from §16 version table>.
Task: <describe the phase/step from §14 you want done>.
After any tracker-path change, run: node scripts/test-tracker.mjs && node scripts/test-stream.mjs && node scripts/test-bulk.mjs && node scripts/test-mega.mjs — all must be green.
Update §16 and the progress log after every milestone.
```

---

_This document is self-contained on purpose: if you can't reach `NOOR_HANDOFF.md`, everything needed to build iOS Noor correctly is here. When the two disagree about backend/engine behavior, trust the code on `aliandroidv2`._
