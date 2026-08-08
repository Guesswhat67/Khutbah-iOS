# PLAN-009 — `src/utils/scribeSTT.js` STT-token fetch → `apiFetch` migration

**Date:** 2026-07-11 · **iOS App Version:** v1.0.0 · **Android Baseline:** v8.23.0

**Goal:** Replace the bare `fetch(${API_BASE}/api/stt/token)` call in `src/utils/scribeSTT.js` (line 73) with `net.apiFetch(...)` so the ElevenLabs Scribe token fetch benefits from the centralized timeout + 1-retry safety net in `src/utils/net.js`. If the Cloudflare Worker stalls or the user's network flakes, Detect-mode now fails fast (toast) instead of hanging the microphone UI forever.

---

## ⚡ LIVE PARITY STATUS

| Surface | Before | After |
|---|---|---|
| `fetchToken()` call triggering Detect mode | bare fetch — no timeout, no retry | `apiFetch` — 8 s timeout + 1 retry, distinct AbortError on timeout |
| User-visible effect on a healthy network | identical | identical |
| User-visible effect on a stalled network | Detect dialog hangs forever | toast: *"Cloud STT token request timed out — try again"* |
| Android parity | unchanged | unchanged |

---

## 0. STRICT RULES OF ENGAGEMENT

1. Do **not** touch the ScribeSession token contract or its response shape (`{ token }`).
2. Do **not** alter any other bare-`fetch` in the codebase. PLAN-009 fixes this ONE site only; the other 8 bare fetches found in triage are file PLAN-NNN+2 candidates for future rounds.
3. Do **not** add a new global dependency. `apiFetch` already exports from `src/utils/net.js`.
4. Do **not** remove the existing `headers: apiHeaders()` call — auth header is required.

---

## Master Plan

### Root Cause

`fetchToken()` in `src/utils/scribeSTT.js` line 73 issues a bare `fetch` with no AbortController, no timeout, no retry. If the Cloudflare Worker route stalls (cold-start, capacity exhaustion, regional outage) the `await fetch` hangs indefinitely. The Detect-mode UI opens, the user taps the mic, and *nothing happens* — no error toast, no loader fallback. The user assumes the app is broken. The same file already imports many helpers; using the existing `apiFetch` helper is a 2-line change with outsized stability benefit.

### The Code Fix

```diff
@@ src/utils/scribeSTT.js — top imports @@
 import { filterTranscript } from './sttSanity'
 import { getDeviceId } from './device'
+import { apiFetch } from './net'

@@ src/utils/scribeSTT.js — fetchToken() @@
 async function fetchToken() {
-  const res = await fetch(`${API_BASE}/api/stt/token`, { headers: apiHeaders() })
+  const res = await apiFetch(
+    `${API_BASE}/api/stt/token`,
+    { headers: apiHeaders() },
+    { timeoutMs: 8000, retries: 1 }
+  )
   const data = await res.json().catch(() => ({}))
```

`apiFetch` returns a `Response` whose body is already a stream — the downstream `res.json().catch(() => ({}))` line keeps working unchanged.

### Native iOS Work

None. Fix is JS-only; WKWebView / native plugins unaffected. Token contract preserved.

### Future-Proofing

- The other 8 bare `fetch` calls (`circle.js:34,69`, `logger.js:77`, `quranStore.js:122`, `maktabaData.js:103,132,192`, `streak.js:350`, `QuranMode.jsx:578`, `PrayerLocationSettings.jsx:16`) are NOT touched here. They become candidates for follow-up PLAN-NNN+2 through PLAN-NNN+9, each migrated independently so attribution + validation are tight.
- If `apiFetch`'s default timeout or retry policy ever improves, this site gets the upgrade for free.

---

## Validation & Acceptance Checklist

- [ ] `grep -n 'apiFetch' src/utils/scribeSTT.js` returns ≥ 1 (import) + 1 (call site).
- [ ] `node --check src/utils/scribeSTT.js` exits 0.
- [ ] `npm run build` succeeds.
- [ ] Detect mode on healthy network: identical user experience; ScribeSession connects as before.
- [ ] Manual smoke: open Detect on iPad, kill the WiFi mid-`fetchToken()` — toast surfaces within 8 s.

---

## Version Table

| Surface | Status | Notes |
|---|---|---|
| `import { apiFetch } from './net'` | ✅ Will ship | this spec |
| `await apiFetch('/api/stt/token', {...}, { timeoutMs: 8000, retries: 1 })` | ✅ Will ship | this spec |
| Downstream `res.json().catch(...)` parser | ✅ Preserved | unchanged |
| Android parity | ✅ Unaffected | path identical |
| Other 8 bare-fetches | ⚠️ Deferred | standalone follow-ups in next session |

