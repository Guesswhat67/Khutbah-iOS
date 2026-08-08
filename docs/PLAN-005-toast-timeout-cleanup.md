# PLAN-005 — ToastHost `setTimeout` leak on unmount

**Date:** 2026-07-11 · **iOS App Version:** v1.0.0 · **Android Baseline:** v8.23.0

**Goal:** Stop `ToastHost` from calling `setToasts` on an unmounted component when a toast's `setTimeout(..., duration)` outlives the component lifetime — fix React "state update on unmounted component" warnings and the small memory leak each surviving timer represents on iOS.

---

## ⚡ LIVE PARITY STATUS

| Surface | Before | After |
|---|---|---|
| Toast auto-dismiss on mount | ✅ works | ✅ works (no regression) |
| Toast auto-dismiss on unmount | ❌ `setToasts` fired on unmounted component → React warning + tiny leak per toast | ✅ timer's id cleared in `useEffect` cleanup before unmount |
| Visible-to-user behavior | identical | identical |

---

## 0. STRICT RULES OF ENGAGEMENT

1. Do **not** touch `src/utils/toast.js` (the wrapper that *fires* the event). The bug is in the **host** that listens.
2. Do **not** change the toast-ID scheme. Continue generating `Date.now() + Math.random()` so in-flight toasts keep their identity across the fix.
3. Do **not** touch the existing `app-confirm` listener logic — only add a cleanup hook for `setTimeout` ids.
4. Do **not** introduce a global variable. Use `useRef(new Set())` (component-local, React-idiomatic).
5. Do **not** change the toast's visible dwell time — `duration` continues to drive both the render-life and the cleanup.

---

## Master Plan

### Root Cause

`ToastHost` registers `app-toast` / `app-confirm` listeners inside a `useEffect` whose cleanup removes only the listeners. Inside `onToast` it calls:

```js
setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
```

That `setTimeout`'s callback is not tracked anywhere. If the user triggers a toast (or several) and then `ToastHost` unmounts before the timer fires — e.g., navigating away from a screen that mounted it, hot reload during dev, or future code that conditionally mounts `ToastHost` — the callback still runs and calls `setToasts` on a component that's no longer mounted. React logs the warning *"...Can't perform a React state update on an unmounted component"*. The timer handle is also not released until it naturally fires, which is a ~3-second leak per toast (toasts default to durations 3000-4500 ms per `showToast()` in `src/utils/toast.js`).

This is a textbook *React mount/cleanup bug*. Easy to fix, very low risk.

### The Code Fix

**File:** `src/App.jsx`

The fix introduces a single `useRef(new Set())` that records every active toast timer id. Two integration points:

1. **On toast creation** (inside `onToast`): push the timer id into the Set as soon as `setTimeout` returns.
2. **On cleanup** (inside `useEffect` cleanup): iterate the Set and `clearTimeout` every entry, then `clear()` the set.

Diff:

```diff
@@ src/App.jsx — ToastHost component @@
 function ToastHost() {
   const [toasts, setToasts] = useState([])
+  const toastTimerIdsRef = useRef(new Set())
+
   useEffect(() => {
     const onToast = (e) => {
       const { message, type, duration } = e.detail
       const id = Date.now() + Math.random()
       setToasts(prev => prev.concat({ id, message, type, duration }))
-      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
+      const timerId = setTimeout(() => {
+        toastTimerIdsRef.current.delete(timerId)
+        setToasts(prev => prev.filter(t => t.id !== id))
+      }, duration)
+      toastTimerIdsRef.current.add(timerId)
     }
     const onConfirm = (e) => {
       …
     }
     window.addEventListener('app-toast', onToast)
     window.addEventListener('app-confirm', onConfirm)
-    return () => {
-      window.removeEventListener('app-toast', onToast)
-      window.removeEventListener('app-confirm', onConfirm)
-    }
+    return () => {
+      window.removeEventListener('app-toast', onToast)
+      window.removeEventListener('app-confirm', onConfirm)
+      // Cancel every pending toast auto-dismiss timer so the closure can't
+      // call setToasts on an unmounted component.
+      for (const id of toastTimerIdsRef.current) clearTimeout(id)
+      toastTimerIdsRef.current.clear()
+    }
   }, [])
```

Single contiguous block, single file. Net diff: +9 / -3 lines.

### Native iOS Work

None. The fix lives entirely in the JS state-management layer. WKWebView & Spam filters unaffected.

### Future-Proofing

- The `useRef(new Set())` pattern is React-idiomatic and survives strict-mode double-invocation: the Set is a fresh ref per mount, and the cleanup clears any ids before the next mount's effect creates new ones.
- If someone later adds a `clearAllToasts()` API, it can iterate `toastTimerIdsRef.current` and `clearTimeout` without needing any new ref.
- Android behavior is untouched: neither WebView nor Activity tear-down paths differ meaningfully from iOS at the React-state-update level.

---

## Validation & Acceptance Checklist

- [ ] `node --check src/App.jsx` not applicable (JSX) — instead, `npx --no-install vite build` succeeds.
- [ ] `grep -n 'toastTimerIdsRef' src/App.jsx` returns ≥ 3 matches (declaration + add + delete + cleanup iterate).
- [ ] Manual smoke on iPad: trigger 3 toasts in quick succession (Settings → save, Detect → fallback, Analyze → success). Each one dismisses on schedule.
- [ ] Cold unmount test (dev only): mount `ToastHost`, fire a toast with `duration: 60000` (long), then forcibly unmount via React DevTools. No *"state update on unmounted component"* warning in Safari Web Inspector console.
- [ ] Hot-reload dev: edit a file while 2 toasts are visible — toasts disappear instantly (timers cleared) instead of waiting their dwell.

---

## Version Table

| Surface | Status | Notes |
|---|---|---|
| `toastTimerIdsRef` ref + 2 integration points | ✅ Will ship | this spec |
| Existing toast visual + dismissal timing | ✅ Preserved | no UX change |
| Android parity | ✅ Unaffected | same code path |
| Upstream `@capacitor-community` deps | ✅ Unaffected | unrelated |
