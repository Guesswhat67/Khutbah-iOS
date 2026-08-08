# PLAN-004 — AppleSTT → ElevenLabs Scribe graceful fallback

**Date:** 2026-07-11 · **iOS App Version:** v1.0.0 · **Android Baseline:** v8.23.0

**Goal:** When the iPad's `@capacitor-community/speech-recognition` native plugin is not registered (dual-target SPM split keeps the ObjC `CAP_PLUGIN` constructor out of the App binary), the user sees "SpeechRecognition plugin is not implemented on iOS" instead of working Detect mode. Surgical two-file fix: detect the unavailability in `AppleSTT.js` with a recognizable error, and have `App.jsx` transparently route to ElevenLabs Scribe (already wired and known-good on iPad) so Detect mode Just Works.

## ⚡ Status

- **Pre-state:** ❌ iPad Detect mode crashes with the plugin-implemented error from the bridge.
- **Post-state:** ✅ iPad Detect mode auto-falls-back to ElevenLabs Scribe with a single toast explaining the switch; user keeps recording and translating.

## 0. STRICT RULES OF ENGAGEMENT

1. Do NOT touch shared JS engine files: `quranTracker.js`, `scribeSTT.js`, `quranStore.js`, `streak.js`, `notify.js`.
2. Do NOT rewrite `scribeSTT.js`'s bridge contract. Scribe sessions stay one-shot, server-tokens single-use.
3. Do NOT delete `AppleSTT.js` outright — keep the offline iPad STT path so that if Apple fixes bridge discovery upstream, our code is ready.
4. Do NOT introduce ping-pong: the Scribe fallback must give up cleanly when Scribe itself fails.
5. Do NOT depend on `VITE_APP_TOKEN` being absent — when it IS absent, the existing `401` toast surfaces cleanly. We don't auto-fallback from Scribe auth errors back to Native on iOS (another ping-pong risk).

## Master Plan

### Root Cause

`@capacitor-community/speech-recognition@7.0.1` ships `ios/Plugin/Plugin.swift @objc(SpeechRecognition)` and `ios/PluginObjc/Plugin.m CAP_PLUGIN(SpeechRecognition, "SpeechRecognition", ...)`. We split the sources into two SPM targets via `scripts/inject-speech-recognition-spm.mjs`. On iPad (iOS 16+, real device), the ObjC constructor that registers the plugin with Capacitor's bridge is not pulled into the App's final binary, so no plugin named `SpeechRecognition` exists. JS calls fail.

### The Code Fix

#### File: `src/plugins/AppleSTT.js`

Before `isListening = true` in `startListening()`, probe via the Capacitor bridge:

```js
try {
  const probe = await SpeechRecognition.available()
  if (!probe || probe.available !== true) {
    throw new Error('SpeechRecognition reports available=false on this iOS device.')
  }
} catch (e) {
  throw new Error('AAPLESTT_UNAVAILABLE: ' + (e?.message || String(e)))
}
```

This produces a stable, recognizable error contract that `App.jsx` matches on.

#### File: `src/App.jsx`

**(a) Add `isFallback` second parameter to `startScribeListening`:**

```js
const startScribeListening = async (isResume = false, isFallback = false) => { … }
```

Inside its existing catch, swap:
```js
if (IS_NATIVE && !isFallback) await startNativeListeningInternal()
else if (isFallback) {
  setError('Both Apple Native and ElevenLabs speech failed. …')
  setPhase('idle'); isListeningRef.current = false
}
else await startBrowserListeningInternal()
```

**(b) Inside `startNativeListeningInternal`'s catch around `NativeSTT.startListening()`, add the fallback branch (BEFORE simulator/permission):**

```js
if (msg.includes('applestt_unavailable') || msg.includes('not implemented')) {
  logKhutbah('WARN', 'AppleSTT unavailable, falling back to ElevenLabs Scribe',
             e?.message || String(e))
  showToast('Apple Native speech not available on this device — using ElevenLabs cloud STT',
            'warn', 4500)
  try { await NativeSTT.stopListening?.() } catch {}
  try { await NativeSTT.removeAllListeners?.() } catch {}
  await startScribeListening(false, true /* isFallback: breaks ping-pong */)
  return
}
```

### Why ping-pong prevention works

`isFallback = true` is a flag set ONLY when we entered Scribe *because* AppleSTT failed. If Scribe itself fails:
- Its existing `401`-detection path toasts "Cloud STT requires API token…".
- For other failures, the OLD logic would re-bounce to `startNativeListeningInternal()` → `AppleSTT.startListening()` → AAPLESTT_UNAVAILABLE again → infinite loop.
- Our new guard: if `isFallback === true`, we **don't** bounce back; we surface a clean error and stay idle.

### Native iOS Work

None. The fallback lives entirely in JS. Bypass the broken plugin at the bridge call site.

### Future-Proofing

- The `AAPLESTT_UNAVAILABLE:` prefix is a stable contract.
- If Apple fixes Capacitor-8 bridge discovery upstream (or `@capacitor-community/speech-recognition` ships a single-target `Package.swift`), our `inject-speech-recognition-spm.mjs` marker check short-circuits; the AppleSTT probe becomes a passing assertion; the App.jsx fallback branch becomes dead code that we can leave in as belt-and-suspenders for one version, then remove.

## Validation & Acceptance Checklist

- [ ] `node --check src/plugins/AppleSTT.js` exit 0.
- [ ] On iPad, with Settings → Speech Engine = Apple (Native): tap Detect → toast "Apple Native speech not available…" → Scribe connects → English translations stream → no crash.
- [ ] With Settings → Speech Engine = ElevenLabs (Cloud): tap Detect → no fallback toast → Scribe connects first try.
- [ ] Mic permission prompt fires once per language, not twice.
- [ ] Pause / End / Resume three times in a row → no duplicate `[KHUTBAH]` log entries (no listener leak).
- [ ] With `.env.local` missing `VITE_APP_TOKEN`, Native setting behaves the same: toast + Scribe auth fail → clean error after.
- [ ] Lock screen mid-recitation, return → Detect continues streaming within ~8 s.
- [ ] No infinite ping-pong (i.e., never see "Both Apple Native and ElevenLabs speech failed" unless Scribe actually has an unrelated fault).

## Version Table

| Surface | Status | Notes |
|---|---|---|
| AppleSTT.js probe with `AAPLESTT_UNAVAILABLE:` | ✅ Shipped | this spec |
| App.jsx `isFallback` parameter | ✅ Shipped | ping-pong guard |
| App.jsx fallback branch | ✅ Shipped | routes to Scribe |
| iPad Detect mode working | ✅ Smoke-tested | rebuild + reinstall |
| Plugin-side root cause (`+load` constructor) | ⚠️ Open | needs `nm` check post-install |
| Upstream issue filed | ❌ Pending | please file github.com/capacitor-community/speech-recognition |
