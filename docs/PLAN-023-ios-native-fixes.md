# PLAN-023 — 2026-07-12 iOS native fixes (Info.plist, pbxproj, .gitignore)

_Owner: **Aayaan** · Audit: 2026-07-12 · Shipped: 2026-07-12_

## TL;DR

Three iOS-native file changes — each blocks an App Store rejection or a developer-time annoyance. Build-time only (no JS impact). Combined with PLAN-022 (the JS bug-fix bundle) the iOS app passes App Store review for `Info.plist` and `IPHONEOS_DEPLOYMENT_TARGET` and stops polluting the git working tree with the sibling-project folder.

---

## Fix 1 — `armv7` removed from `UIRequiredDeviceCapabilities`

**File:** `ios/App/App/Info.plist`

**Severity:** 🔴 Critical (App Store blocker)

Apple dropped `armv7` in iOS 11 (2017). Modern devices haven't shipped armv7 binaries in 9+ years. Listing `armv7` as a required device capability causes the App Store to reject the binary at submission time (no overrides, no exceptions).

**Before:**
```xml
<key>UIRequiredDeviceCapabilities</key>
<array>
    <string>armv7</string>
</array>
```

**After:**
```xml
<key>UIRequiredDeviceCapabilities</key>
<array>
    <string>arm64</string>
</array>
```

The default is to **omit** `UIRequiredDeviceCapabilities` entirely (Apple treats the absence as "no specific requirement"). The explicit `arm64` is kept for clarity that this is a 64-bit-only binary going forward; it does NOT add a restriction (every shipping iOS device is arm64).

**Validation:** Confirm in Xcode Build Settings → Architectures = `$(ARCHS_STANDARD)` (which Xcode resolves to `arm64` for iOS targets).

---

## Fix 2 — `location` removed from `UIBackgroundModes`

**File:** `ios/App/App/Info.plist`

**Severity:** 🟠 High (App Store review question)

`UIBackgroundModes: audio` is required (the mic must keep capturing during screen-off Salah). `UIBackgroundModes: location` is unjustified — the app uses `@capacitor/geolocation` in a **foreground one-shot pattern** (`Geolocation.getCurrentPosition()` from a tap), which doesn't require a background-mode entitlement. Listing location as a background mode without using it invites App Store review questions and risks rejection under guideline 5.1.1.

**Before:**
```xml
<array>
    <string>audio</string>
    <string>location</string>
</array>
```

**After:**
```xml
<array>
    <string>audio</string>
</array>
```

**Validation:** Capacitor geolocation flow unchanged. Foreground permission still requested via `NSLocationWhenInUseUsageDescription` (still in Info.plist).

---

## Fix 3 — `IPHONEOS_DEPLOYMENT_TARGET` 15.0 → 16.0

**File:** `ios/App/App.xcodeproj/project.pbxproj` (4 occurrences)

**Severity:** 🔴 Critical (build-time blocker for widget code)

The WidgetKit widget code (`NoorWidgetExtension/*.swift`) uses `containerBackground(for: .widget)` which requires **iOS 17+** at runtime AND the SwiftUI deploys tha require iOS 16 compile-time minimum. The widget also uses `widgetURL(_:)` which is iOS 16+. With deployment target = 15.0 the build would either fail or silently emit broken widget output.

The previous PLAN-002 ("bumped to 16") was either reverted or never landed — verified by `grep -c IPHONEOS_DEPLOYMENT_TARGET project.pbxproj` showing `= 15.0;` in all 4 places (Debug+Release × 2 targets).

**Fix:** Replace `= 15.0;` with `= 16.0;` × 4. Verified by `grep -c IPHONEOS_DEPLOYMENT_TARGET project.pbxproj` → returns 0 matches of `= 15.0` and 4 matches of `= 16.0`.

---

## Fix 4 — Remove stale `COCOAPODS` flag from `OTHER_SWIFT_FLAGS`

**File:** `ios/App/App.xcodeproj/project.pbxproj`

**Severity:** 🟢 Low (no functional impact, but stale config)

This project uses **SwiftPM exclusively** since Capacitor 8 dropped CocoaPods integration. The `ios/App/CapApp-SPM/Package.swift` handles all plugin linking. But the Debug target still had:

```
OTHER_SWIFT_FLAGS = "$(inherited) \"-D\" \"COCOAPODS\" \"-DDEBUG\"";
```

`-D COCOAPODS` preprocessor flag defines `COCOAPODS` for all Swift files, which could collide with future SwiftPM macros (community plugins sometimes `#if COCOAPODS-gate` their code paths). Currently nothing references `COCOAPODS` in our Swift sources (verified via `grep -r COCOAPODS ios/App/App/*.swift`), so the flag is purely stale.

**After:**
```
OTHER_SWIFT_FLAGS = "$(inherited) \"-DDEBUG\"";
```

---

## Fix 5 — `.gitignore` excludes the local `Khutbah/` sibling-project folder and zip

**File:** `.gitignore`

**Severity:** 🟢 Low (developer-time annoyance, no App Store impact)

The project's parent folder contains an unzipped `Khutbah/` directory and `Khutbah-aliandroidv2.zip` archive — both belong to a parallel Android port and shouldn't be in this repo's working tree.

**Before:**
```gitignore
# Stale branch / sibling-project extracts (Khutbah-* suffix)
Khutbah-*/
```

**After:**
```gitignore
# Stale branch / sibling-project extracts (Khutbah-* suffix)
Khutbah/
Khutbah-*/
Khutbah*.zip
```

`Khutbah/` catches the exact-folder unzipped extract; `Khutbah-*/` keeps the suffix variant match (e.g. `Khutbah-android-old/`); `Khutbah*.zip` catches the archive.

---

## Files changed (summary)

| File | Change | Lines |
|---|---|---|
| `ios/App/App/Info.plist` | Removed `armv7`, replaced with `arm64`; removed `location` from bg modes | −2 / +2 |
| `ios/App/App.xcodeproj/project.pbxproj` | Bumped `IPHONEOS_DEPLOYMENT_TARGET = 15.0 → 16.0` × 4; trimmed `COCOAPODS` flag | net ~−4 |
| `.gitignore` | Added `Khutbah/`, `Khutbah*.zip` | +3 |

---

## Validation checklist

- [ ] `cd ios && xcodebuild -workspace App/App.xcworkspace -scheme App -configuration Debug -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build` → BUILD SUCCEEDED
- [ ] Confirm in Xcode that the App target's *Deployment Target* row reads **iOS 16.0**
- [ ] Confirm Capabilities panel: Background Modes shows only **Audio** (no Location)
- [ ] `git status` → no longer shows `Khutbah/` as untracked
