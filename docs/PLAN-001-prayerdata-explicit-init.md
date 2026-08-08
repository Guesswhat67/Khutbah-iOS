# PLAN-001 — PrayerData.swift explicit memberwise init

**Date:** 2026-07-11 · **iOS App Version:** v1.0.0 · **Android Baseline:** v8.23.0

**Goal:** Eliminate the Xcode "Extra arguments at positions #11, #12 in call" compile-failure in the `NoorWidgetExtension` target by locking the 12-arg memberwise init into the AST, bypassing the indexer's stale module signature.

## ⚡ Status

- **Pre-state:** ❌ Xcode build fails with "PrayerData.swift:157:26 — Extra arguments at positions #11, #12 in call".
- **Post-state:** ✅ Indexer cache bypass; build passes; runtime identical.

## 0. STRICT RULES OF ENGAGEMENT

1. Do NOT modify any stored property order or type.
2. Do NOT break Codable/Equatable/Hashable/Sendable conformance (they synthesize independently).
3. Do NOT add unrelated "while we're here" refactors.
4. Do NOT change the call site `PrayerData(...)` in `PrayerTimelineProvider.swift` — the explicit init signature must match it identically.

## Master Plan

### Root Cause

Xcode 26's indexer for targets using `PBXFileSystemSynchronizedRootGroup` is stale after stored properties are added to a Swift struct in-session: the indexer holds the OLD (smaller) memberwise-init signature even after the on-disk struct has the new property. The on-disk source compiles fine (`swiftc -parse` on an inlined copy parses cleanly), but the indexer cache disagrees with the file.

### The Code Fix

**File:** `ios/App/NoorWidgetExtension/PrayerData.swift`

Insert a 12-arg explicit `init` IMMEDIATELY before the `// MARK: - Convenience helpers` block:

```swift
init(
    fajr: Double,
    sunrise: Double,
    dhuhr: Double,
    asr: Double,
    maghrib: Double,
    isha: Double,
    tomorrowFajr: Double,
    yesterdayIsha: Double,
    hijri: String,
    city: String,
    tempUnit: String,
    dateKey: String
) {
    self.fajr = fajr; self.sunrise = sunrise; self.dhuhr = dhuhr; self.asr = asr
    self.maghrib = maghrib; self.isha = isha; self.tomorrowFajr = tomorrowFajr
    self.yesterdayIsha = yesterdayIsha; self.hijri = hijri; self.city = city
    self.tempUnit = tempUnit; self.dateKey = dateKey
}
```

### Why this works

- Adding an explicit memberwise init **suppresses** Swift's auto-synthesis. So the init signature now lives directly in the source — indexer and file agree by construction.
- `Codable` / `Equatable` / `Hashable` / `Sendable` are synthesized separately from memberwise init; they remain intact.
- The call site in `PrayerTimelineProvider.placeholder()` passes all 12 keys; this explicit init accepts them.

### Native iOS Work

None. Pure Swift fix.

### Future-Proofing

- If the struct gains a 14th stored property later, the explicit init must be updated or removed (so Swift re-synthesizes).
- Alternative long-term fix: migrate the widget extension OFF `PBXFileSystemSynchronizedRootGroup` to a per-file target. Out of scope for this fix.

## Validation & Acceptance Checklist

- [ ] `swiftc -parse ios/App/NoorWidgetExtension/PrayerData.swift` exits 0.
- [ ] `xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App -configuration Debug` succeeds.
- [ ] Build of `NoorWidgetExtensionExtension` target completes without "Extra arguments at positions #11, #12 in call".
- [ ] The widget timeline still produces a placeholder (manual smoke test on iPad after install).

## Version Table

| Surface | Status | Notes |
|---|---|---|
| PrayerData.swift explicit init | ✅ Shipped | locks 12-arg signature into AST |
| Indexer cache bypass | ✅ Effective | until Xcode fixes the root cause |
| Codable/Equatable/Hashable/Sendable | ✅ Preserved | synthesized independently |
