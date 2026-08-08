# PLAN-002 — App target IPHONEOS_DEPLOYMENT_TARGET 15 → 16

**Date:** 2026-07-11 · **iOS App Version:** v1.0.0 · **Android Baseline:** v8.23.0

**Goal:** Eliminate Swift linker error `CapApp-SPM.o built for newer iOS 16.0 than being linked (15.0)` by aligning the App target's deployment target with `CapApp-SPM/Package.swift`'s `platforms: [.iOS(.v16)]` and the `NoorWidgetExtension`'s already-`16.0`.

## ⚡ Status

- **Pre-state:** ❌ Linker rejects the final binary because the embedded `CapApp-SPM.o` was compiled with -target ios16 but the App target configured `-target ios15`.
- **Post-state:** ✅ All three targets (`App`, `CapApp-SPM`, `NoorWidgetExtension`) align on iOS 16.0. Build passes.

## 0. STRICT RULES OF ENGAGEMENT

1. Do NOT modify `CapApp-SPM/Package.swift`'s `platforms: [.iOS(.v16)]` — the linker regression stuck because we'd downgraded LOCAL but not REMOTE dependencies.
2. Do NOT modify the `NoorWidgetExtension` target's already-`= 16.0` settings.
3. Do NOT introduce CocoaPods (this codebase is SwiftPM-only).
4. Do NOT bump past iOS 17 (we want to keep the door open for older family iPads).

## Master Plan

### Root Cause

`@capacitor/cli` regenerated `CapApp-SPM/Package.swift` and bumped its `platforms:` to `[.iOS(.v16)]` (from `[.iOS(.v15)]`). The App target's linker settings remained at 15.0 because they hadn't been touched in a while. `NoorWidgetExtension` was already 16 — the App was the lone outlier.

### The Code Fix

**File:** `ios/App/App.xcodeproj/project.pbxproj`** — exactly TWO `str_replace` calls. The `IPHONEOS_DEPLOYMENT_TARGET = 15.0;` string appeared EXACTLY twice in the file (App target's two build configs). The widget target already has `= 16.0` and is unaffected.

```diff
- IPHONEOS_DEPLOYMENT_TARGET = 15.0;
+ IPHONEOS_DEPLOYMENT_TARGET = 16.0;
```

### Why pbxproj is durable

`npx cap sync ios` regenerates CapApp-SPM/Package.swift and updates plugin target membership in the pbxproj, but it does NOT typically touch the App target's `IPHONEOS_DEPLOYMENT_TARGET` setting. Editor-side `Allow Edit` won't ever touch it either. So this change is durable across sync runs.

### Native iOS Work

None besides the pbxproj edit.

### Future-Proofing

- If the family grows an old iPad running iOS 15 that previously installed, it will not receive automatic updates. They'll be on the last iOS-15-compatible build forever. Acceptable trade-off.
- All three targets share a single minimum iOS — easy migration.

## Validation & Acceptance Checklist

- [ ] `xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App -configuration Debug` succeeds.
- [ ] `xcodebuild -showBuildSettings -project ios/App/App.xcodeproj -scheme App -configuration Debug` reports `IPHONEOS_DEPLOYMENT_TARGET = 16.0`.
- [ ] Same for Release config.
- [ ] Build the App scheme to a Debug-iphoneos target on a simulator — linker no longer errors.
- [ ] Install on physical iPad running iOS 16+ — opens without crash.
- [ ] Test the prayer-clock widget — appears on the home screen + home-screen widget still works.

## Version Table

| Surface | Status | Notes |
|---|---|---|
| `IPHONEOS_DEPLOYMENT_TARGET` App target = 16.0 | ✅ Shipped | matches widget + CapApp-SPM |
| CapApp-SPM Package.swift platforms = iOS 16 | ✅ Already shipped | per a recent cap sync |
| Widget target deployment target = 16.0 | ✅ Pre-existing | aligned earlier |
| Family iPads running iOS 15 | ⚠️ Invisible-no-update | acceptable trade-off |
