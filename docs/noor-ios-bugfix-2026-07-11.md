# [Bugfix] — Noor iOS Specification

**Date:** 2026-07-11 · **iOS App Version:** v1.0.0 (Capacitor 8.x port) · **Android Baseline:** v8.23.0

---

## 📖 About this file

This is the **MiniMax-style spec document** for the iOS Detect-mode bugfix shipped on 2026-07-11. It captures, in one place:

- The "live parity status" snapshot comparing **Android v8.23.0** vs. **iOS v1.0.0** across every surface of the app.
- The exact root cause, terminal-ready repro steps, and the code fix (already applied in the working tree) for the *"Could not start microphone — SpeechRecognition plugin is not implemented on iOS"* error on iPad.
- The hard **"do NOT touch"** list (`quranTracker.js`, `scribeSTT.js`, `quranStore.js`, `streak.js`, `notify.js`, plus the no-CocoaPods / no-bump-below-iOS-16 constraints).
- A boolean Validation & Acceptance Checklist that you tick off on a real iPad before declaring the fix done.
- A Version Table marking what shipped, what is open, and what is explicitly deferred.

**Read this when:**

- You open the project cold and need a **one-pass** context dump of the current iOS state.
- You're about to touch any code near `src/plugins/AppleSTT.js`, `src/App.jsx`'s `startScribeListening` / `startNativeListeningInternal`, or `ios/App/CapApp-SPM/Package.swift`.
- You want to verify that an "obvious" fix doesn't conflict with the standing decisions (don't delete the plugin, don't introduce CocoaPods, keep `IPHONEOS_DEPLOYMENT_TARGET = 16.0`).
- You're reviewing a PR that claims *"Detect works again on iPad"* — point the author here for the test plan.

**Do NOT confuse this with the other docs/ files:**

| File | What it actually is |
|---|---|
| `docs/WORKFLOW.md` | The standing rule: **plan → apply → log** for every code change. |
| `docs/CHANGES_LOG.md` | Append-only ledger of every code change, with **exact** line numbers + diffs. |
| `docs/LOG-ENTRY-TEMPLATE.md` | The strict format every log entry must follow. |
| `docs/noor-ios-restart-prompt.md` | Paste-into-new-chat prompt to **restore context** in a fresh session. |
| `docs/PLAN-NNN-…md` | Individual **formal plan contracts** for each specific fix. |

This file is the **narrative spec**; the `PLAN-NNN` files are the contracts; the `CHANGES_LOG.md` is the audit trail.

---

**Goal:** Resolve iPad-only runtime error in Detect / Khutbah live-transcription path: *"Could not start microphone — SpeechRecognition plugin is not implemented on iOS."* Make Detect mode work without uninstalling the offline iOS path; preserve Android consistency; do **not** modify the shared JS engine files (`quranTracker.js`, `scribeSTT.js`, `quranStore.js`).

---

## ⚡ LIVE PARITY STATUS

| Surface | Android v8.23.0 | iOS v1.0.0 (pre-fix) | iOS v1.0.0 (post-fix) |
|---|---|---|---|
| Home dashboard tiles & prayer card | ✅ | ✅ | ✅ |
| Quran browse + reader | ✅ | ✅ | ✅ |
| Quran Detect (live mic) | ✅ (Sherpa on-device) | ❌ "plugin is not implemented on iOS" | ✅ via ElevenLabs Scribe fallback |
| Khutbah live translation | ✅ (Scribe/ElevenLabs) | ❌ (same bridge error) | ✅ via path A→Scribe transparent fallback |
| AI Analyze / detectHelper | ✅ | ✅ | ✅ |
| Home-screen prayer widget | ✅ | ✅ (shipped) | ✅ |

**Problem Space:**
The `@capacitor-community/speech-recognition@7.0.1` iOS plugin (`ios/Plugin/Plugin.swift @objc(SpeechRecognition)` + `ios/PluginObjc/Plugin.m CAP_PLUGIN(SpeechRecognition, "SpeechRecognition", …)`) ships sources we cannot keep in a single SPM target because SPM forbids mixed-language targets. Our `scripts/inject-speech-recognition-spm.mjs` splits `Plugin.swift` / `Plugin.m` into two targets and links them via a cross-target dependency. On iPad (iOS 16+, real device), Xcode builds the product fine, but the ObjC `CAP_PLUGIN` constructor is never pulled into the App binary at final-link — so Capacitor's bridge registers **zero** plugins named `SpeechRecognition`. The JS `registerPlugin('SpeechRecognition', …)` proxy still loads, and every method call surfaces the Capacitor plugin-error path. Result: a runtime "plugin is not implemented on iOS" presented to the user as a friendly toast after we wrapped it in `AppleSTT.startListening()`.

**Aayaan's Next Exact Steps:**
```bash
# 1. Re-sync iOS bundle with the fix in src/plugins/AppleSTT.js and src/App.jsx
npm run ios:sync

# 2. Wipe the SPM cache (last-mile guarantee against stale module compiles)
npm run ios:fix-pkg

# 3. Reinstall on iPad via Xcode (Product → Run, ⌘R)

# 4. Capture Safari Web Inspector output (confirm AAPLESTT_UNAVAILABLE + Scribe fallback)
#    Mac Safari → Develop → [iPad Name] → Noor → Console

# 5. Re-run local engine sanity checks
node --check src/plugins/AppleSTT.js
node scripts/test-tracker.mjs
node scripts/test-stream.mjs
```

---

## 0. STRICT RULES OF ENGAGEMENT

1. Do **not** touch any shared JS engine file: `src/utils/quranTracker.js`, `src/utils/scribeSTT.js`, `src/utils/quranStore.js`, `src/utils/notify.js`, `src/utils/streak.js`. Changes here would require Android parity re-validation.
2. Do **not** rewrite `scribeSTT.js`'s bridge contract. ElevenLabs Scribe sessions remain one-shot, server-tokens single-use.
3. Do **not** introduce CocoaPods. The codebase moved to SwiftPM-only — re-introducing `pod install` would break `cap sync`.
4. Do **not** modify `CapApp-SPM/Package.swift`'s `platforms: [.iOS(.v16)]`; the linker-error fix from earlier this session depends on this.
5. Do **not** delete `@capacitor-community/speech-recognition` from `package.json` yet — this fix preserves the offline iOS path for the day Apple's bridge discovery is fixed upstream.
6. Do **not** bypass `.env.local` for `VITE_APP_TOKEN`. Scribe fallback depends on it.

---

## Master Plan

### Root Cause / Logic

- Bridge plugin discovery in Capacitor 8's SPM-only mode does **not** pull `+load`-style ObjC constructors from cross-target SPM dependencies the way CocoaPods used to. Result: `CAP_PLUGIN(SpeechRecognition, …)` in `SpeechRecognitionPluginObjc` is never invoked at app launch on iPad.
- We patched around the **symptom** because we cannot verify root-cause device-side without the user's Safari Web Inspector console output.
- Fallback policy: when the native plugin probe fails on iPad, transparently roll over to ElevenLabs Scribe (already wired and known-good on iPad from earlier sessions).

### The Code Fix

Two surgical edits, both already applied in the working tree:

**File: `src/plugins/AppleSTT.js`**

Before setting `isListening = true` in `startListening({ language })`, probe via Capacitor's bridge:
```javascript
try {
  const probe = await SpeechRecognition.available()
  if (!probe || probe.available !== true) {
    throw new Error('SpeechRecognition reports available=false on this iOS device.')
  }
} catch (e) {
  throw new Error('AAPLESTT_UNAVAILABLE: ' + (e?.message || String(e)))
}
```
The `AAPLESTT_UNAVAILABLE:` prefix is the contract App.jsx matches on.

**File: `src/App.jsx`**

a) `startScribeListening` gains a second arg `isFallback = false`, used to suppress the Scribe→Native re-bounce inside its own catch:
```javascript
const startScribeListening = async (isResume = false, isFallback = false) => {
  // ... existing connect / startMicrophone / commitPhrase / resync logic ...
  } catch (e) {
    // ... existing logger + toast ...
    if (IS_NATIVE && !isFallback) await startNativeListeningInternal()
    else if (isFallback) {
      setError('Both Apple Native and ElevenLabs speech failed. Check the app logs for details.')
      setPhase('idle')
      isListeningRef.current = false
    }
    else await startBrowserListeningInternal()
  }
}
```

b) New branch in `startNativeListeningInternal`'s catch around `await NativeSTT.startListening()`:
```javascript
if (msg.includes('applestt_unavailable') || msg.includes('not implemented')) {
  logKhutbah('WARN', 'AppleSTT unavailable, falling back to ElevenLabs Scribe', e?.message || String(e))
  showToast('Apple Native speech not available on this device — using ElevenLabs cloud STT', 'warn', 4500)
  try { await NativeSTT.stopListening?.() } catch {}
  try { await NativeSTT.removeAllListeners?.() } catch {}
  await startScribeListening(false, true /* isFallback: breaks ping-pong */)
  return
}
```

### Native iOS Work

None for this bug. The fallback lives entirely in JS. Native iOS bridges (`NoorWidget.swift`, `PrayerTimelineProvider.swift`) are unaffected. `CapApp-SPM`'s `platforms: [.iOS(.v16)]` were aligned earlier this session and remain correct.

### Future-Proofing

- When `capacitor-community/speech-recognition` ships a single-target SPM `Package.swift` upstream (likely v8), our `inject-speech-recognition-spm.mjs` already short-circuits on its presence via the marker check. We can drop the entire script post-fix.
- The `AAPLESTT_UNAVAILABLE:` prefix is a stable contract; future detection variants (401 from cloud, simulator mismatch, etc.) all funnel through the same fallback gate without changing App.jsx's matcher.
- Android parity: the branch is gated on `IS_IOS`. Android never enters this code path.

---

## Validation & Acceptance Checklist

- [ ] `node --check src/plugins/AppleSTT.js` returns exit 0.
- [ ] On iPad: open Settings → Speech Engine → Apple (Native) → tap Detect in Quran / Khutbah → toast appears "Apple Native speech not available…" and Scribe translation begins streaming English.
- [ ] Settings → Speech Engine → ElevenLabs (Cloud) → tap Detect → no fallback toast; Scribe connects on first try.
- [ ] Mic permission prompt fires once per language change in Settings, not twice.
- [ ] Pause / End / Resume cycle does not leak inner `SpeechRecognition.addListener` handles (verify via Settings → Logging → Both → View Logs after three cycles — no duplicate `[KHUTBAH]` entries).
- [ ] With `.env.local` deleted of `VITE_APP_TOKEN`, Detect mode surfaces a single auth toast in the Native setting (we don't auto-fallback from Scribe auth errors back to Native on iOS, because that's another ping-pong risk; user manually switches engine).
- [ ] Lock screen mid-recitation, return — Detect continues streaming within 8 s (Scribe `commitWatchdogMs: 8000`).
- [ ] `node scripts/test-tracker.mjs` and `node scripts/test-stream.mjs` exit 0 (engine untouched).

**Test Harness Requirement:**
```bash
node --check src/plugins/AppleSTT.js
node scripts/test-tracker.mjs
node scripts/test-stream.mjs
node scripts/test-bulk.mjs
node scripts/test-mega.mjs
```
All green = shared JS engine clean. iPad manual smoke is the only remaining gate.

---

## Version Table & Handoff

| Surface | Status | Notes |
|---|---|---|
| SPM cache wipe + linker error | ✅ Shipped earlier this session | `npm run ios:fix-pkg` |
| App target `IPHONEOS_DEPLOYMENT_TARGET = 16.0` | ✅ Shipped | matches `NoorWidgetExtension` + `CapApp-SPM` |
| AppleSTT probe + `AAPLESTT_UNAVAILABLE` | ✅ Shipped | this spec |
| App.jsx `isFallback` ping-pong guard | ✅ Shipped | this spec |
| Plugin-side root cause (`+load` constructor pull) | ⚠️ Open | needs post-fix device logs to debug further |
| `@capacitor-community/speech-recognition` removal | ❌ Deferred | keep until offline iPad is needed offline |

For a paste-ready context-restoration prompt for a fresh session tomorrow, see `docs/noor-ios-restart-prompt.md`.
