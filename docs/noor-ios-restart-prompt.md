# Session-Start Prompt — Noor iOS Parity (paste at the top of a new chat)

---

## 📖 About this file

This is a **paste-into-new-chat prompt** — a single block of context that you copy verbatim into the first message of a fresh MiniMax / Buffy / Claude / etc. session so the new AI knows the project state instantly.

It contains:

- A one-line **persona** reminder ("you are MiniMax, the elite iOS porting architect…").
- **CONTEXT FROM THE LAST SESSION** — every fix the previous session shipped (cache wipe script, deployment target bump, AppleSTT probe, Scribe fallback).
- **TODO TODAY** — the exact ordered steps to verify the iPad install + capture Safari Web Inspector output.
- **INVESTIGATION HINTS** — concrete `nm` and `xcrun simctl` commands to inspect the linked binary for the missing `@objc(SpeechRecognition)` symbol.
- **NEVER TOUCH** — the irreversible list (shared JS engine files, `quran.json`, `.env.local`, no-CocoaPods, no-deployment-below-iOS-16).
- **DOCS TO READ FIRST** — the load-order for the rest of `docs/`.

**How to use this file:**

1. Open a brand new AI chat session (e.g. Claude web, another Buffy run).
2. Open this file, scroll to the code block (the bit fenced with triple backticks immediately below this paragraph).
3. **Copy the entire code block** — every line inside the triple-backticks.
4. Paste it as the **first user message** of the new chat.
5. The new AI will respond with full project memory restored; you can then ask the next task ("run `npm run ios:sync`", "show me the prayer widget timeline", etc.).

**Do NOT confuse this with:**

| File | What it actually is |
|---|---|
| `docs/noor-ios-bugfix-2026-07-11.md` | The **narrative spec** for the Detect-mode fix: parity table, root cause, validation checklist, version table. Read first when catching up cold. |
| `docs/WORKFLOW.md` | The standing **plan → apply → log** workflow rule for new code changes. |
| `docs/CHANGES_LOG.md` | The **audit trail** — every code change, with exact line numbers + diffs. |
| `docs/LOG-ENTRY-TEMPLATE.md` | The strict format every `CHANGES_LOG.md` entry must follow. |
| `docs/PLAN-NNN-…md` | Individual **formal plan contracts** for each specific fix. |

This file is the **paste-prompt**; the others are the doc corpus. Pick the right one for what you're doing.

---

## 🚀 Shipped Artifacts

Per-build log of artifacts installed on the physical iPad (UDID `00008030-0004348E34C0C02E`). Append-only; newest first.

### 2026-07-11 — `com.ali.noor` v1.0.0 (Debug build, Xcode derived)

- **Plan reference:** PLAN-005 (ToastHost `setTimeout` leak) + PLAN-007 + PLAN-007.1 (Info.plist `NSExtensionPrincipalClass` removal)
- **Build target:** `App-*/Build/Products/Debug-iphoneos/App.app` (no archive — straight-to-iPad debug)
- **Artifact hash (SHA-256 of main binary `App.app/App`):** `ff06e84b68229702876bda794c09e0434ba3044ad3608f3c3e8672449a285301`
  - **Build-specific:** this is a fingerprint of the **Xcode DerivedData binary** for today's run only. It embeds compile/link timestamps + code-signature chain, so any rebuild (different Xcode SDK, link timestamp, or developer key) produces a different hash. Treat it as a *snapshotted identity* of THIS `.app`, not a reproducible source-hash.
- **Info.plist snapshot:** CFBundleVersion `1` · CFBundleShortVersionString `1.0` · CFBundleIdentifier `com.ali.noor` · MinimumOSVersion `15.0`
  - **Inconsistency note:** pbxproj `IPHONEOS_DEPLOYMENT_TARGET = 16.0` (per PLAN-002) but the Info.plist `MinimumOSVersion` is still `15.0` — follow-up fix tracked separately.
- **Device:** `00008030-0004348E34C0C02E` (Aayaan's iPad, verified via `xcrun devicectl listapps`)
- **Verification:** Direct `xcodebuild … DEVELOPMENT_TEAM=89RUQ4H8S5` exited `** BUILD SUCCEEDED **`; `xcrun devicectl listapps --device 00008030-0004348E34C0C02E | grep com.ali` registers the bundle.

---
You are MiniMax, operating as an elite iOS Porting Architect and QA Master
on the "Noor" iOS Capacitor 8 app at /Users/aayaanali/Desktop/Github Khutba App.
Android baseline is v8.23.0 (sacred); iOS app is v1.0.0 of the Capacitor 8.x port.

CONTEXT FROM THE LAST SESSION (2026-07-11):
- Shipped: scripts/ios-fix-pkg-cache.mjs (npm run ios:fix-pkg — wipes Xcode + SPM caches,
  re-runs npm postinstall + cap sync ios + xcodebuild -resolvePackageDependencies).
- Shipped: bumped ios/App/App.xcodeproj/project.pbxproj App target deployment target
  from 15.0 → 16.0 (matches NoorWidgetExtension + CapApp-SPM; fixes linker
  "CapApp-SPM.o built for newer iOS 16.0 than being linked 15.0").
- Shipped (paper doc): docs/noor-ios-bugfix-2026-07-11.md (this session).
- Shipped (code): src/plugins/AppleSTT.js — added a SpeechRecognition.available()
  probe before isListening=true. Throws "AAPLESTT_UNAVAILABLE: …" if the bridge
  native plugin isn't registered.
- Shipped (code): src/App.jsx — startScribeListening gained an isFallback = false
  second arg to suppress a Scribe→Native ping-pong when we already fell back from
  Native→Scribe. New branch in startNativeListeningInternal's catch around
  NativeSTT.startListening() detects "applestt_unavailable" / "not implemented"
  and routes the user to startScribeListening(false, true) with a toast.

TODO TODAY:
1. Run `npm run ios:sync && npm run ios:fix-pkg`. Reinstall on iPad. Hit Detect.
2. Open Safari on Mac → Develop → [iPad Name] → Noor → Console.
3. Paste the AAPLESTT_UNAVAILABLE throw line + the toast "Apple Native speech
   not available" + any Scribe connect logs.
4. From console logs, decide whether to push an upstream patch to
   github.com/capacitor-community/speech-recognition asking them to ship a
   single-target Package.swift (matches Capacitor 7+ plugin pattern, no more
   user-side dual-target split) — OR keep the runtime fallback as the durable
   answer if Apple's bridge discovery is the actual culprit.

INVESTIGATION HINTS:
- Run `nm ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/CapApp-SPM.build/
  Release-iphoneos/CapApp-SPM.build/Objects-normal/arm64/CapApp-SPM.o | grep -i SpeechRecognition`
  to see if the @objc(SpeechRecognition) symbol actually lives in the linked binary.
- Compare against `nm …/CapApp-SPM.o | grep Capacitor` to confirm healthy plugins
  ARE in there, isolating the broken one.
- After SIGKILL-ing Xcode, run `xcrun simctl install booted ios/App/build/Debug-iphoneos/App.app`
  to fast-deploy without a full Xcode build.

NEVER TOUCH:
- src/utils/quranTracker.js, src/utils/scribeSTT.js, src/utils/quranStore.js,
  src/utils/streak.js, src/utils/notify.js (shared with Android; changes need
  Android parity re-validation).
- public/quran.json, public/hadith-books/* (immutable sources).
- .env.local (borrowed secrets).
- NEVER re-introduce CocoaPods.
- NEVER bump IPHONEOS_DEPLOYMENT_TARGET below 16 again.
- NEVER delete scripts/inject-speech-recognition-spm.mjs or src/plugins/AppleSTT.js
  yet — the runtime fallback is the durable answer until we have proof the plugin
  can register on iPad.

DOCS TO READ FIRST (in this order):
- docs/noor-ios-bugfix-2026-07-11.md — full MiniMax-style spec for this fix.
- NOOR_IOS.md — design doc; load-bearing for permissions / widget / notification rules.
- ios/App/App.xcodeproj/project.pbxproj — IPHONEOS_DEPLOYMENT_TARGET = 16.0 for App +
  NoorWidgetExtension targets (lines ~322, 366, 487, 530).
- ios/App/CapApp-SPM/Package.swift — platforms: [.iOS(.v16)] (must stay 16).
```
