# PLAN-006 — Codesign "resource fork / Finder info / detritus" cleanup

**Date:** 2026-07-11 · **iOS App Version:** v1.0.0 · **Android Baseline:** v8.23.0

**Goal:** Unblock Xcode's codesign step for the `NoorWidgetExtensionExtension.appex` target. The build is currently failing with the canonical Apple toolchain error *"resource fork, Finder information, or similar detritus not allowed"*, because extended attributes (`com.apple.fileprovider.*`, `com.apple.provenance`, etc.) and possibly `._*` AppleDouble forks were stamped onto the widget extension's source files during prior copy/build cycles. Fix: strip them recursively, then wipe the stale Xcode DerivedData so codesign re-signs the freshly-stripped bundle.

---

## ⚡ LIVE PARITY STATUS

| Surface | Before | After |
|---|---|---|
| `npx cap run ios --target=<UDID>` → build → install → launch | ❌ `Command CodeSign failed … resource fork, Finder information, or similar detritus not allowed` | ✅ builds, installs, launches |
| `App.app` ends up on the iPad | ❌ n/a | ✅ /Applications bundle present |
| PLAN-005 toast-fix actually runs on the iPad | ❌ unverifiable (still in the dist bundle) | ✅ toast warnings dismiss cleanly without "state update on unmounted component" log |

---

## 0. STRICT RULES OF ENGAGEMENT

1. Do **NOT** wipe `Library/Developer/Xcode/iOS DeviceSupport/` or `Library/Developer/Xcode/UserData/`. Only the per-project DerivedData and the global SPM cache. Everything else is legal Xcode workspace state.
2. Do **NOT** delete `ios/`, `node_modules/`, or any source file. Only xattrs on sources and stale build artefacts.
3. Do **NOT** introduce CocoaPods — SwiftPM only (the codebase has been SwiftPM-only since the iOS port began).
4. Do **NOT** touch `.env.local`. Don't accidentally expose `VITE_APP_TOKEN`.
5. Do **NOT** bump `IPHONEOS_DEPLOYMENT_TARGET` below 16.0. We already aligned App + Widget + CapApp-SPM at iOS 16.0 (`PLAN-002`).
6. **Make this safe to rerun.** Every step MUST be idempotent — re-running should produce the same final state.

---

## Master Plan

### Root Cause

Apple's `codesign` tool rejects any input bundle file that carries:
- `com.apple.fileprovider.*` / `com.apple.provenance` / `com.apple.quarantine` extended attributes, OR
- Hidden `._*` AppleDouble resource-fork files alongside real files, OR
- Custom Finder-info bytes not part of a normal `Info.plist`.

**First-attempt miss (corrected):** I initially scoped the cleanup to only `ios/App/NoorWidgetExtension`, `ios/App/CapApp-SPM`, and `node_modules/@capacitor-community/speech-recognition` (the three source dirs whose compiled output links into App's binary). Build #2 still failed with `…/ios/DerivedData/00008030-0004348E34C0C02E/Build/Products/Debug-iphoneos/NoorWidgetExtensionExtension.appex: resource fork, Finder information, or similar detritus not allowed` — Xcode created a **project-local** DerivedData, NOT the standard `~/Library/Developer/Xcode/DerivedData/`. The first cleanup didn't touch that path. Corrected scope below.

### The Code Fix (corrected)

A clean-slate sequence in this strict order. Every wipe-style command uses `rm -rf` so it's safe to re-run (`set -e` omitted intentionally because SPM `.build/objects/pack/` is read-only).

```bash
# 1. Wipe every local + global Xcode build output
rm -rf ios/DerivedData
rm -rf ios/build
rm -rf ~/Library/Developer/Xcode/DerivedData/*
rm -rf ~/Library/Caches/org.swift.swiftpm
rm -rf ~/Library/org.swift.swiftpm
rm -rf ~/Library/Caches/com.apple.dt.Xcode/*

# 2. Strip extended attributes from ALL sources (covers widget ext, CapApp-SPM, App/, node_modules/, etc)
xattr -cr ios/ node_modules/

# 3. Aggressively destroy any `._*` AppleDouble metadata files
find ios node_modules -type f -name '._*' -delete

# 4. Re-build from clean slate (colder + slower than incremental; ~5-15 min)
npx cap run ios --target=00008030-0004348E34C0C02E
```

The 40-char UDID is the **xctrace-form** physical identifier Xcode uses internally. The newer `xcrun devicectl` UUID-format (`47CD612C-…`) gets rejected by Capacitor's run wrapper.

### Native iOS Work

None beyond the post-cleanup `cap run`. No Info.plist / entitlements / pbxproj / Swift changes.

### Future-Proofing

- Long-term: stop AppleDouble forks from entering the source tree at all — disable iCloud Drive's *Optimize Mac Storage* on the project root and avoid re-zipping from external editors that stamp xattrs.
- Optional next session: extend `scripts/ios-fix-pkg-cache.mjs` with a `--also-xattrs` flag that runs exactly this sequence so future `npm install` cycles self-clean before `cap sync`.

---

## Validation & Acceptance Checklist

- [ ] After Step 1, `ls -la ios/DerivedData` reports the dir missing.
- [ ] After Step 2, `xattr -lr ios/ node_modules/` returns no output.
- [ ] After Step 3, `find ios node_modules -type f -name '._*'` returns nothing.
- [ ] Step 4 ends with `** BUILD SUCCEEDED **`.
- [ ] `xcrun devicectl listapps -d 00008030-0004348E34C0C02E` shows `com.ali.noor`.
- [ ] `grep -c toastTimerIdsRef <built-App.app>/public/assets/*.js` returns ≥ 1 (proves PLAN-005 fix shipped through).
- [ ] Tap-to-launch on iPad renders the home dashboard (will be screenshot-confirmed in `docs/DEPLOY-2026-07-11/`).

---

## Version Table

| Surface | Status | Notes |
|---|---|---|
| Wipe `ios/DerivedData` + `ios/build` + global SPM caches | ✅ Will ship | corrected scope |
| `xattr -cr ios/ node_modules/` | ✅ Will ship | broader than v1; covers project-local build-artefact dirs |
| `._*` removal across ios/ + node_modules/ | ✅ Will ship | this spec |
| Re-run `cap run ios --target=00008030-0004348E34C0C02E` | ✅ Will ship | this spec |
| PLAN-005 ship on device | ⏳ Verified once Step 4 succeeds |  |
