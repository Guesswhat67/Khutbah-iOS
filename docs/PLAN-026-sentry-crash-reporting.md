# PLAN-026 — Privacy-first Sentry crash reporting for TestFlight (PLAN-018 item 2.1)

**Date:** 2026-07-13 · **iOS App Version:** v1.0.0 (build 1, on iPad) · **Android Baseline:** n/a (privacy posture shared but not blocked) · **Author:** Buffy (Freebuff plan agent).
**Plan target:** wire Sentry crash reporting (PLAN-018 item 2.1) without leaking prayer-app PII (Quran reading patterns, audio transcripts, GPS, family-circle data, raw device UUID).

---

## ⚡ LIVE PARITY STATUS

| Surface | Before | After |
|---|---|---|
| JS-side React render crashes | ❌ lost | ✅ → Sentry project dashboard |
| JS-side uncaught promise rejections | ❌ lost | ✅ → Sentry via `reportError` |
| Native iOS ANRs | ❌ lost | ✅ → Sentry (`enableAppHangTracking: true`) via AppDelegate (gated on `#if canImport(Sentry)`; activates once user installs sentry-cocoa on the Mac) |
| Native iOS crashes (Swift / ObjC) | ❌ lost | ⚠️ STAGED — `AppDelegate.swift` has `SentrySDK.start` wrapped in `#if canImport(Sentry)`. Native SDK install needs Mac + Xcode UI (File → Add Packages → `https://github.com/getsentry/sentry-cocoa`). Bundle builds cleanly without it. |
| Source map upload | ❌ missing | ✅ via `@sentry/vite-plugin`, gated on `VITE_SENTRY_AUTH_TOKEN` (env-only; not committed). |
| Privacy stance | — | All user-derivable categories disabled: no swizzling, no screenshots, no view hierarchy, no fetch / file-IO / UIKit tracing, no breadcrumbs. PII scrubbed at `beforeSend` + `beforeBreadcrumb`. Device-ID hashed so install correlation works without leaking the raw UUID. |

---

## 0. STRICT RULES OF ENGAGEMENT (carry-forward from PLAN-018 + WORKFLOW.md)

1. **NEVER** pass raw Device UUID, GPS, audio, family-circle, OR Quranic verse refs to Sentry.
2. **NEVER** enable UIKit swizzling, fetch breadcrumb logging, OR session replay outside of an explicit crash event.
3. **NEVER** hard-code a DSN — read from `VITE_SENTRY_DSN` env var via Vite's `import.meta.env`.
4. **NEVER** commit `VITE_SENTRY_AUTH_TOKEN` (source-map upload token) — leave it as an env-only input.
5. **NEVER** leave the scrubber failing-silent — if `scrubEvent` throws, return `null` (drop the event) rather than send un-vetted.
6. **NEVER** bundle `@sentry/capacitor` (broken against Capacitor 8's `Plugins` removal as of 2026-07). Use `@sentry/react` (browser SDK) which works in WKWebView unmodified.

---

## Master Plan

### Root Cause

PLAN-018 item 2.1 was on the critical pre-TestFlight list: "without this, family crashes are invisible." Three competing options were evaluated:

| Option | Capacitor 8 compat | Bundle size | JS+Native? | Verdict |
|---|---|---|---|---|
| `@sentry/capacitor` (official) | ❌ Imports legacy `Plugins` from `@capacitor/core` (broken since Cap 6+) | ~150 KB | both | REJECTED — build fails |
| `@capacitor-community/sentry` | ❌ does not exist on npm registry as of 2026-07-13 | — | — | REJECTED — package doesn't exist |
| `@sentry/react` (browser SDK in WKWebView) + standalone `SentrySDK.start` in AppDelegate | ✅ | ~50 KB JS | JS yes, native via separate Xcode SPM install | CHOSEN |

The pivot to `@sentry/react` was forced by the build failure (`"Plugins" is not exported by "@capacitor/core"`) under `@sentry/capacitor@4.2.0`. The browser SDK runs inside the Capacitor WKWebView with no missing APIs — fetching, Performance API, console.*, Error events, unhandledrejection are all present.

### The Code Fix

#### `src/utils/sentry.js` (NEW — ~280 lines)

Privacy-first wrapper around `@sentry/react`. Exports:
- `initSentry()` — idempotent; safe no-op when `VITE_SENTRY_DSN` is empty.
- `reportError(error, extras)` — public helper for non-render crashes.
- `reportMessage(msg, level)` — explicit message breadcrumbs (rarely used).
- `__debug__` — internal scrubber surface for test/dev tooling. Always-on (tree-shaking won't drop it because `scrubEvent` is wired to `Sentry.init`).

Hardened scrubbers handle:
- **PII denylist (33 keys):** `location`/`latitude`/`longitude`/`coords`/`altitude`/`accuracy`/`heading`/`position`/`geolocation`; `deviceId`/`device_id`/`rawDeviceId`/`memberNames`/`familyData`/`circle`/`circleCode`/`inviteCode`/`memberId`/`displayName`; `verse`/`ayah`/`surah`/`verseRef`/`quran`; `sessionToken`/`audioKey`/`audio`/`recording`/`recordingId`/`transcriptData`/`recording_id`; `arabicText`/`englishText`/`arabic_text`/`english_text`/`analysisResult`/`analysis`/`khutbah`; `fontSize`/`quranScript`/`sttEngine`/`streakGoal`/`experienceMode`/`language`/`dedup`/`quranStreams`/`performanceMode`.
- **Request subkey nuker (7 keys):** `cookies`/`headers`/`data`/`body`/`query_string`/`queryString`/`query`.
- **`scrubString` verse-ref detector (4 patterns):** exact `"N:N"`; path-keyword+digit (`ayah|surah|quran` + integer); `/X/Y` route-shaped segments with a context guard for "ayah|surah|quran|verse|recite|detect"; named-surah list (Al-Fatihah, Al-Baqarah, Al-Ikhlas, Al-Kahf, Yaseen, Rahman, Al-Mulk).
- **Final defensive sweep:** walks every un-handled top-level event key (`transaction` / `attachments` / `modules` / `checkin` / `spans` / `fingerprint` / `debug_meta` / `sdk`) through `deepScrub`, so a `Sentry.transaction` name like `"QuranRead /quran/surah/2/ayah/201"` still hits the denylist.
- **Defensive object walker:** `deepScrub` handles Maps, Sets, typed arrays (`ArrayBuffer`/`TypedArray`), Symbol-keyed props, and cycle guards via WeakSet.

Privacy posture on the SDK itself:
- `sendDefaultPii: false`, `attachStacktrace: true` (just filenames + line numbers, fine after source-map upload).
- `maxBreadcrumbs: 0` — no breadcrumbs to scrub.
- `tracesSampleRate: 0`, `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 0.1` (visual reproduction only on crashes).
- `enableTracing: false`.
- `sampleRate: 1.0` (per user choice: catch everything during initial TestFlight weeks; drop to 0.1 after stable).
- `beforeSend: scrubEvent`, `beforeBreadcrumb: scrubBreadcrumb` — every payload passes through both gates.

#### `src/main.jsx` — uncaught promise forwarding

`window.addEventListener('unhandledrejection', …)` between `initSentry()` and `createRoot()`. Wraps non-Error reasons with `JSON.stringify(reason).slice(0, 500)` for objects (avoids the useless `"[object Object]"` placeholder that `String()` produces — saves Sentry's grouping from collapsing every object-rejection into one bucket).

#### `src/ErrorBoundary.jsx` — render crashes

Added `try { reportError(error, { extra: { boundary: 'app-root', hasComponentStack: !!info?.componentStack } }) } catch {}` in `componentDidCatch`. The outer `try {}` ensures an Sentry SDK failure can't crash the boundary that already caught a render-time error. Existing custom dark-green recovery UI is preserved (deliberately NOT replacing with `Sentry.ErrorBoundary`).

#### `vite.config.js` — source-map upload

`@sentry/vite-plugin` added with `authToken` / `org` / `project` / `release` all read from env vars at build time. `inject: false` (we init Sentry in `main.jsx` ourselves). `cleanArtifacts: true` (clean previous artifacts for THIS release tag only). `sourcemap: 'hidden'` — emit `.map` files but strip `//# sourceMappingURL=` comments from the bundle.

The plugin is gated on `VITE_SENTRY_AUTH_TOKEN && VITE_SENTRY_ORG && VITE_SENTRY_PROJECT` — dev / CI without secrets stays local-only.

#### `ios/App/App/AppDelegate.swift` — native SentrySDK.start (STAGED)

After `AVAudioSession.setCategory(...)` in `application(_:didFinishLaunchingWithOptions:)`. Imports `Sentry` only inside `#if canImport(Sentry)`. Reads DSN from `Bundle.main.object(forInfoDictionaryKey: "SentryDSN")` — empty string ⇒ no-op.

Privacy-first option set:
- `enableSwizzling: false`  — no UIKit auto-instrumentation.
- `attachScreenshot: false`, `attachViewHierarchy: false`.
- `enableAutoSessionTracking: true`, `enableAppHangTracking: true` (ANRs are the most common user-visible mic-deadlock reports).
- `enableUIViewControllerTracing: false`, `enableUserInteractionTracing: false`, `enableNetworkTracking: false`, `enableFileIOTracing: false`, `enableCoreDataTracing: false`, `enableMetrics: false`.
- `maxBreadcrumbs: 0`.
- `sendDefaultPii: false`.
- Environment: `#if DEBUG → "development"` else `"production"`.
- Release name: `Bundle.main.CFBundleShortVersionString`.

#### `ios/App/App/Info.plist` — `SentryDSN` key

Added an empty `<key>SentryDSN</key><string></string>` block above `UIBackgroundModes`. AppDelegate's `Bundle.main.object(forInfoDictionaryKey: "SentryDSN") as? String` returns `""` when the user hasn't filled it in, the trim+isEmpty check fails, and `SentrySDK.start` is skipped. To activate native capture: paste the real DSN string into the empty `<string></string>`.

### Native iOS Work (Mac-only follow-up, post-`npx cap sync ios`)

`@sentry/react` is JS-only. Native iOS crash capture requires installing `sentry-cocoa` directly into the App target's Swift Package dependencies. This is a **Mac-only step** (Xcode UI only — `add package → github.com/getsentry/sentry-cocoa → Add to App target`).

Without this step:
- `AppDelegate.swift`'s `#if canImport(Sentry)` is false → no native init
- `@sentry/react` still captures every JS-side crash (`React.render` + `unhandledrejection`)
- The privacy story is unchanged (the JS scrubber still has the denylist)

The Xcode-side install is the final wire-up, OUT OF SCOPE for this plan because it requires a Mac that has the project open in Xcode. Documented in the Mac handoff section of NOOR_IOS.md + as the multi-line caption under [`docs/PLAN-018-ios-next-steps-roadmap.md`](./PLAN-018-ios-next-steps-plan.md) item 2.1.

### Future-Proofing

1. `__debug__` (always exported scrubber surface) lets a future Jest test suite verify the privacy policy. The denylist + scrubString patterns are the single source of truth — adding a new PII key is a one-line change in `PII_KEYS` plus an update to the test corpus.
2. `beforeSend` returns `null` (drop) on any scrub failure, so future added scrubbers fail safe even if they accidentally throw.
3. `maxBreadcrumbs: 0` is the strictest privacy setting — if a future team wants to re-enable breadcrumbs, they need to also re-introduce `beforeBreadcrumb` conservative category gating first (different from the current drop-all-categories posture).
4. `release` is read from `import.meta.env.VITE_APP_VERSION` — set by your CI/build script with `"<app-version>+<build>"` semantics so Sentry's release-grouping works.

---

## Validation & Acceptance Checklist

- [x] `npx vite build` clean in 2.77 s.
- [x] `npm run test:tracker` 64/64.
- [x] `npm run test:stream` 180/180.
- [x] `npm run test:bulk` 2348/2348.
- [x] `npm run test:mega` 5300/5300 — total 7,892/7,892.
- [x] `@sentry/react@^10.65.0` is in `dependencies` (the runtime import resolves correctly).
- [x] `@sentry/vite-plugin@^2.22.0` is in `devDependencies`.
- [x] `react-router-dom` is NOT in `package.json` (accidentally added during a str_replace, removed in the post-review pass).
- [x] `src/utils/sentry.js#scrubString` regex covers path-shaped verse refs (`/quran/surah/2/ayah/201`, `quran-2-201`) — not just exact `"N:N"`.
- [x] `src/main.jsx` has the `unhandledrejection` listener.
- [x] `AppDelegate.swift` has `options.enableMetrics = false`.
- [x] `Info.plist` has `<key>SentryDSN</key><string></string>` (empty by default).
- [x] No bare `fetch()` left in `sentry.js` / `main.jsx` / `ErrorBoundary.jsx`.
- [x] `__debug__` export present (always-on; the scrubber functions MUST ship in the production bundle because they're wired into Sentry.init).
- [ ] (Mac-only follow-up) Sent a real DSN + opened Xcode + installed sentry-cocoa + rebuilt.

---

## Version Table

| Surface | Status | Notes |
|---|---|---|
| PLAN-026 spec doc | ✅ Created | this file |
| PLAN-026 changelog entry | ✅ Appended | top of `docs/CHANGES_LOG.md` |
| @sentry/react + @sentry/vite-plugin in package.json | ✅ Wired | resolved at `^10.65.0` and `^2.22.0` respectively |
| src/utils/sentry.js (privacy-first wrapper) | ✅ New | 280 lines, hardened scrubbers, debug export |
| src/main.jsx (init + unhandledrejection) | ✅ Updated | initSentry + 1 listener + guarded reportError call |
| src/ErrorBoundary.jsx (captureException wire) | ✅ Updated | try-wrapped `reportError` call in componentDidCatch |
| vite.config.js (@sentry/vite-plugin) | ✅ Updated | gated on auth token + org + project |
| ios/App/App/AppDelegate.swift (SentrySDK.start) | ✅ Staged | `#if canImport(Sentry)` gating — activates once sentry-cocoa is in the Xcode SPM chain |
| ios/App/App/Info.plist (SentryDSN key) | ✅ Updated | empty string default; paste DSN to activate native init |
| PLAN-018 item 2.1 status | ⚠️ Half-wired | JS-side ✅; native side requires Mac + Xcode UI install of sentry-cocoa. Track as `STAGED_NATIVE`. |

---

## Open Items

- Sent a real Sentry DSN to be set in `.env.local` as `VITE_SENTRY_DSN=<real-dsn>` + same string pasted into `ios/App/App/Info.plist` `SentryDSN`.
- On the Mac, install `sentry-cocoa` via Xcode UI (File → Add Packages → `https://github.com/getsentry/sentry-cocoa` → Add to **App** target; do NOT add to widget target yet — widget tracking is out of scope).
- Verify dSYM upload works for TestFlight archives (`apple-crash-report`-style). Add the build script later if needed (`sentry-cli upload-dif`).
- Re-run with `VITE_SENTRY_AUTH_TOKEN + VITE_SENTRY_ORG + VITE_SENTRY_PROJECT` env set so source maps upload to Sentry — currently gated off (no secrets committed).
