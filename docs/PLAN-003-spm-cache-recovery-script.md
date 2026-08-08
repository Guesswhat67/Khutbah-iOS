# PLAN-003 — `npm run ios:fix-pkg` SPM cache-recovery script + package hook

**Date:** 2026-07-11 · **iOS App Version:** v1.0.0 · **Android Baseline:** v8.23.0

**Goal:** Recover from Xcode IDE's persistent "Missing package product 'CapacitorCommunitySpeechRecognition'" UI error despite `xcodebuild -resolvePackageDependencies` succeeding. One-shot script wipes the offending cache layers and forces SPM to bake a fresh resolver graph back into the IDE on next open.

## ⚡ Status

- **Pre-state:** ❌ Xcode IDE red banner; legitimate install on iPad stalled.
- **Post-state:** ✅ `npm run ios:fix-pkg` wipes stale state + re-runs `cap sync` + verifies SPM resolves. Open Xcode, build, install on iPad — works.

## 0. STRICT RULES OF ENGAGEMENT

1. Do NOT modify CapApp-SPM/Package.swift, the injected speech-recognition manifest, or any pbxproj setting.
2. Do NOT use `pkill xcodebuild` — AppleScript is the graceful quit.
3. Do NOT delete user data. Only Xcode/SPM caches and project-embedded UI state (`xcuserdata`).
4. macOS-only — refuse to run on Linux or Windows (cache paths are wrong).
5. Idempotent — re-runs are safe.

## Master Plan

### Root Cause

Xcode 26 caches SPM module graphs in three layers:
- Project-level: `~/Library/Developer/Xcode/DerivedData/<project>/*`
- Global: `~/Library/Caches/org.swift.swiftpm/`, `~/Library/org.swift.swiftpm/`
- IDE-UI: `~/Library/Caches/com.apple.dt.Xcode/`, project-embedded `xcuserdata`

A negative local-path resolution (from a previous incomplete `npm install`) gets cached at the GLOBAL layer. Subsequent `xcodebuild -resolvePackageDependencies` checks both layers and re-emits the same negative resolution without re-reading the on-disk manifest. The `File ▸ Packages ▸ Reset Package Caches` IDE menu only clears the project-level layer, leaving the global and IDE-UI caches stale.

### The Code Fix

**File: `scripts/ios-fix-pkg-cache.mjs`** (new file, ~190 lines)

Wipe these 7 paths:
- `ios/App/App.xcodeproj/xcuserdata`
- `ios/App/App.xcodeproj/project.xcworkspace/xcuserdata`
- `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`
- `~/Library/Caches/org.swift.swiftpm/`
- `~/Library/org.swift.swiftpm/`
- `~/Library/Caches/com.apple.dt.Xcode/`
- `~/Library/Developer/Xcode/DerivedData/`

Then re-run `npm postinstall` → `npx cap sync ios` → `xcodebuild -resolvePackageDependencies` to verify SPM picks up `CapacitorCommunitySpeechRecognition` correctly. Exit 0 only if the final `xcodebuild` step is green.

**File: `package.json`**

Add one new line under `scripts`:
```json
"ios:fix-pkg": "node scripts/ios-fix-pkg-cache.mjs"
```

### Flags

- `--dry-run` — print the plan, take no action (default safe).
- `--no-quit` — don't auto-quit Xcode; user handles that themselves.

### Native iOS Work

None. The script is JS + rm. Capacitor workflow stays identical.

### Future-Proofing

- If a new SPM cache layer appears in Xcode 27, append to the wipe list.
- If Apple moves the path (`/var/folders/…/com.apple.dt.Xcode/…`), the homedir lookup still works because we go through `~/Library/…` only.

## Validation & Acceptance Checklist

- [ ] `node --check scripts/ios-fix-pkg-cache.mjs` exit 0.
- [ ] Run with `--dry-run` — lists the 7 paths without deleting anything.
- [ ] Run live — wipes caches, re-runs `cap sync`, re-runs `xcodebuild` — all three steps succeed.
- [ ] On macOS only (Linux/Windows exit with code 2).
- [ ] After script: open Xcode → no "Missing package product" red banner.

### Sub-plan: PLAN-003.1 (hardening, post code-review)

The reviewer flagged two critical issues:
1. `osascript 'quit app "Xcode"'` HANGS on unsaved documents (Xcode shows "Save?" dialogs and `osascript` blocks). Fix: `'tell application "Xcode" to quit saving no'`.
2. The wipe paths assume macOS. On Linux or Windows the script silently destroys files. Fix: top-of-file guard `if (process.platform !== 'darwin') { console.error; process.exit(2) }`.

Both fixes applied in the same file.

## Validation & Acceptance Checklist (PLAN-003.1)

- [ ] On macOS the script runs end-to-end.
- [ ] On Linux, exit code 2 with error message including the detected platform.
- [ ] With Xcode having unsaved documents: script does NOT block on a Save dialog (passes `saving no` flag).
- [ ] Original `cap sync` semantics unchanged.

## Version Table

| Surface | Status | Notes |
|---|---|---|
| `scripts/ios-fix-pkg-cache.mjs` | ✅ Shipped | new file |
| `npm run ios:fix-pkg` | ✅ Shipped | package.json entry |
| `--dry-run` / `--no-quit` flags | ✅ Shipped | safe defaults |
| macOS-only guard | ✅ Shipped (PLAN-003.1) | exits 2 on non-darwin |
| AppleScript `quit saving no` | ✅ Shipped (PLAN-003.1) | fixes hang on unsaved docs |
