# PLAN-018 — Noor iOS Next-Steps Master Roadmap (v2)

**Date:** 2026-07-12 · **iOS App Version:** v1.0.0 (build 1, on iPad) · **Android Baseline:** v8.23.0  
**Revision:** v3 — added 7 more findings from deeper investigation (repo hygiene, App Store metadata, iPad multitasking, CI, cap sync risk).

**Purpose:** A single document that captures everything that needs to happen next on the iOS app, in priority order, with enough detail that each item can be spun out into its own `PLAN-NNN` when work begins. This is a **roadmap**, not an implementation — no code is changed by this document.

---

## ⚡ CURRENT STATE SNAPSHOT (corrected)

| Surface | Status | Evidence / Correction |
|---|---|---|
| App builds & installs on iPad | ✅ | `xcodebuild … DEVELOPMENT_TEAM=89RUQ4H8S5` → `** BUILD SUCCEEDED **`; `xcrun devicectl listapps` shows `com.ali.noor` |
| Home, Quran Read/Mushaf/Goals, Settings, Maktaba, History | ✅ | Browser smoke test passed (Windows); iPad launch confirmed |
| Khutbah live translation (ElevenLabs Scribe) | ✅ code-complete | Pipeline verified end-to-end from repo (20 real clips); iPad fallback path wired (PLAN-004) |
| Quran Detect (ElevenLabs tracker path) | ✅ code-complete | Same Scribe pipeline; anchor tracker + Haiku rescue wired |
| Quran Detect (Apple Native STT) | ⚠️ Fallback only | `AAPLESTT_UNAVAILABLE` → Scribe fallback shipped (PLAN-004); root cause (ObjC `+load` not linked) still open |
| WidgetKit prayer-clock widget | 🔴 **NOT shipped** | Swift source files exist (`NoorWidget.swift`, `PrayerClockWidget.swift`, etc.) but the **NoorWidgetExtension target is not currently registered in `project.pbxproj`**. PLAN-007 (2026-07-11) fixed an `MIInstallerErrorDomain 152` install rejection with the widget extension, which implies it WAS compiled at some point during that session — the target was likely lost during a subsequent `cap sync` that regenerated the pbxproj. The Capacitor plugin (`NoorWidget.swift`) still calls `WidgetCenter.shared.reloadAllTimelines()` but there's no widget to reload. The widget does not appear on the home screen. |
| Prayer times, Hijri, streak, goals, adhkar, fasting | ✅ code-complete | Not yet device-verified (reminders firing, safe areas, etc.) |
| Qibla compass | ✅ code-complete | iOS permission flow wired; not yet device-verified |
| Family circles | ✅ code-complete | `/api/circle` migrated to `apiFetch` (PLAN-010) |
| **`IPHONEOS_DEPLOYMENT_TARGET`** | 🔴 **Still 15.0** | PLAN-002 claimed it was bumped to 16.0, but `grep -n 'IPHONEOS_DEPLOYMENT_TARGET' project.pbxproj` shows **all 4 occurrences are still `15.0`** (lines 233, 284, 301, 323). PLAN-002 was either never applied or was reverted. The Info.plist `MinimumOSVersion` is also `15.0` — so they're at least *consistent*, but at the wrong value. |
| **`UIRequiredDeviceCapabilities: armv7`** | 🔴 **App Store blocker** | Info.plist line 44-46 declares `armv7` as a required device capability. Apple dropped armv7 support with iOS 11 (2017). All modern iOS devices are **arm64-only**. This capability flag will likely cause App Store rejection ("this app requires a device capability that is not available on the listed devices") or prevent installation on any modern iPhone/iPad. |
| CocoaPods leftover | 🟡 Stale flag | `OTHER_SWIFT_FLAGS` at pbxproj line 307 contains `"-D" "COCOAPODS"` even though there is no Podfile and the project uses SwiftPM exclusively. This is a harmless but confusing leftover from the original Capacitor project template. |
| Background audio (AVAudioSession) | ✅ Already configured | `AppDelegate.swift` correctly sets `.playAndRecord` + `.mixWithOthers` + `.allowBluetooth` + `.defaultToSpeaker` at launch. `UIBackgroundModes` includes `audio`. This is the correct setup — but it has **never been device-verified**. |
| TestFlight external testing | ❌ Not started | Need archive + upload to App Store Connect |
| Crash reporting / remote logging | ❌ None | Zero matches for Sentry, Crashlytics, Firebase, Bugsnag, or any crash reporter. Once the app is on family devices via TestFlight, there is **no way to diagnose crashes** without the user manually sending a screenshot. |
| Sherpa on-device STT (Phase 5) | ❌ Deferred | Optional; iOS C API binding not started |
| **Daily streak completion** | 🔴 **BROKEN** | `dayBeforeYesterdayStr()` is undefined in `src/utils/streak.js` — crashes on goal completion |
| **`Khutbah/` directory (262MB)** | 🟡 Risk | 262MB directory containing the full Android app source + whisper.cpp. Not tracked by git (0 files), but `.gitignore` pattern `Khutbah-*/` does NOT match `Khutbah/` (no hyphen). Could be accidentally committed. `Khutbah-aliandroidv2.zip` (2.9MB) similarly at risk. |
| **Privacy policy** | 🔴 **Missing** | No privacy policy file exists anywhere in the project. No mention in README. App Store Connect requires a privacy policy URL for all apps. Must create before TestFlight. |
| **App Store metadata & screenshots** | ❌ Not started | No fastlane setup, no metadata directory, no screenshots. TestFlight needs at minimum: app description, screenshots per device family, privacy details. |
| **`UISupportsMultiWindows`** | 🟡 Missing | Not in Info.plist. iPad multitasking (Split View, Slide Over) requires this key since iOS 13. Without it, the app may be forced into compact width, breaking the 600px wide layout rules. |
| **CI builds only on Ubuntu** | 🟡 Gap | GitHub Actions workflow (`.github/workflows/tests.yml`) runs Node tests on `ubuntu-latest` but never builds the iOS app. A `macos-14`/`macos-15` runner could verify the Xcode build on every push. |
| **`cap sync` overwrite risk** | 🟠 HIGH | The widget extension target was likely lost during a `cap sync` that regenerated `project.pbxproj`. After re-adding the target (item 1.3), future `cap sync` calls may overwrite it again. Need a prevention strategy. |
| **Provisioning profile / signing** | ❌ Not documented | No `.mobileprovision` files found. Code signing setup for TestFlight is not documented anywhere. |

---

## 0. STRICT RULES OF ENGAGEMENT (carry forward from prior plans)

1. **NEVER touch shared JS engine files** without Android parity re-validation: `quranTracker.js`, `quranStore.js`, `scribeSTT.js`, `sttSanity.js`, `quranMatch.js`, `duaDetector.js`.
2. **NEVER retype Arabic text or write regex with literal Arabic.** Use `\uXXXX` escapes only.
3. **NEVER commit `.env.local`** — it holds `VITE_APP_TOKEN`.
4. **NEVER re-introduce CocoaPods** — SwiftPM only.
5. **NEVER bump `IPHONEOS_DEPLOYMENT_TARGET` below 16.**
6. **NEVER let a formatter/linter touch `quranStore.js`'s `norm()`.**
7. **Follow WORKFLOW.md:** plan → apply → log. Every code change gets a `PLAN-NNN` doc first, then a `CHANGES_LOG.md` entry.
8. **Run test harnesses after touching tracker-path files:** `node scripts/test-tracker.mjs && node scripts/test-stream.mjs && node scripts/test-bulk.mjs && node scripts/test-mega.mjs` — all must stay green.
9. **After any pbxproj edit:** run `plutil -lint ios/App/App.xcodeproj/project.pbxproj` to verify the XML-like structure isn't corrupted.

---

## MASTER ROADMAP — Ordered Work Items

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### TIER 1 — CRITICAL: App Store Blockers & Feature Breakage
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These items **must be fixed before TestFlight upload**. The app will be rejected or broken without them.

---

### 1.1 — FIX: Remove `armv7` from `UIRequiredDeviceCapabilities` (App Store rejection risk)

**Severity:** 🔴 CRITICAL — likely App Store rejection
**Effort:** 2 lines in Info.plist (remove the key + value)
**Files:** `ios/App/App/Info.plist`

#### Root Cause

Info.plist lines 44-46:
```xml
<key>UIRequiredDeviceCapabilities</key>
<array>
    <string>armv7</string>
</array>
```

Apple dropped all armv7 (32-bit ARM) device support with iOS 11 in 2017. Every iPhone from iPhone 5s onward (2013+) and every iPad from iPad Air onward (2013+) is arm64-only. Declaring `armv7` as a required capability tells the App Store this app requires a 32-bit ARM CPU — which no supported device has. The most likely outcomes:

1. **App Store Connect rejects the upload** with "This bundle is invalid. The key `UIRequiredDeviceCapabilities` contains value `armv7` that is incompatible with the minimum OS version."
2. **Or:** the app is listed as incompatible with every device, so TestFlight testers can't install it.

This was almost certainly generated by the original Capacitor project template (which targets older Xcode versions) and never cleaned up.

#### Fix

Remove the entire `UIRequiredDeviceCapabilities` key:
```xml
<!-- DELETE THESE 3 LINES -->
<key>UIRequiredDeviceCapabilities</key>
<array>
    <string>armv7</string>
</array>
```

Alternatively, if you want to declare arm64 explicitly (not required, but explicit):
```xml
<key>UIRequiredDeviceCapabilities</key>
<array>
    <string>arm64</string>
</array>
```

**Recommendation:** Just remove it entirely. Apple infers the architecture from the binary.

#### Validation

- [ ] `plutil -lint ios/App/App/Info.plist` passes
- [ ] `grep -n 'armv7' ios/App/App/Info.plist` returns 0
- [ ] `npm run build && npx cap sync ios` succeeds
- [ ] `xcodebuild … DEVELOPMENT_TEAM=89RUQ4H8S5` → `** BUILD SUCCEEDED **`
- [ ] App installs on iPad without warnings
- [ ] (TestFlight) App Store Connect accepts the archive upload without capability warnings

#### Spin-out: `PLAN-019`

---

### 1.2 — FIX: Bump `IPHONEOS_DEPLOYMENT_TARGET` to 16.0 in pbxproj (PLAN-002 was never applied)

**Severity:** 🔴 CRITICAL — the widget extension requires iOS 16+; the project says 15.0
**Effort:** 4 line changes in pbxproj
**Files:** `ios/App/App.xcodeproj/project.pbxproj`

#### Root Cause

PLAN-002 documented bumping the deployment target from 15.0 to 16.0. But the current pbxproj still has **all 4 occurrences set to 15.0**:
- Line 233: `IPHONEOS_DEPLOYMENT_TARGET = 15.0;`
- Line 284: `IPHONEOS_DEPLOYMENT_TARGET = 15.0;`
- Line 301: `IPHONEOS_DEPLOYMENT_TARGET = 15.0;`
- Line 323: `IPHONEOS_DEPLOYMENT_TARGET = 15.0;`

The Info.plist also has `MinimumOSVersion = 15.0` (though this is usually auto-set by Xcode from the build setting at archive time).

#### Why this matters

1. **WidgetKit `containerBackground(for: .widget)`** requires iOS 17+. The widget code already has `#available(iOSApplicationExtension 17.0, *)` guards, but the **`contentMarginsDisabled()`** modifier used in `PrayerClockWidget.swift` requires iOS 17+ and is not guarded. If the deployment target stays at 15.0, the widget extension won't even compile.
2. **SwiftPM `CapApp-SPM/Package.swift`** lists dependencies that may have iOS 16+ minimums (Capacitor 8.x).
3. **`@available(iOSApplicationExtension 17.0, *)`** checks are meaningless if the base deployment target is 15.0 — the compiler generates warnings, and the code paths are unpredictable.

#### Fix

Change all 4 occurrences in `project.pbxproj` from `15.0` to `16.0`:
```
IPHONEOS_DEPLOYMENT_TARGET = 16.0;
```

Also remove or update the `MinimumOSVersion` key in `Info.plist`:
- **Option A (preferred):** Remove the `<key>MinimumOSVersion</key>` entirely — Xcode injects it from `IPHONEOS_DEPLOYMENT_TARGET` at build time.
- **Option B:** Set it to `<string>16.0</string>` explicitly.

**Note:** If you want the widget's `containerBackground(for: .widget)` and `contentMarginsDisabled()` to work without availability guards, bump to **17.0** instead. The iPad is likely iOS 17+, but TestFlight family testers on older devices would be excluded. **Recommend 16.0** for now and handle the 17+ features with `#available` guards (the widget code already does this for `containerBackground` — just add a guard for `contentMarginsDisabled()` too). **This `contentMarginsDisabled()` guard is a sub-task of PLAN-021** (widget target) since the widget needs to compile anyway.

#### Validation

- [ ] `grep -n 'IPHONEOS_DEPLOYMENT_TARGET' ios/App/App.xcodeproj/project.pbxproj` shows `16.0` in all 4 places
- [ ] `plutil -lint ios/App/App.xcodeproj/project.pbxproj` passes
- [ ] `npm run build && npx cap sync ios` succeeds
- [ ] `xcodebuild … DEVELOPMENT_TEAM=89RUQ4H8S5` → `** BUILD SUCCEEDED **`
- [ ] No Xcode warnings about deployment target mismatches
- [ ] (If MinimumOSVersion was set explicitly) `plutil -p ios/App/build/.../App.app/Info.plist | grep MinimumOSVersion` shows `16.0`

#### Spin-out: `PLAN-020` (supersedes the original PLAN-002 which was not applied)

---

### 1.3 — FIX: WidgetKit extension target is not in the Xcode project

**Severity:** 🔴 CRITICAL — the widget doesn't exist as a compiled target
**Effort:** 30-60 min in Xcode (add target, configure build settings, add App Group, embed in app)
**Files:** `ios/App/App.xcodeproj/project.pbxproj` (via Xcode UI), `ios/App/NoorWidgetExtension/`

#### Root Cause

The Swift source files for the widget extension exist:
- `ios/App/NoorWidgetExtension/NoorWidgetExtension.swift` (`@main` WidgetBundle)
- `ios/App/NoorWidgetExtension/PrayerClockWidget.swift` (the actual widget view)
- `ios/App/NoorWidgetExtension/PrayerData.swift` (Codable payload)
- `ios/App/NoorWidgetExtension/PrayerTimelineProvider.swift` (timeline provider)
- `ios/App/NoorWidgetExtension/NoorWidgetExtension.entitlements` (App Group)

But `grep -i 'NoorWidgetExtension' ios/App/App.xcodeproj/project.pbxproj` returns **zero matches**. The target is not currently in the Xcode project. PLAN-007 (2026-07-11) fixed an `MIInstallerErrorDomain 152` install rejection with the widget extension, which implies it was compiled during that session — the target was likely lost during a subsequent `cap sync` that regenerated the pbxproj. This means:

1. The widget extension code is **not currently compiled** (it was likely compiled during the 2026-07-11 session per PLAN-007, but the target was lost from the pbxproj)
2. The widget extension is **never linked** into the `.app` bundle
3. `WidgetCenter.shared.reloadAllTimelines()` in `NoorWidget.swift` (the Capacitor plugin) fires, but **there's no widget to reload** — the call is a no-op
4. The user cannot add a "Noor Prayer Clock" widget to their home screen because the extension doesn't ship

Additionally, the `Assets.xcassets` directory was deleted from the widget extension (per the git diff), so even if the target is added, it will need a new asset catalog or the build settings adjusted to not require one.

The previous "✅ Shipped" status in the NOOR_IOS.md was **incorrect** — the Swift code was written and may have been compiled during the 2026-07-11 session (PLAN-007 fixed an install error with it), but the target is not currently in the Xcode project. It was likely lost during a `cap sync` that regenerated the pbxproj without the manual target addition.

#### Fix

This requires manual Xcode UI work (cannot be scripted safely):

1. **Open Xcode** → `npx cap open ios`
2. **Add the widget extension target:**
   - File → New → Target
   - iOS → Widget Extension
   - Product name: `NoorWidgetExtension`
   - Include Configuration App Intent: **No**
   - Embed in Application: **App**
   - Language: Swift
3. **Replace the auto-generated files** with the existing ones:
   - Delete the boilerplate `.swift` files Xcode creates
   - Add the existing 4 Swift files (drag into the target, check "Copy items if needed" is unchecked — they're already in the right directory)
4. **Configure the target:**
   - Signing & Capabilities → add App Group: `group.com.ali.noor` (must match both `App.entitlements` and `NoorWidgetExtension.entitlements`)
   - Build Settings → `IPHONEOS_DEPLOYMENT_TARGET = 16.0` (match the main app, per item 1.2)
   - Build Settings → `INFOPLIST_KEY_CFBundleDisplayName = Noor Prayer Clock`
   - Build Settings → `PRODUCT_BUNDLE_IDENTIFIER = com.ali.noor.NoorWidgetExtension`
   - Build Settings → `SKIP_INSTALL = YES` (the extension is embedded, not installed separately)
   - Build Settings → `ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = YES`
5. **Create a minimal `Assets.xcassets`** for the extension (or set `ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME` to empty):
   - Right-click the target → New File → Asset Catalog → name it `Assets.xcassets`
   - Add a basic `Contents.json` and an `AccentColor` colorset (or just an empty catalog)
6. **Verify the embed:**
   - Go to the App target → General → Frameworks, Libraries, and Embedded Content
   - The `NoorWidgetExtension.appex` should appear under "Embed Extensions"
7. **Build & verify:**
   - `xcodebuild … DEVELOPMENT_TEAM=89RUQ4H8S5` → `** BUILD SUCCEEDED **`
   - `grep -i 'NoorWidgetExtension' ios/App/App.xcodeproj/project.pbxproj` now returns matches
   - The built `.app` contains `PlugIns/NoorWidgetExtension.appex`

#### Validation

- [ ] `grep -c 'NoorWidgetExtension' ios/App/App.xcodeproj/project.pbxproj` returns > 0
- [ ] Build succeeds with no errors about missing targets or duplicate `@main` attributes
- [ ] `ls -la ios/App/App/Build/Products/Debug-iphoneos/App.app/PlugIns/NoorWidgetExtension.appex` exists after build
- [ ] On iPad: long-press home screen → "+" → search "Noor" → the Prayer Clock widget appears
- [ ] Add the small widget to the home screen → it renders the placeholder or real prayer data
- [ ] Open the app → the widget updates within a few seconds (WidgetCenter.reloadAllTimelines fires)

#### What can go wrong

- **Duplicate `@main` error:** If the boilerplate `NoorWidgetExtensionBundle.swift` wasn't deleted, there will be two `@main` attributes. Ensure only `NoorWidgetExtension.swift` (the `WidgetBundle`) is the entry point.
- **App Group mismatch:** Both the main app and the widget extension must list `group.com.ali.noor` under Signing & Capabilities → App Groups. If either is missing, `UserDefaults(suiteName:)` returns nil and the widget shows placeholder forever.
- **`contentMarginsDisabled()` on iOS 16:** This modifier is iOS 17+. If the deployment target is 16.0, wrap it in `if #available(iOS 17.0, *)` or remove it and use `.padding(0)` instead.
- **Asset catalog errors:** The deleted `Assets.xcassets` needs to be recreated or the build setting `ASSETCATALOG_COMPILER_APPICON_NAME` should be cleared for the extension target.

#### Spin-out: `PLAN-021`

---

### 1.4 — FIX: `dayBeforeYesterdayStr()` undefined → streak completion crash

**Severity:** 🔴 CRITICAL — breaks the core daily-streak feature
**Effort:** 1 line (add the missing function) or 1 line (remove the call)
**Files:** `src/utils/streak.js`

#### Root Cause

`markDayComplete()` at line ~135 calls `dayBeforeYesterdayStr()`:
```js
const cont = s.lastCompletedDay === yesterdayStr() || s.lastCompletedDay === dayBeforeYesterdayStr()
```

But `dayBeforeYesterdayStr()` is **never defined** in `src/utils/streak.js`. Only `ymd()`, `todayStr()`, and `yesterdayStr()` exist. The `Khutbah/` copy has it at line 41, but the `src/` version is missing it.

#### Impact

Every time a user completes their daily reading goal:
- `markDayComplete()` throws `ReferenceError: dayBeforeYesterdayStr is not defined`
- The streak counter never increments
- The completion is never saved to state
- The cloud sync (`syncToday`) never fires
- The "Daily goal complete 🎉" toast never shows

This means the **entire streak feature is broken on iOS**.

#### Two Fix Options

**Option A (preserve 2-day grace):** Add the missing function:
```js
function dayBeforeYesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 2); return ymd(d) }
```
Place it right after `yesterdayStr()` (line ~37).

**Option B (enforce documented 1-day grace):** Remove the `dayBeforeYesterdayStr()` call entirely:
```js
const cont = s.lastCompletedDay === yesterdayStr()
```
This matches the comment above it which explicitly says the 2-day grace *"contradicted the documented one-day leniency"*.

#### Recommendation

**Option B** — the code's own comments say the 2-day grace was a bug. `getDisplayStreak()` already uses 1-day grace. `markDayComplete()` should match. This also makes `displayStreakOf()` in `circle.js` the only outlier (see item 1.5).

#### Validation

- [ ] `node --check src/utils/streak.js` exits 0
- [ ] `grep -n 'dayBeforeYesterdayStr' src/utils/streak.js` returns 0 (Option B) or returns the new function definition (Option A)
- [ ] Manual test: set `streakGoal` to 5, read 5 distinct verses in Browse → "Daily goal complete" toast appears, streak increments, `localStorage.getItem('streak-state')` shows `current: N+1`
- [ ] `node scripts/test-tracker.mjs` exits 0

#### Spin-out: `PLAN-022`

---

### 1.5 — FIX: Streak grace-period inconsistency (3-way mismatch)

**Severity:** 🟠 HIGH — family members' streaks display incorrectly
**Effort:** ~3 lines across 1 file
**Files:** `src/utils/circle.js`

#### Root Cause

The "one-day leniency" rule is implemented inconsistently:

| Function | File | Grace period | Status |
|---|---|---|---|
| `getDisplayStreak()` | `streak.js` | **1 day** (today + yesterday) | ✅ Correct per docs |
| `markDayComplete()` | `streak.js` | Tries **2 days** (yesterday + day-before) | 💥 Crashes (bug 1.4) |
| `displayStreakOf()` | `circle.js` | **2 days** (today + yesterday + day-before) | ❌ Contradicts docs |

`displayStreakOf()` in `circle.js` line ~86:
```js
return (last === d(0) || last === d(1) || last === d(2)) ? (member.current || 0) : 0
```

This means family members' streaks survive a 2-day gap, but the user's own streak (`getDisplayStreak`) only survives 1 day.

#### Fix

Align `displayStreakOf()` to 1-day grace (remove the `d(2)` check):
```js
return (last === d(0) || last === d(1)) ? (member.current || 0) : 0
```

#### Validation

- [ ] `node --check src/utils/circle.js` exits 0
- [ ] `grep -n 'd(2)' src/utils/circle.js` returns 0
- [ ] Manual: with a family circle active, check that a member who last completed 2 days ago shows streak 0

#### Spin-out: `PLAN-023`

---

### 1.6 — FIX: SherpaSTT listener accumulation on surah changes

**Severity:** 🟡 MEDIUM — duplicate session entries, memory leak
**Effort:** ~2 lines (add `removeAllListeners` before re-adding)
**Files:** `src/QuranMode.jsx` (inside `handleResult`, ~line 1083)

#### Root Cause

When using the on-device (Sherpa) engine, each surah change re-initializes SherpaSTT with a new prompt and re-adds `result` + `error` listeners — but **never removes the old ones**:

```js
SherpaSTT.stopListening().catch(() => {})
SherpaSTT.initialize({ quranMode: true, initialPrompt: prompt, performanceMode }).then(() => {
  SherpaSTT.addListener('result', handleResult)      // ← stacked on top of previous
  SherpaSTT.addListener('error', ({ message }) => { ... })  // ← new anonymous fn each time
  SherpaSTT.startListening().catch(() => {})
}).catch(() => {})
```

After N surah changes, each STT result fires `handleResult` N times. Same class of bug already fixed in `AppleSTT.js` (bug #H5).

#### Fix

Add `SherpaSTT.removeAllListeners().catch(() => {})` before the re-init:
```js
SherpaSTT.stopListening().catch(() => {})
SherpaSTT.removeAllListeners().catch(() => {})  // ← ADD THIS
SherpaSTT.initialize({ ... }).then(() => {
```

#### Note

On iOS this code path is only reached when `sttMode === 'local'` (Sherpa), which is currently a stub that always throws. So this bug is **latent on iOS** — it won't fire until Sherpa iOS binding ships. But fixing it now prevents a future regression.

#### Spin-out: `PLAN-024`

---

### 1.7 — CLEANUP: Remove stale CocoaPods flag from pbxproj

**Severity:** 🟡 MEDIUM — confusing for future debugging, potential SPM conflict
**Effort:** 1 line edit in pbxproj
**Files:** `ios/App/App.xcodeproj/project.pbxproj`

#### Root Cause

Line 307 of `project.pbxproj`:
```
OTHER_SWIFT_FLAGS = "$(inherited) "-D" "COCOAPODS" "-DDEBUG"";
```

There is **no Podfile** in the `ios/` directory, and the project uses SwiftPM exclusively (per NOOR_IOS.md and the `CapApp-SPM/Package.swift`). The `COCOAPODS` compiler flag is a leftover from the original Capacitor project template. While it's currently harmless (no code uses `#if COCOAPODS`), it:

1. Confuses anyone debugging build issues ("are we using CocoaPods or SwiftPM?")
2. Could trigger conditional compilation in a future dependency that checks for `COCOAPODS`
3. Violates rule #4 in the Strict Rules of Engagement ("NEVER re-introduce CocoaPods")

#### Fix

Remove the `"-D" "COCOAPODS"` portion from `OTHER_SWIFT_FLAGS`:
```
OTHER_SWIFT_FLAGS = "$(inherited) "-DDEBUG"";
```

Or remove the entire line if `DEBUG` is already defined by the standard Xcode debug configuration (it usually is via `SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG`).

#### Validation

- [ ] `grep -n 'COCOAPODS' ios/App/App.xcodeproj/project.pbxproj` returns 0
- [ ] `plutil -lint ios/App/App.xcodeproj/project.pbxproj` passes
- [ ] Build succeeds
- [ ] No Swift compilation errors from missing `#if COCOAPODS` guards (there shouldn't be any)

#### Spin-out: `PLAN-025`

---

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### TIER 2 — HIGH: Pre-TestFlight Requirements
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These should be done before uploading to TestFlight so the family's first experience is good and crashes are diagnosable.

---

### 2.1 — ADD: Crash reporting for TestFlight builds

**Severity:** 🟠 HIGH — without this, family crashes are invisible
**Effort:** 1-2 hours (choose provider, integrate, test)
**Files:** New integration (Sentry / Crashlytics), `src/ErrorBoundary.jsx`, `src/utils/logger.js`

#### Why this matters

Once the app is on family devices via TestFlight, there is **zero visibility** into crashes. The `ErrorBoundary.jsx` catches React render errors and shows a fallback UI, but:
- It doesn't report the crash anywhere
- Native crashes (Swift/ObjC) bypass React entirely
- `logger.js` sends logs to `/api/log` but only when the app is running — a crash kills the process before the log POST completes
- The user would need to manually screenshot the error and send it to you

#### Provider options

| Provider | Free tier | Setup complexity | Capacitor support |
|---|---|---|---|
| **Sentry** | 5,000 errors/month | Easy (npm + Xcode) | `@sentry/capacitor` official package |
| **Firebase Crashlytics** | Unlimited | Medium (GoogleService-Info.plist + Firebase project) | `@capacitor-community/firebase-crashlytics` |
| **Bugsnag** | 7,500 errors/month | Easy | `@bugsnag/capacitor` official package |

#### Recommendation

**Sentry** — the `@sentry/capacitor` package is officially maintained, has the simplest setup, and the free tier is more than enough for a family-distributed app. It captures both JS errors (React exceptions, unhandled promise rejections) and native crashes (Swift/ObjC exceptions).

#### What to do

1. `npm i @sentry/capacitor`
2. Create a Sentry project at sentry.io (free signup)
3. Initialize in `src/main.jsx`:
   ```js
   import * as Sentry from '@sentry/capacitor'
   Sentry.init({ dsn: 'YOUR_SENTRY_DSN', environment: 'production' })
   ```
4. Add native crash capture in `ErrorBoundary.jsx`'s `componentDidCatch`:
   ```js
   Sentry.captureException(error, { extra: { componentStack } })
   ```
5. Add `@sentry/capacitor` to the SwiftPM `Package.swift` dependencies
6. Test: deliberately throw an error in a hidden button → verify it appears in the Sentry dashboard

#### Alternative: Lightweight approach

If you don't want a third-party dependency, enhance `logger.js` to buffer critical errors in `localStorage` and flush them on the next app launch. This won't catch native crashes, but it's zero-dependency and gives you JS error visibility.

#### Validation

- [ ] Sentry dashboard receives a test error after `Sentry.init`
- [ ] `ErrorBoundary.jsx` captures and reports a deliberate React crash
- [ ] App builds and installs without errors
- [ ] No performance regression (Sentry's SDK is ~50KB, negligible)

#### Spin-out: `PLAN-026`

---

### 2.2 — DEVICE VERIFICATION: Background audio (mic capture with screen locked)

**Severity:** 🟠 HIGH — #1 risk per NOOR_IOS.md
**Effort:** 15 min manual test on iPad
**Files:** None (verification only — AVAudioSession is already configured in AppDelegate)

#### What to verify

The `AppDelegate.swift` already configures `AVAudioSession` correctly:
```swift
let session = AVAudioSession.sharedInstance()
try? session.setCategory(.playAndRecord,
                         mode: .default,
                         options: [.mixWithOthers, .allowBluetooth, .defaultToSpeaker])
try? session.setActive(true)
```

And `Info.plist` includes `UIBackgroundModes: audio`. This is the correct setup. But it has **never been device-verified**. The entire background-listening strategy (Detect during salah, khutbah translation) depends on this working.

#### Test procedure

1. Open Noor on iPad → Quran → Detect
2. Start detection (recite Al-Fatiha)
3. Confirm karaoke highlight is tracking
4. Press the iPad power button to lock the screen
5. Wait 10 seconds
6. Continue reciting (e.g., start Surah Al-Ikhlas)
7. Press power button to wake the screen
8. **Expected:** the session has advanced — verses from while the screen was locked appear in the session log
9. **If it fails:** the mic stream was killed by the OS. Next steps:
   - Connect Safari Web Inspector (Settings → Safari → Advanced → Web Inspector on; then on Mac: Safari → Develop → iPad) and check console for `getUserMedia` errors during the lock/unlock cycle
   - Check if `KeepAwake.keepAwake()` (called at `QuranMode.jsx` line 1239) is sufficient, or if we also need to play a silent audio loop to keep the audio session alive
   - Consider adding a silent `AVAudioPlayer` that loops in the background to prevent the OS from deactivating the audio session (common pattern for audio apps)

#### Also test for Khutbah tab

Repeat steps 1-8 but with Khutbah (live translation) instead of Quran Detect. The Scribe WebSocket should keep streaming audio during lock.

#### Note on `UIBackgroundModes: location`

The Info.plist also includes `location` in `UIBackgroundModes`. This was likely added for background location updates, but the app only does foreground one-shot geolocation (per NOOR_IOS.md). Having `location` in background modes without using it can trigger App Store review questions ("Why does your app need background location?"). **Consider removing it** unless it's intentionally used for something.

#### Spin-out: `PLAN-027`

---

### 2.3 — DEVICE VERIFICATION: Local notifications actually fire on iOS

**Severity:** 🟠 HIGH — if notifications don't fire, prayer/streak/fasting reminders are broken
**Effort:** 30 min manual test on iPad
**Files:** None (verification only)

#### What to verify

Per NOOR_IOS.md §12.3, the code trims `DAYS_AHEAD` to 4 on iOS (was 7) to stay under the 64-pending-notification limit. But **reminders have never been verified to actually fire on device**.

#### Test procedure

1. Settings → Prayer Times → set location to your city
2. Settings → Prayer Reminders → ON
3. Settings → Daily Streak → Reminders: ON
4. Force-quit the app
5. Wait for the next prayer time (or temporarily set a reminder 2 minutes in the future by editing `SLOTS` in `notify.js` for testing)
6. **Expected:** notification appears at the scheduled time with the correct prayer name
7. Verify the notification works with the app fully closed (not just backgrounded)
8. Verify notifications don't duplicate (the `cancelRange` before `schedule` should prevent this)

#### Potential issues

- **Permission not requested:** `ensurePermission()` in `notify.js` calls `LocalNotifications.requestPermissions()` — verify the iOS permission prompt appears on first launch
- **Channel creation fails on iOS:** `createChannel` is Android-only; on iOS it should be a no-op wrapped in try/catch — verify in console
- **64-notification overflow:** with 4 days × (3 streak + 5 prayer) + fasting = ~32-40 notifications. Should be safe.
- **Notification icon:** `capacitor.config.json` sets `LocalNotifications.iconColor = "#10804b"` — verify the notification badge/icon renders correctly on iOS (iOS uses a white template icon, so this might not apply)

#### Spin-out: `PLAN-028`

---

### 2.4 — DEVICE VERIFICATION: Qibla compass permission flow

**Severity:** 🟡 MEDIUM
**Effort:** 10 min manual test on iPad
**Files:** None (verification only)

#### Test procedure

1. Settings → set location (any city)
2. Home → Qibla tile
3. **Expected:** if first time, "🧭 Enable compass" button appears
4. Tap the button → iOS permission prompt for motion/compass appears
5. Allow → compass dial starts rotating with device heading
6. Verify the Kaaba needle points in the correct direction (compare with a compass app)
7. Verify low-pass smoothing works (needle doesn't jitter excessively)

#### Spin-out: `PLAN-029`

---

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### TIER 3 — POLISH & ACCESSIBILITY
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

---

### 3.1 — AUDIT: Accessibility (VoiceOver, Dynamic Type, reduced motion)

**Severity:** 🟡 MEDIUM — App Store review may flag missing accessibility
**Effort:** 2-3 hours (audit + fixes)
**Files:** `src/App.css`, various `.jsx` files

#### Current state

- **ARIA labels:** Present on mic/stop/pause/resume buttons (`aria-label="Start listening"`, etc.) — ✅ good
- **`aria-live` regions:** Toast host has `role="status" aria-live="polite"` — ✅ good
- **`aria-hidden`:** Used on decorative elements (status dots, swap arrows) — ✅ good
- **`prefers-reduced-motion`:** Zero matches in CSS — ❌ missing. The app has animations (pulse effects, transitions, haptic pulses) that should be disabled for users with motion sensitivity
- **Dynamic Type:** No explicit Dynamic Type support. iOS WKWebView doesn't automatically honor Dynamic Type — the app uses fixed `font-size: 15px` and rem-based scaling. This may be acceptable for a focused reading app, but VoiceOver users will find many unlabeled elements.
- **VoiceOver:** Many interactive elements (verse cards, surah tiles, prayer time cards) lack `aria-label` or descriptive text. VoiceOver would read raw text content without context ("Fajr 5:42 AM" vs "Fajr prayer at 5:42 AM, next prayer in 3 hours").

#### What to do

1. **Add `@media (prefers-reduced-motion: reduce)` block** in `App.css`:
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important;
     }
   }
   ```
2. **Audit VoiceOver labels** on key interactive elements:
   - Prayer time cards → `aria-label="Fajr at 5:42 AM"`
   - Verse cards → `aria-label="Surah Al-Fatiha, verse 1"`
   - Surah browse tiles → `aria-label="Surah Al-Baqarah, 286 verses"`
   - Streak counter → `aria-label="Reading streak: 12 days"`
   - Mic button states → already have `aria-label` ✅
3. **Color contrast audit:** the emerald-on-dark theme likely passes WCAG AA, but verify the gold accent (`#f4d175`) on dark emerald has sufficient contrast for small text
4. **Focus indicators:** `App.css` line 2962 has `[role="button"]:focus-visible` — verify this applies to all focusable elements on iPad with a hardware keyboard

#### Validation

- [ ] Turn on VoiceOver on iPad → navigate through Home, Quran, Settings → every interactive element has a meaningful spoken label
- [ ] Enable "Reduce Motion" in iOS Settings → Accessibility → verify animations stop
- [ ] `grep -n 'prefers-reduced-motion' src/App.css` returns at least 1 match
- [ ] (Optional) Run Apple's Accessibility Inspector on the app

#### Spin-out: `PLAN-030`

---

### 3.2 — AUDIT: Dark mode / system color scheme

**Severity:** 🟢 LOW — the app is intentionally dark-themed
**Effort:** 30 min (decision + potential CSS)
**Files:** `src/App.css` (if any changes)

#### Current state

Zero matches for `prefers-color-scheme` in CSS. The app is permanently dark-themed (emerald background, cream text). This is a deliberate design choice — the app is used in masjids and for early-morning Fajr, where a light theme would be disruptive.

#### Decision needed

- **Option A (keep dark-only):** No changes needed. The app ignores the system light/dark setting. This is fine — many apps (like most Quran apps) are dark-only. But App Store review may ask about it.
- **Option B (respect system theme):** Add a `@media (prefers-color-scheme: light)` block with a light variant (white background, dark text, green accents). This is more work but gives users the choice.

#### Recommendation

**Option A for now.** The app is designed for dark environments. Adding a light theme is a Phase 5+ feature. But add this to the app's privacy/auxiliary metadata in App Store Connect so reviewers know it's intentional.

#### Spin-out: Not needed (decision only — no code change for Option A)

---

### 3.3 — VERIFY: iPad layout (600px wide rules, display:contents, font scaling)

**Severity:** 🟡 MEDIUM
**Effort:** 20 min manual test on iPad
**Files:** None (verification only)

#### What to verify

Per NOOR_IOS.md §9.3, the app has specific wide-screen (iPad) layout rules:
- `min-width: 600px` triggers single-column layout
- `browseScale = 1.45` (larger fonts on iPad)
- `.browse-body { display: contents }` (critical — removing it breaks scrolling)
- Maktaba uses a two-panel layout on wide screens

#### Test procedure

1. On iPad (any orientation):
   - Open Quran → Read → verify verses render at the larger scale
   - Scroll through a surah → verify smooth scrolling (if janky, `display: contents` may have been removed)
2. Open Maktaba → verify the search panel is on the left and results on the right
3. Open Quran → Mushaf → verify the Arabic-only flowing page renders at the larger scale
4. Open Quran → Goals → verify the goal reader renders at the larger scale
5. Rotate the iPad → verify layout adapts (no broken layouts in landscape vs portrait)

#### Common iPad-specific issues

- **Tab bar too wide:** the 5-tab bottom nav should still be centered, not stretched edge-to-edge
- **Card padding too large:** tiles should have reasonable padding, not 100px gutters
- **Text too large:** the 1.45× scale is for Arabic/verse text; UI text should stay at normal size
- **Modal sizing:** modals (Analyze, Hadith detail) should be centered with reasonable max-width

#### Spin-out: `PLAN-031`

---

### 3.4 — VERIFY: Safe areas on notched iPhone

**Severity:** 🟡 MEDIUM
**Effort:** 10 min manual test (requires a notched iPhone)
**Files:** None (verification only)

#### Current state

CSS already has `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` in multiple places:
- Line 81: `padding-top: calc(14px + env(safe-area-inset-top, 0px))`
- Line 729: `padding-bottom: env(safe-area-inset-bottom, 0px)`
- Line 759: `padding: 0 0 env(safe-area-inset-bottom, 0px)`
- Line 2410: `padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px))`
- Line 3335: `padding: 20px 16px calc(20px + env(safe-area-inset-bottom))`
- Line 3692: `padding: 16px 14px calc(20px + env(safe-area-inset-bottom))`

`capacitor.config.json` has `contentInset: "never"` so CSS `env()` is the single source of truth. This looks correct, but needs device verification.

#### Test procedure

1. Build and install on a notched iPhone (iPhone 14+ with Dynamic Island, or iPhone X+ with notch)
2. Open the app → check Home tab:
   - Header doesn't overlap the notch/Dynamic Island
   - Bottom tab bar doesn't overlap the home indicator
3. Open Quran → Read → scroll through verses → check the bottom isn't hidden behind the tab bar
4. Open Settings → scroll to the bottom → check the last setting isn't hidden
5. Open Khutbah → check the mic button area isn't hidden behind the home indicator

#### If no iPhone is available

iPad has no notch, so safe areas are minimal. This test **requires a notched iPhone**. If none is available, defer to TestFlight external testing (family members with iPhones will surface it).

#### Spin-out: `PLAN-032`

---

### 3.5 — CLEANUP: Minor code quality items

**Severity:** 🟢 LOW
**Effort:** 15 min total
**Files:** `src/PrayerLocationSettings.jsx`, `src/App.jsx`, `src/QuranMode.jsx`

#### 3.5a — Remove unused `NoorWidget` import

**File:** `src/PrayerLocationSettings.jsx`, line 6

```js
import { NoorWidget } from './plugins/NoorWidget'  // ← unused, all usages removed
```

All `NoorWidget` usages (the `exactAllowed` state, `canScheduleExactAlarms` check, the "Allow exact alarms" banner) were removed from this file, but the import remains.

#### 3.5b — Fix empty `<h2>` title in ReadyModal

**File:** `src/App.jsx`, `ReadyModal` component

```jsx
<h2 className="ready-title"></h2>  // ← empty, should say something
```

Suggest: `"Ready to Begin"` or `"Before You Start"`.

#### 3.5c — Fix stale `dbg` closure in `handleResult`

**File:** `src/QuranMode.jsx`, `handleResult` callback

```js
const handleResult = useCallback(({ text: rawText }) => {
    // ... calls dbg() ...
}, [])  // ← empty deps, captures initial dbg forever
```

`handleResult` has `[]` deps but calls `dbg`, which depends on `showDetectDebug`. Fix: add `dbg` to the dependency array: `[dbg]`.

#### Validation

- [ ] `npm run build` succeeds
- [ ] `grep -n 'NoorWidget' src/PrayerLocationSettings.jsx` returns 0
- [ ] `grep -n 'ready-title' src/App.jsx` shows non-empty content
- [ ] `grep -A1 'handleResult.*useCallback' src/QuranMode.jsx` shows `[dbg]` in deps

#### Spin-out: `PLAN-033`

---

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### TIER 4 — TESTFLIGHT & RELEASE
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

---

### 4.1 — TestFlight external testing setup

**Severity:** 🟠 HIGH — this is how the family gets the app
**Effort:** 1-2 hours (archive + upload + TestFlight setup)
**Files:** None (build/distribution task)

#### Prerequisites (all must be done first)

- [ ] Item 1.1 (armv7 removal) — App Store will reject without this
- [ ] Item 1.2 (deployment target bump) — widget won't compile without this
- [ ] Item 1.3 (widget target in pbxproj) — widget won't ship without this
- [ ] Item 1.4 (streak crash fix) — family will hit this on day 1
- [ ] Item 2.1 (crash reporting) — otherwise crashes are invisible
- [ ] Apple Developer Program membership ($99/yr) — confirm it's active
- [ ] App Store Connect access for `com.ali.noor`

#### Step-by-step

1. **Archive the app:**
   ```bash
   npm run build && npx cap sync ios
   # In Xcode: Product → Archive (must be a "Generic iOS Device" target, not a specific device)
   ```

2. **Upload to App Store Connect:**
   - Xcode Organizer → select the archive → Distribute App → App Store Connect → Upload
   - OR via CLI: `xcrun altool --upload-app -f <path-to-ipa> --type ios --apiKey <key> --apiIssuer <issuer>`

3. **Configure TestFlight:**
   - App Store Connect → Noor → TestFlight tab
   - Add external testing group: "Family"
   - Add family members' email addresses as external testers
   - Set the build to "Active" for testing
   - Fill in the required TestFlight information (what to test, etc.)

4. **First-time App Store Connect setup:**
   - May need to fill in app privacy details ("data not collected" for Noor)
   - May need export compliance information
   - May need to wait for Apple's first build review (usually 24-48 hours for the first external TestFlight build)

5. **Tester instructions:**
   - Install TestFlight app from App Store
   - Open the invite link on their iPhone/iPad
   - Install Noor
   - Test the checklist from NOOR_IOS.md §15

#### Also consider

- **Remove `UIBackgroundModes: location`** from Info.plist before upload — the app only does foreground one-shot geolocation, and having `location` in background modes without using it will trigger review questions. Keep `audio` only.
- **App Store screenshots:** need at least one screenshot per device family (iPhone 6.7", iPhone 6.5", iPad 12.9"). Use Xcode's screenshot tool or fastlane snapshot.
- **App Store description:** write a clear description focusing on offline-first Quran/hadith/khutbah features.

#### Spin-out: `PLAN-034`

---

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### TIER 5 — FUTURE / PHASE 5+
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

---

### 5.1 — Investigate `@objc(SpeechRecognition)` symbol in linked binary

**Severity:** 🟡 MEDIUM — determines whether AppleSTT can ever work natively on iOS
**Effort:** 15 min (terminal commands, no code change)
**Files:** None (investigation only)

#### What to verify

The open item from PLAN-004 / `docs/noor-ios-bugfix-2026-07-11.md`:

> **Plugin-side root cause (`+load` constructor pull)** — still unverified. `nm CapApp-SPM.o | grep SpeechRecognition` would confirm whether the `@objc(SpeechRecognition)` symbol is in the linked binary.

#### Test procedure

```bash
# Build the app first
npm run build && npx cap sync ios

# Find the compiled CapApp-SPM object
find ios/DerivedData -name "CapApp-SPM.o" -path "*/arm64/*" 2>/dev/null | head -1

# Check for the SpeechRecognition symbol
nm <path-to-CapApp-SPM.o> | grep -i SpeechRecognition

# Compare against a known-good plugin (e.g. CapacitorGeolocation)
nm <path-to-CapApp-SPM.o> | grep -i Geolocation
```

#### Decision tree

- **If symbol IS present:** the ObjC constructor is linked but not called at runtime. File an issue with `@capacitor-community/speech-recognition`.
- **If symbol is NOT present:** the linker is stripping it. The durable fix is either (a) upstream single-target `Package.swift`, or (b) a different SPM packaging approach.
- **Either way:** the runtime fallback (PLAN-004) is the durable answer for now.

#### Spin-out: `PLAN-035`

---

### 5.2 — File upstream issue for `@capacitor-community/speech-recognition`

**Severity:** 🟡 MEDIUM — helps the community + potentially fixes our AppleSTT path
**Effort:** 30 min (write + file the issue)
**Files:** None (external)

#### What to file

File an issue on `github.com/capacitor-community/speech-recognition` requesting:
1. A single-target SPM `Package.swift` that doesn't require the dual-target split workaround (`scripts/inject-speech-recognition-spm.mjs`)
2. Confirmation that the `CAP_PLUGIN` ObjC macro's `+load` constructor is properly linked in SPM-only projects

Include:
- Our `Package.swift` split workaround (reference `scripts/inject-speech-recognition-spm.mjs`)
- The `nm` output from item 5.1
- The runtime error: "SpeechRecognition plugin is not implemented on iOS"
- Our fallback solution (PLAN-004) as a workaround for others

#### Spin-out: `PLAN-036`

---

### 5.3 — Sherpa on-device STT for iOS (optional, Phase 5)

**Severity:** 🟢 FUTURE — nice-to-have for offline mode
**Effort:** Days (C API binding + model download + integration)
**Files:** New Swift plugin, `src/plugins/SherpaSTT.ts` (replace stub)

#### What this enables

Currently iOS has **no offline STT** — if the internet is down, Detect mode and Khutbah translation don't work. Sherpa-onnx has iOS support via its C API, and the same model files (§13 of NOOR_IOS.md) would be used.

#### What it would take

1. Create a Swift wrapper around `sherpa-onnx` C API (similar to `SherpaSTTManager.java` on Android)
2. Package as a Capacitor plugin (SPM-compatible, single-target if possible)
3. Model download UI — the same "One-time setup" flow already exists in `QuranMode.jsx`
4. Replace the `SherpaSTT.ts` stub with a real iOS implementation
5. Unhide "Local" engine in Settings (currently hidden on iOS via `IS_IOS` check)

#### When to do this

Only after TestFlight is shipping and there's a real need for offline mode.

#### Spin-out: `PLAN-037` (when ready)

---

### 5.4 — Additional features from Android parity gap

**Severity:** 🟢 FUTURE — feature parity items not yet on iOS
**Effort:** Varies
**Files:** Various

#### Features on Android not yet on iOS

1. **Tasbih counter** (`Khutbah/src/components/Tasbih.jsx`) — digital tasbih counter with preset dhikr
2. **Daily deed scorecard** (`Khutbah/src/components/DailyDeedScorecard.jsx`) — daily good-deed tracker
3. **AI Assistant** (`Khutbah/src/AIAssistant.jsx`) — chat with an AI imam
4. **PrayerTimes component** (`Khutbah/src/PrayerTimes.jsx`) — dedicated prayer times view with azan playback
5. **Azan library** (`Khutbah/src/utils/azanLibrary.js`) — audio azan playback at prayer times
6. **Verse card sharing** (`Khutbah/src/utils/verseCard.js`) — share a verse as a styled image card
7. **Imam AI** (`Khutbah/src/utils/imam.js`) — ask-an-imam feature
8. **Whisper prompt corpus** (`Khutbah/src/utils/whisperPrompt.js`) — enhanced offline STT prompts

#### Priority order (if the family requests them)

1. Tasbih counter (simple, self-contained, high value)
2. Verse card sharing (simple, high value for family sharing)
3. AI Assistant (requires backend `/api/chat` — check if it exists)
4. Daily deed scorecard (simple, self-contained)
5. Azan playback (requires audio assets + timing logic — more complex)

#### Spin-out: Individual `PLAN-NNN` per feature when ready

---

### 5.5 — FIX: `UIBackgroundModes: location` removal

**Severity:** 🟡 MEDIUM — potential App Store review question
**Effort:** 1 line in Info.plist
**Files:** `ios/App/App/Info.plist`

#### Root Cause

Info.plist includes both `audio` and `location` in `UIBackgroundModes`:
```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
    <string>location</string>
</array>
```

The app only does foreground one-shot geolocation (per NOOR_IOS.md: "Foreground one-shot only"). Having `location` in background modes without actually using background location updates will trigger App Store review questions: "Why does your app need background location?"

#### Fix

Remove the `<string>location</string>` line, leaving only `audio`:
```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
</array>
```

#### When to do this

Before TestFlight upload (item 4.1) to avoid review questions.

#### Spin-out: Can be bundled with item 1.1 (Info.plist cleanup) under `PLAN-019`

---

### 5.6 — FIX: `.gitignore` doesn't match `Khutbah/` directory (262MB accidental commit risk)

**Severity:** 🟡 MEDIUM — accidental commit of 262MB would bloat the repo permanently
**Effort:** 1 line in `.gitignore`
**Files:** `.gitignore`

#### Root Cause

The `.gitignore` has this pattern at line 50:
```
Khutbah-*/
```
This matches directories like `Khutbah-aliandroidv2/` (with a hyphen) but NOT `Khutbah/` (no hyphen). The `Khutbah/` directory is **262MB** and contains the full Android app source, whisper.cpp, node_modules, etc.

Currently `Khutbah/` is not tracked by git (verified: `git ls-files Khutbah/` returns 0 files). But a careless `git add .` or `git add -A` would stage all 262MB into the index. Once committed, the `.git` directory grows permanently even if later removed (git history retains the blobs).

Similarly, `Khutbah-aliandroidv2.zip` (2.9MB) is not explicitly gitignored — the `Khutbah-*/` pattern matches it as a file prefix, but it's fragile.

#### Fix

Add explicit patterns to `.gitignore`:
```
# Android source copy + zip — 262MB, not needed for iOS build
Khutbah/
Khutbah*.zip
```

Place these right before or after the existing `Khutbah-*/` line.

#### Validation

- [ ] `git check-ignore Khutbah/` returns the path (confirming it's ignored)
- [ ] `git check-ignore Khutbah-aliandroidv2.zip` returns the path
- [ ] `git status` shows no Khutbah/ files in untracked list

#### Spin-out: `PLAN-025` (bundle with CocoaPods cleanup — both are repo hygiene)

---

### 5.7 — ADD: Privacy policy (App Store requirement)

**Severity:** 🔴 CRITICAL — App Store will not accept the listing without it
**Effort:** 1-2 hours (write + host)
**Files:** New file (e.g. `public/privacy-policy.html` or a GitHub Pages page)

#### Root Cause

App Store Connect requires a privacy policy URL for every app. No privacy policy file exists anywhere in the project — not in `src/`, not in `public/`, not in `README.md`, not in `docs/`. Zero matches for "privacy" in the codebase (except in third-party dependency licenses under `Khutbah/node_modules/`).

#### What the privacy policy should cover

Noor collects minimal data:
- **Device ID** (a `crypto.randomUUID()` stored in localStorage) — used for history, streak, and quota scoping
- **Location** — one-shot GPS for prayer times/Qibla, never stored or transmitted
- **Audio** — streamed to ElevenLabs for transcription, never stored
- **Cloudflare D1** — khutbah history, streak data, analysis cache (all scoped by device_id)
- **No personal data** — no name, email, phone, or account required (family circles use a display name + invite code, but no email collection)

The policy should state:
1. What data is collected (device ID, optional display name for circles)
2. What data is NOT collected (no email, no phone, no precise location storage)
3. How audio is processed (streamed to ElevenLabs for transcription, not stored)
4. Third-party services (Cloudflare, ElevenLabs, Anthropic Claude for AI analysis)
5. User rights (all data is deletable from within the app: Settings → Clear History)

#### Hosting options

- **Option A (simplest):** Add `public/privacy-policy.html` to the project — Vite copies it into `dist/`, and it's accessible at `https://khutbah-v2.pages.dev/privacy-policy.html` (the existing Cloudflare Pages deployment). Use this URL in App Store Connect.
- **Option B:** Create a GitHub Pages page in the repo.
- **Option C:** Use a free privacy policy generator and host the result.

**Recommend Option A** — it's already deployed via the existing Cloudflare Pages setup.

#### Validation

- [ ] `public/privacy-policy.html` exists and renders in a browser
- [ ] `https://khutbah-v2.pages.dev/privacy-policy.html` returns 200
- [ ] App Store Connect "App Privacy" section is filled in ("Data Not Collected" for most categories, "Diagnostics" = "Usage Data" for the /api/log endpoint)
- [ ] Privacy policy URL is entered in App Store Connect

#### Spin-out: `PLAN-038`

---

### 5.8 — ADD: `UISupportsMultiWindows` for iPad multitasking

**Severity:** 🟡 MEDIUM — iPad layout may break in Split View without it
**Effort:** 3 lines in Info.plist
**Files:** `ios/App/App/Info.plist`

#### Root Cause

`UISupportsMultiWindows` is not present in Info.plist. Since iOS 13, Apple requires this key for iPad apps to support Split View and Slide Over multitasking. Without it:
1. The app may be forced into a compact width in Split View, breaking the 600px wide layout rules (§9.3 of NOOR_IOS.md)
2. Apple may flag it during App Store review as not supporting iPad multitasking

Note: the `UISupportedInterfaceOrientations~ipad` array already includes all 4 orientations, which is good.

#### Fix

Add to Info.plist:
```xml
<key>UISupportsMultiWindows</key>
<true/>
```

Or if you want to opt out (not recommended for iPad):
```xml
<key>UISupportsMultiWindows</key>
<false/>
```

**Recommend `true`** — the app's 600px layout rules already handle wide screens. Split View at 50% on a 12.9" iPad gives ~512px which is under the 600px breakpoint — the app would show the narrow layout, which is correct.

#### Validation

- [ ] `plutil -lint ios/App/App/Info.plist` passes
- [ ] `grep -n 'UISupportsMultiWindows' ios/App/App/Info.plist` returns 1
- [ ] On iPad: open Noor in Split View with another app → app renders correctly at the narrower width

#### Spin-out: Bundle with `PLAN-019` (Info.plist cleanup)

---

### 5.9 — ADD: macOS CI runner for iOS build verification

**Severity:** 🟡 MEDIUM — catches Xcode build breaks before they reach the Mac
**Effort:** 1-2 hours (add job to workflow, test)
**Files:** `.github/workflows/tests.yml`

#### Current state

The CI workflow (`.github/workflows/tests.yml`) runs on `ubuntu-latest` and only executes the Node test harnesses. It never builds the iOS app. This means:
- A JS change that breaks the Xcode build (e.g. invalid import, missing dependency) is not caught until someone manually runs `xcodebuild` on a Mac
- The pbxproj can be corrupted by a `cap sync` without anyone noticing

#### What to add

Add a second job to the workflow that runs on `macos-14` or `macos-15`:
```yaml
  ios-build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npx cap sync ios
      - run: xcodebuild -workspace ios/App/App.xcworkspace -scheme App -destination 'generic/platform=iOS' -configuration Debug CODE_SIGNING_ALLOWED=NO
```

Note: `CODE_SIGNING_ALLOWED=NO` skips signing (no developer cert on CI). This verifies the code compiles and links, which is the main value.

#### Considerations

- macOS runners are 10× more expensive than Linux on GitHub Actions (free tier: 2000 min/month for private repos, but macOS minutes count as 10×). A single `xcodebuild` takes ~5-10 min = 50-100 billable minutes per run.
- Consider only running the iOS build job on PRs to `NoorAliIOS`, not on every push to every branch.
- Alternatively, run it only when `ios/`, `src/`, `package.json`, or `capacitor.config.json` files change (use `paths` filter).

#### Validation

- [ ] The `ios-build` job succeeds on a test PR
- [ ] A deliberate build-breaking change (e.g. invalid Swift syntax) causes the job to fail

#### Spin-out: `PLAN-039`

---

### 5.10 — DOCUMENT: `cap sync` overwrite prevention strategy

**Severity:** 🟠 HIGH — this is the root cause of the widget target disappearing
**Effort:** 30 min (document + implement prevention)
**Files:** `docs/WORKFLOW.md`, potentially a new script

#### Root Cause

The widget extension target was likely lost during a `npx cap sync ios` call. Capacitor's `sync` command regenerates parts of the Xcode project, and manual target additions (like the widget extension) can be overwritten.

This is a **process risk** that will happen again unless explicitly prevented.

#### Prevention strategies

**Strategy A (document-only):** Add a warning to `docs/WORKFLOW.md`:
```
⚠️ After running `npx cap sync ios`, ALWAYS verify the NoorWidgetExtension target
   is still in project.pbxproj: `grep -c NoorWidgetExtension ios/App/App.xcodeproj/project.pbxproj`
   If it returns 0, the target was overwritten — re-add it in Xcode.
```

**Strategy B (script guard):** Create a `scripts/verify-ios-targets.mjs` script that checks for the widget extension target and exits non-zero if it's missing. Run it as a `postcap sync` npm hook or manually after every sync.

**Strategy C (git pre-commit hook):** A pre-commit hook that rejects commits where `project.pbxproj` lost the `NoorWidgetExtension` references.

**Recommend Strategy A + B** — document the risk and add a verification script. Strategy C is nice but requires hook setup on every dev machine.

#### Validation

- [ ] `docs/WORKFLOW.md` has the warning
- [ ] `scripts/verify-ios-targets.mjs` exists and exits 0 when the target is present
- [ ] The script exits non-zero when the target is missing (test by temporarily removing it)

#### Spin-out: `PLAN-040`

---

**Severity:** 🟡 MEDIUM — potential App Store review question
**Effort:** 1 line in Info.plist
**Files:** `ios/App/App/Info.plist`

#### Root Cause

Info.plist includes both `audio` and `location` in `UIBackgroundModes`:
```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
    <string>location</string>
</array>
```

The app only does foreground one-shot geolocation (per NOOR_IOS.md: "Foreground one-shot only"). Having `location` in background modes without actually using background location updates will trigger App Store review questions: "Why does your app need background location?"

#### Fix

Remove the `<string>location</string>` line, leaving only `audio`:
```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
</array>
```

#### When to do this

Before TestFlight upload (item 4.1) to avoid review questions.

#### Spin-out: Can be bundled with item 1.1 (Info.plist cleanup) under `PLAN-019`

---

## SUMMARY — Priority Order

| Order | Item | Tier | Effort | Severity | Spin-out |
|---|---|---|---|---|---|
| 1 | Remove `armv7` from UIRequiredDeviceCapabilities | 1 | 2 lines | 🔴 Critical | PLAN-019 |
| 2 | Bump deployment target to 16.0 in pbxproj | 1 | 4 lines | 🔴 Critical | PLAN-020 |
| 3 | Add widget extension target to Xcode project | 1 | 30-60 min | 🔴 Critical | PLAN-021 |
| 4 | Fix `dayBeforeYesterdayStr()` crash | 1 | 1 line | 🔴 Critical | PLAN-022 |
| 5 | Remove `UIBackgroundModes: location` | 1 | 1 line | 🟡 Medium | PLAN-019 |
| 6 | Add `UISupportsMultiWindows` for iPad | 1 | 3 lines | 🟡 Medium | PLAN-019 |
| 7 | Fix streak grace-period mismatch | 1 | 3 lines | 🟠 High | PLAN-023 |
| 8 | Remove stale CocoaPods flag | 1 | 1 line | 🟡 Medium | PLAN-025 |
| 9 | Fix SherpaSTT listener accumulation | 1 | 2 lines | 🟡 Medium | PLAN-024 |
| 10 | Fix `.gitignore` for `Khutbah/` directory | 1 | 1 line | 🟡 Medium | PLAN-025 |
| 11 | Add crash reporting (Sentry) | 2 | 1-2 hrs | 🟠 High | PLAN-026 |
| 12 | Verify background audio on device | 2 | 15 min | 🟠 High | PLAN-027 |
| 13 | Verify notifications fire on device | 2 | 30 min | 🟠 High | PLAN-028 |
| 14 | Verify Qibla compass on device | 2 | 10 min | 🟡 Medium | PLAN-029 |
| 15 | Privacy policy (App Store requirement) | 2 | 1-2 hrs | 🔴 Critical | PLAN-038 |
| 16 | Accessibility audit (VoiceOver, reduced motion) | 3 | 2-3 hrs | 🟡 Medium | PLAN-030 |
| 17 | iPad layout verification | 3 | 20 min | 🟡 Medium | PLAN-031 |
| 18 | Verify safe areas on notched iPhone | 3 | 10 min | 🟡 Medium | PLAN-032 |
| 19 | Minor code cleanup | 3 | 15 min | 🟢 Low | PLAN-033 |
| 20 | Document `cap sync` overwrite prevention | 3 | 30 min | 🟠 High | PLAN-040 |
| 21 | TestFlight external testing setup | 4 | 1-2 hrs | 🟠 High | PLAN-034 |
| 22 | macOS CI runner for iOS build verification | 4 | 1-2 hrs | 🟡 Medium | PLAN-039 |
| 23 | Investigate SpeechRecognition symbol | 5 | 15 min | 🟡 Medium | PLAN-035 |
| 24 | File upstream speech-recognition issue | 5 | 30 min | 🟡 Medium | PLAN-036 |
| 25 | Sherpa on-device STT (Phase 5) | 5 | Days | 🟢 Future | PLAN-037 |
| 26 | Additional feature parity items | 5 | Varies | 🟢 Future | Per-feature |

---

## RECOMMENDED SESSION SEQUENCE

### Session 1 — Info.plist + pbxproj + .gitignore fixes (on the Mac, no device needed, ~45 min)

**Items 1, 2, 5, 6, 8, 10** — all are config file edits:
- Remove `armv7` from `UIRequiredDeviceCapabilities` (item 1.1)
- Bump `IPHONEOS_DEPLOYMENT_TARGET` to 16.0 (item 1.2)
- Remove `location` from `UIBackgroundModes` (item 5.5)
- Add `UISupportsMultiWindows` for iPad multitasking (item 5.8)
- Remove stale `COCOAPODS` flag from `OTHER_SWIFT_FLAGS` (item 1.7)
- Fix `.gitignore` to explicitly ignore `Khutbah/` and `Khutbah*.zip` (item 5.6)
- Run `npm run build && npx cap sync ios && xcodebuild … DEVELOPMENT_TEAM=89RUQ4H8S5`
- Verify `** BUILD SUCCEEDED **`

### Session 2 — Widget target + JS bug fixes (on the Mac, no device needed, ~75 min)

**Items 3, 4, 6, 8:**
- Add the NoorWidgetExtension target in Xcode (item 1.3) — this is the most involved task
- Fix `dayBeforeYesterdayStr()` crash (item 1.4)
- Fix streak grace-period mismatch (item 1.5)
- Fix SherpaSTT listener accumulation (item 1.6)
- Run `npm run build` and `node --check src/utils/streak.js`
- Build and verify the `.appex` appears in `PlugIns/`

### Session 3 — Crash reporting + privacy policy + device verification (on the Mac + iPad, ~2.5 hrs)

**Items 11, 12, 13, 14, 15, 20:**
- Integrate Sentry crash reporting (item 2.1)
- Write privacy policy `public/privacy-policy.html` (item 5.7)
- Document `cap sync` overwrite prevention in WORKFLOW.md (item 5.10)
- Build, install on iPad
- Test background audio with screen lock (item 2.2)
- Test notifications firing (item 2.3)
- Test Qibla compass permission flow (item 2.4)

### Session 4 — Polish + TestFlight + CI (on the Mac, ~3.5 hrs)

**Items 16, 17, 18, 19, 21, 22:**
- Accessibility audit (item 3.1)
- iPad layout verification (item 3.3)
- Safe areas on notched iPhone — only if an iPhone is available (item 3.4)
- Minor code cleanup (item 3.5)
- Archive + upload to TestFlight (item 4.1) — fill in App Store metadata, privacy details, screenshots
- Add macOS CI runner for iOS build verification (item 5.9)

### Session 5 — Future (when needed)

**Items 18, 19, 20, 21:**
- `nm` investigation (item 5.1)
- File upstream issue (item 5.2)
- Sherpa iOS STT (item 5.3)
- Feature parity (item 5.4)

---

## DEPENDENCIES

```
Item 1 (armv7 removal)          ──→ no dependencies, do first
Item 2 (deployment target bump) ──→ no dependencies (do with item 1)
Item 5 (remove location bg mode)──→ no dependencies (do with item 1)
Item 7 (CocoaPods flag cleanup) ──→ no dependencies (do with item 1)
Item 3 (widget target in Xcode) ──→ depends on Item 2 (deployment target must be 16+ for widget APIs)
Item 4 (streak crash fix)       ──→ no dependencies (JS only)
Item 6 (grace period fix)       ──→ depends on Item 4 decision (Option A vs B)
Item 8 (SherpaSTT fix)          ──→ no dependencies (JS only, latent on iOS)
Item 9 (crash reporting)        ──→ no dependencies (but do before TestFlight)
Item 10 (background audio test) ──→ needs iPad + successful build (after items 1-3)
Item 11 (notifications test)    ──→ needs iPad + build (can run in parallel with 10)
Item 12 (Qibla test)            ──→ needs iPad + build (can run in parallel with 10/11)
Item 13 (accessibility audit)   ──→ no dependencies (can start anytime)
Item 14 (iPad layout test)      ──→ needs iPad (can run in parallel with 10/11/12)
Item 15 (safe areas test)       ──→ needs notched iPhone (can be part of TestFlight)
Item 16 (minor cleanup)         ──→ no dependencies (JS only)
Item 10 (gitignore fix)        ──→ no dependencies (do with item 1)
Item 15 (privacy policy)        ──→ no dependencies (do before TestFlight)
Item 20 (cap sync prevention)   ──→ depends on Item 3 (widget target re-added)
Item 21 (TestFlight)            ──→ depends on Items 1-10 being verified + Item 15 (privacy policy)
Item 22 (macOS CI)              ──→ depends on Item 3 (widget target, or CI will fail)
Item 23 (nm investigation)      ──→ needs Mac + built binary
Item 24 (upstream issue)        ──→ depends on Item 23 results
Item 25 (Sherpa iOS)            ──→ depends on Item 21 (TestFlight shipping) + Item 23
Item 26 (feature parity)        ──→ depends on Item 21 (TestFlight shipping)
```

---

## KEY CORRECTIONS FROM v1 → v2

| What v1 said | What v2 found | Impact |
|---|---|---|
| Widget "✅ Shipped" | Widget extension target is **not currently in pbxproj** — likely lost during a `cap sync` (PLAN-007 fixed an install error with it, so it was compiled at some point) | Widget does not appear on home screen. This is a 30-60 min Xcode task, not "done". |
| Deployment target "bumped to 16.0 (PLAN-002)" | All 4 pbxproj occurrences are still **15.0** | PLAN-002 was never applied or was reverted. Widget won't compile at 15.0. |
| (not mentioned) | `UIRequiredDeviceCapabilities: armv7` in Info.plist | App Store rejection risk. Must remove before upload. |
| (not mentioned) | `CocoaPods` flag in `OTHER_SWIFT_FLAGS` | Stale leftover. Confusing but harmless. |
| (not mentioned) | No crash reporting (Sentry/Crashlytics/Firebase) | TestFlight crashes will be invisible. |
| (not mentioned) | `UIBackgroundModes: location` without background location use | App Store review question. |
| (not mentioned) | `contentMarginsDisabled()` in widget requires iOS 17+ | Need `#available` guard or bump to 17.0. |
| (not mentioned) | `AppDelegate.swift` already has correct AVAudioSession setup | Item 2.2 is verification-only, not a fix. |
| (not mentioned) | Accessibility: no `prefers-reduced-motion`, limited VoiceOver labels | App Store may flag; ethical concern. |
| (not mentioned) | `Khutbah/` directory (262MB) not properly gitignored | Accidental `git add .` would permanently bloat the repo. |
| (not mentioned) | No privacy policy file | App Store requires a privacy policy URL. Must create before TestFlight. |
| (not mentioned) | No `UISupportsMultiWindows` in Info.plist | iPad multitasking may break layout; Apple may flag. |
| (not mentioned) | CI only runs on Ubuntu, no iOS build check | Xcode build breaks not caught until manual Mac build. |
| (not mentioned) | `cap sync` can overwrite manual pbxproj edits | This is the root cause of the widget target disappearing. Need prevention strategy. |
| (not mentioned) | No App Store metadata or screenshots | TestFlight needs description, screenshots, privacy details. |

---

## VERSION TABLE

| Surface | Status | Notes |
|---|---|---|
| This roadmap document (v2) | ✅ Created | PLAN-018 v2 — rewrote with deeper investigation |
| armv7 removal (Item 1) | ❌ Not started | PLAN-019 |
| Deployment target bump (Item 2) | ❌ Not started | PLAN-020 (supersedes original PLAN-002) |
| Widget target in pbxproj (Item 3) | ❌ Not started | PLAN-021 |
| Streak crash fix (Item 4) | ❌ Not started | PLAN-022 |
| Grace period fix (Item 6) | ❌ Not started | PLAN-023 |
| SherpaSTT listener fix (Item 8) | ❌ Not started | PLAN-024 |
| CocoaPods flag cleanup (Item 7) | ❌ Not started | PLAN-025 |
| Crash reporting / Sentry (Item 9) | ⚠️ STAGED | PLAN-026 — JS-side ✅ verified (privacy-first scrubbers wired); native-side STAGED in AppDelegate.swift awaiting Mac + Xcode UI install of `sentry-cocoa` via File → Add Packages → `https://github.com/getsentry/sentry-cocoa` → Add to App target. |
| Background audio verification (Item 10) | ❌ Not started | PLAN-027 |
| Notifications verification (Item 11) | ❌ Not started | PLAN-028 |
| Qibla verification (Item 12) | ❌ Not started | PLAN-029 |
| Accessibility audit (Item 13) | ❌ Not started | PLAN-030 |
| iPad layout verification (Item 14) | ❌ Not started | PLAN-031 |
| Safe areas verification (Item 15) | ❌ Not started | PLAN-032 |
| Minor code cleanup (Item 16) | ❌ Not started | PLAN-033 |
| TestFlight setup (Item 17) | ❌ Not started | PLAN-034 |
| SpeechRecognition nm investigation (Item 18) | ❌ Not started | PLAN-035 |
| Upstream issue filing (Item 19) | ❌ Not started | PLAN-036 |
| Sherpa iOS STT (Item 20) | ❌ Deferred | PLAN-037 (future) |
| Feature parity items (Item 21) | ❌ Deferred | Per-feature plans |
| Background location removal (Item 5) | ❌ Not started | Bundled with PLAN-019 |
| UISupportsMultiWindows (Item 6) | ❌ Not started | Bundled with PLAN-019 |
| Khutbah/ gitignore fix (Item 10) | ❌ Not started | Bundled with PLAN-025 |
| Privacy policy (Item 15) | ❌ Not started | PLAN-038 |
| macOS CI runner (Item 22) | ❌ Not started | PLAN-039 |
| cap sync overwrite prevention (Item 20) | ❌ Not started | PLAN-040 |
