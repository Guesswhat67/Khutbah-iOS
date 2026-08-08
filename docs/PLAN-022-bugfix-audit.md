# PLAN-022 — 2026-07-12 JS bug-fix bundle (Buffy / Freebuff audit)

_Owner: **Aayaan** · Audit: 2026-07-12 · Shipped: 2026-07-12_

## TL;DR

A full-codebase audit (Vite + React 18 + Capacitor + iOS native) found **11 bugs across 7 source files**. All fixed in this plan. Build clean (`npx vite build` ✓), all 4 test suites green (`tracker 64/64`, `stream 180/180`, `bulk 2348/2348`, `mega 5300/5300`). Per-bug entry below with signature, root cause, fix, and validation.

---

## Bug #1 — CRITICAL — `dayBeforeYesterdayStr()` undefined (streak crash) `[PLAN-022.1]`

**File:** `src/utils/streak.js:135` · **Status:** ✅ FIXED

Inside `markDayComplete()`:
```js
const cont = s.lastCompletedDay === yesterdayStr() || s.lastCompletedDay === dayBeforeYesterdayStr()
```

`dayBeforeYesterdayStr()` was **never defined anywhere in the codebase**. Triggered on any `markDayComplete()` call where `s.lastCompletedDay !== yesterdayStr()` (the short-circuit AND the throw path). Concretely means: user with ≥2-day gap completes today's daily goal → `t.completed = true` runs in memory → `markDayComplete()` throws BEFORE `saveToday(t)` → today's progress is lost, streak counter never increments, fire-prone (any QuranMode `handleBrowseScroll` re-fires the throw).

**Fix:** Drop the undefined call. The documented behavior is 1-day grace ("the chain stays alive as long as the last completion was today or yesterday"). Single-line diff replaced `|| s.lastCompletedDay === dayBeforeYesterdayStr()` with comment + (empty). Future maintainers can re-introduce the helper if needed:

```js
const cont = s.lastCompletedDay === yesterdayStr()
```

**Validation:** `grep -n 'dayBeforeYesterdayStr' src/` → only the explanatory comment remains; no live code references.

---

## Bug #2 — MEDIUM — Android notification 64-cap silent overflow `[PLAN-022.2]`

**File:** `src/utils/notify.js` · **Status:** ✅ FIXED

Old `DAYS_AHEAD = ios ? 4 : 7`. On Android: 7 × (3 streak + 5 prayer) + up to 6 sunnah fasts × 2 nudges = **68** > 64. iOS silently drops the overflow.

**Fix:** Android `DAYS_AHEAD = 6`. New ceiling: 6 × (3 streak + 5 prayer) + ≤12 fasting = **≤60** < 64 on every platform. iOS unchanged (already capped). The `comment` now reads precisely so the math is reproducible; one-line `DAYS_AHEAD` change.

**Trade-off:** Users lose 1 day of rolling streak+prayer reminders on Android (8 days → 6). The rolling window is refreshed on every `appStatus === true` mount, so the brief coverage gap is invisible to the user.

**Validation:** Comment math is self-contained; iOS keep its own 4-day limit.

---

## Bug #3 — HIGH — STT listener accumulation on surah re-init `[PLAN-022.3]`

**File:** `src/QuranMode.jsx` (around line 916) · **Status:** ✅ FIXED

Inside `handleResult`, when a surah changes and we're on-device (`!scribeRef.current`), the code re-runs `SherpaSTT.initialize({ initialPrompt: ..., quranMode: true })` and re-`addListener('result', handleResult)`. Without explicit `removeAllListeners()` first, plugin-level listener lists accumulate the same callback identity on every surah change. Latent on iOS (Sherpa is a stub there), REAL on Android — every surah boundary adds a duplicated listener, and the karaoke highlight eventually multi-fires per result.

**Fix:** Made `handleResult` `async` and inserted defensive cleanup BEFORE each re-init:

```js
try {
  await SherpaSTT.stopListening()
  await SherpaSTT.removeAllListeners?.()
} catch {}
SherpaSTT.initialize({ quranMode: true, initialPrompt: prompt, performanceMode }).then(...)
```

The synchronous `currentSurahRef.current = commit.s` write happens BEFORE the await, preventing concurrent re-init races from the same commit.

**Apple STT parity:** The outer `startAppleDetect()` already does explicit `removeAllListeners().catch(() => {})` before the new `addListener`, so the inner defensive block is principally for Sherpa. AppleSTT's `removeAllListeners()` is `listeners = []` per file inspection.

**Validation:** The plugin-callback contract doesn't care about Promise return values (fire-and-forget), so adding `async` + `await` is safe.

---

## Bug #4 — MEDIUM — HomePanel isn't refreshed on circle join/create/leave `[PLAN-022.4]`

**File:** `src/HomePanel.jsx` + `src/utils/circle.js` · **Status:** ✅ FIXED

PLAN-017 acknowledged this as a latent bug: the `fetchCircle()` useEffect deps stay `[]` (otherwise `getCachedCircle()` would re-fire every render due to `JSON.parse` returning fresh references). Result: user joins a family circle in Settings → the Family tile + members list don't update until full app restart.

**Fix:** Event-bus pattern. `circle.js`'s `saveCircle()` now broadcasts `app-circle-changed` via `window.dispatchEvent(new CustomEvent(...))`. `HomePanel.jsx` adds a listener and re-runs the fetch in-place; cleanup in the useEffect return.

```js
// HomePanel.jsx (added)
const onCircleChange = () => { if (!cancelled) fetchNow() }
window.addEventListener('app-circle-changed', onCircleChange)
return () => { ...; window.removeEventListener('app-circle-changed', onCircleChange) }
```

```js
// circle.js — broadcasts via saveCircle() since every join/create/leave/rename flows through it
function saveCircle(c) {
  try { ... }
  broadcastCircleChanged()   // window.dispatchEvent('app-circle-changed')
}
```

**Validation:** `grep -n 'app-circle-changed' src/` returns 4 matches: 3 in HomePanel (comment + add + remove) + 1 in circle.js (dispatch).

---

## Bug #5 — MEDIUM — grace-period inconsistency `circle.js` 3-day vs `streak.js` 1-day `[PLAN-022.5]`

**File:** `src/utils/circle.js` (line ~110) · **Status:** ✅ FIXED

`displayStreakOf()`'s doc-commented intent was 1-day grace ("alive if last completion was today or yesterday"), but the actual code was 3-day grace (`last === d(0) || last === d(1) || last === d(2)`). So `last_completed_day === yesterday - 1` showed a streak the local app wouldn't.

**Fix:** Match the comment: drop the `d(2)` clause.

```js
return (last === d(0) || last === d(1)) ? (member.current || 0) : 0
```

**Why not also tighten `streak.js`?** `streak.js` was already 1-day (correct). The comment in `markDayComplete` actively documents why the (now-deleted) `d(2)` clause was a historical bug. Local + family now consistently 1-day grace.

---

## Bug #6 — MEDIUM — stale `dbg` closure inside useCallback-stable handleResult `[PLAN-022.6]`

**File:** `src/QuranMode.jsx` · **Status:** ✅ FIXED

`handleResult` is `useCallback(..., [])` (deps empty — required so `addListener('result', handleResult)` doesn't accumulate new identities). Inside its body it calls `dbg(msg)` which is a `useCallback(..., [showDetectDebug])` that DEPS on `showDetectDebug`. The first-render `dbg` closure was permanently captured. After the user toggled Developer Options (`showDetectDebug` flips), handleResult kept calling the OLD dbg, so the in-app detection overlay never updated AND local/remote log routing was wrong.

**Fix:** `dbgRef` pattern — `useRef` of the latest `dbg`, sync'd on every render, called as `dbgRef.current(...)` from inside handleResult.

```js
// Module-scope pattern (chosen over changing handleResult deps)
const dbgRef = useRef(dbg)
useEffect(() => { dbgRef.current = dbg }, [dbg])

// handleResult (deps still []):
dbgRef.current(`🎧 STT (${...})`)
```

15 `dbg(` → 15 `dbgRef.current(` substitutions inside handleResult + endCalibration + escalateToHaiku + handleTrackerResult + startSherpaDetect + startAppleDetect + startScribeDetect + beginCalibration + beginTrackerCalibration + start + pause + end + reanchor.

**Validation:** handleResult identity is preserved (`deps: []`); dbg reference stays fresh across `showDetectDebug` toggles and HMR.

---

## Bug #7 — 🟢 LOW — dead `surahMatchCount` useRef (8 writes, 0 reads) `[PLAN-022.7]`

**File:** `src/QuranMode.jsx` · **Status:** ✅ FIXED

Defined at top of QuranMode: `const surahMatchCount = useRef(0)`. Referenced at 8 sites (endCalibration, handleResult inner block, start, pause, end, clearSession, reanchor). **Zero reads** anywhere in the file — confirmed via `grep -n 'surahMatchCount' src/` (after cleanup = 0 matches).

**Fix:** Delete the declaration + all 8 write sites. ~10 lines removed.

**Why it was there:** Historical artifact from a previous surah-match-counting heuristic that got superseded by the rolling vote window (`recentMatchesRef`). Net code change: ~−100 bytes.

---

## Bug #8 — 🟢 LOW — unbounded `SHOWN_KEY` growth `[PLAN-022.8]`

**File:** `src/utils/streak.js:nextQuotes()` · **Status:** ✅ FIXED

Every streak-reminder scheduling cycle (`refreshReminders` calls `LocalNotifications.schedule` with up to 21 fresh quote picks) appended quote IDs to `streak-quotes-shown`. Resets on full pool exhaustion, but in practice the user rarely schedules enough bursts to drop below the rotation threshold, so the key grows `~21/day` over months.

**Fix:** FIFO cap at `SHOWN_MAX = 60`. Done AFTER batch construction so today's picks are preserved even when overflowing the cap:

```js
const SHOWN_MAX = 60
if (shown.length > SHOWN_MAX) shown = shown.slice(-SHOWN_MAX)
```

**Validation:** `grep -n 'SHOWN_MAX' src/utils/streak.js` → 4 references, all in the bounded-trim block.

---

## Bug #9 — 🟢 LOW — empty placeholder `<h2>` in ReadyModal `[PLAN-022.9]`

**File:** `src/App.jsx` (ReadyModal) · **Status:** ✅ FIXED

`<h2 className="ready-title"></h2>` — empty container element, no content. The mosque icon already establishes the modal's purpose, and the `.ready-sub` paragraph ("Quick check before you begin") explains next step. The empty `<h2>` is a noise element wasted on the accessibility tree.

**Fix:** Remove the empty `<h2>`. Comment added explaining the rationale.

---

## Bug #10 — 🟢 LOW — dead `NoorWidget` import in `PrayerLocationSettings.jsx` `[PLAN-022.10]`

**File:** `src/PrayerLocationSettings.jsx` · **Status:** ✅ FIXED

`NoorWidget` is imported but never referenced in this file (the widget status copy lives in a static `<p className="setting-hint">` block, no `updateData` calls). Vite tree-shakes it out of the bundle, so no runtime impact, but a linter warning + dead import costs a few seconds during the next Rust-based bundling migration.

**Fix:** Single-line deletion.

---

## iOS native fixes (PLAN-023 — separate doc)

- `ios/App/App/Info.plist`: removed `armv7` from `UIRequiredDeviceCapabilities` (Apple dropped armv7 in iOS 11; App Store rejection risk). Replaced with `arm64`. Removed `location` from `UIBackgroundModes` (only foreground geolocation used; this entry was unjustified & App Store-question).
- `ios/App/App.xcodeproj/project.pbxproj`: bumped `IPHONEOS_DEPLOYMENT_TARGET` from `15.0` → `16.0` in all 4 occurrences (matches WidgetKit's `widgetURL` and `containerBackground` minimum). Removed stale `-D COCOAPODS` from `OTHER_SWIFT_FLAGS` (SwiftPM-only setup, no Podfile).
- `.gitignore`: added `Khutbah/` (exact-folder) + `Khutbah*.zip` (catches zip archives).

---

## Test results

| Suite | Cases | Pass |
|---|---|---|
| `npm run test:tracker` | 64 | 64 ✓ |
| `npm run test:stream` | 180 | 180 ✓ |
| `npm run test:bulk` | 2,348 | 2,348 ✓ |
| `npm run test:mega` | 5,300 | 5,300 ✓ |
| `npx vite build` | — | clean ✓ (870ms) |

---

## Next steps (Tier-1 backlog from PLAN-018)

The big remaining ticket is adding the `NoorWidgetExtension` target in Xcode — code exists, target never registered. Outside the scope of PLAN-022 (Mac/Xcode UI work). See [`PLAN-018-ios-next-steps-roadmap.md`](./PLAN-018-ios-next-steps-roadmap.md) item 1.3.

Crash reporting (PLAN-018 item 2.1) is the next highest-priority engineering work.
