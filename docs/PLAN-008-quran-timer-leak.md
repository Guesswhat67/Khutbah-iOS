# PLAN-008 — QuranMode `setTimeout` retry-loop unmount leaks

**Date:** 2026-07-11 · **iOS App Version:** v1.0.0 · **Android Baseline:** v8.23.0

**Goal:** Track every `setTimeout` returned by the three retry chains in `src/QuranMode.jsx` (lines 1554, 1662, 1729 + the `run` boot poller near 1662) into a single component-scoped `useRef(new Set())`, then `clearTimeout` every remaining id in a useEffect-cleanup so navigating away from Quran mid-retry can't keep firing `setState` on unmounted components.

---

## ⚡ LIVE PARITY STATUS

| Surface | Before | After |
|---|---|---|
| Quran retry chains (any of 3 sites `go`/`run`/Mushaf-anchor) firing after Quran panel unmounts | ❌ yes — up to ~2 s × 25–40 retries each | ✅ cleared on unmount |
| `QuranMode` panel in history (back button during calibrate) | leaks 1–3 dangling timers per visit | clean |
| Visible-to-user behavior of retry loop while Quran panel is mounted | identical | identical |

---

## 0. STRICT RULES OF ENGAGEMENT

1. Do **not** touch the shared JS engine: `quranTracker.js`, `quranStore.js`, `scribeSTT.js` are sacred. This fix stays inside `QuranMode.jsx`.
2. Do **not** change the retry budget (25, 40, 25) on each chain. Only the timer tracking changes.
3. Do **not** introduce a global. `useRef` is component-local.
4. Do **not** change any behavior visible to the user while Quran panel IS mounted.
5. **Strict-mode safe**: each effect cleanup runs synchronously before the next mount's effects.

---

## Master Plan

### Root Cause

The three retry chains all schedule themselves with raw `setTimeout(go, 100)`/`setTimeout(run, 100)`/`setTimeout(go, 80)` and neither store the returned id nor cancel on unmount. If the user opens the Quran panel, hits `Detect my recitation`, then immediately navigates away while the calibrate/anchor/reboot chains are still mid-loop, every remaining iteration continues to fire `setCalibrate / setError / setShadow` etc. on an unmounted component. The behavior is identical to the ToastHost bug fixed in PLAN-005: the timer callback outlives the component, calls state on a dead instance, React logs *"Can't perform a React state update on an unmounted component"*.

### The Code Fix

A single `useRef(new Set())` named `quranActiveTimers` (placed near the top of the `QuranMode` component, alongside the other state/ref declarations), plus a corresponding `useEffect(() => () => { ... clearTimeout every id ... })`. All three retry-loop call sites wrap `setTimeout(...)` so the returned id is added to the set; an existing per-iteration cleanup is preserved where present.

Plain diff shape (applied per-site, see commit log for full snapshots):

```diff
@@ src/QuranMode.jsx — top of QuranMode component @@
 const [bookmarks, setBookmarks] = useState(() => { ... })
+// PLAN-008: track every retry-loop setTimeout id so we can clearTimeout them
+// all on unmount. Mirrors the PLAN-005 ToastHost pattern. Without this, a
+// retry chain (calibrate / anchor / boot) outlives the user's back-tap and
+// fires setState on an unmounted component.
+const quranActiveTimers = useRef(new Set())
+useEffect(() => {
+  const set = quranActiveTimers.current
+  return () => { for (const id of set) clearTimeout(id); set.clear() }
+}, [])

@@ src/QuranMode.jsx — boot-poller (line ~1662) @@
-  if (tries++ < 40) setTimeout(run, 100)
+  if (tries++ < 40) {
+    const id = setTimeout(run, 100)
+    quranActiveTimers.current.add(id)
+  }

@@ src/QuranMode.jsx — anchor retry (line ~1554) @@
-  if (tries++ < 25) setTimeout(go, 100)
+  if (tries++ < 25) {
+    const id = setTimeout(go, 100)
+    quranActiveTimers.current.add(id)
+  }

@@ src/QuranMode.jsx — Mushaf hash retry (line ~1729) @@
-  if (tries++ < 25) setTimeout(go, 80)
+  if (tries++ < 25) {
+    const id = setTimeout(go, 80)
+    quranActiveTimers.current.add(id)
+  }
```

### Native iOS Work

None. Bug is JS-only. WKWebView / Spam filters unaffected.

### Future-Proofing

- Any future retry polling added to `QuranMode.jsx` only needs `quranActiveTimers.current.add(setTimeout(...))` — no new ref, no new effect.
- The same `useRef(new Set()) + useEffect cleanup` recipe can be lifted into a tiny `useTrackedTimers()` hook later if the pattern spreads across files.

---

## Validation & Acceptance Checklist

- [ ] `grep -n 'quranActiveTimers' src/QuranMode.jsx` returns ≥ 4 matches (declaration + cleanup add + 3 site-adds).
- [ ] `npm run build` (vite) succeeds with no JSX syntax errors.
- [ ] Each of the 3 retry sites now stores its `setTimeout` id in the ref.
- [ ] `quranActiveTimers.current.clear()` runs exactly once on unmount (clean shutdown).
- [ ] Manual smoke: open Quran panel, tap Detect, immediately navigate away mid-calibrate → no "setState on unmounted component" warning in Safari Web Inspector.

---

## Version Table

| Surface | Status | Notes |
|---|---|---|
| `quranActiveTimers = useRef(new Set())` declaration | ✅ Will ship | this spec |
| useEffect cleanup iteration | ✅ Will ship | this spec |
| `boot-poller` retry chain (line 1662) wired into set | ✅ Will ship | this spec |
| `anchor` retry chain (line 1554) wired into set | ✅ Will ship | this spec |
| `Mushaf hash` retry chain (line 1729) wired into set | ✅ Will ship | this spec |
| `run` cancel-exit point (line 1664) wired | ⚠️ already clean — no-op diff | preserved |

