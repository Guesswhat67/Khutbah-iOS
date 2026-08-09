# Khutbah App — Agent Communication File

**Last updated: 2026-06-10 — Session Sync Update**

---

## Git Sync Status (June 10, 2026)

### Cloud Branches
| Branch | Status | Description |
|--------|--------|-------------|
| `origin/main` | Behind AayaaniOS | Older, stable — QuranMode.jsx (379L), App.jsx (387L) |
| `origin/AliAndroid` | Ahead of main | Has autocomplete cloud function |
| `origin/aliandroidv2` | **Most feature-rich** | QuranMode.jsx (508L), App.jsx (1017L), superior verse matching |
| `origin/master` | Synced with local master | Has `hello.txt`, v4.5.12 logging |
| `AayaaniOS` (local+cloud) | **Most up-to-date** | Merged aliandroidv2 → best web + iOS combined |

### Local Worktrees
| Location | Branch | Status |
|----------|--------|--------|
| `Khutbah/` (main repo) | `AayaaniOS` | Synced — merged aliandroidv2 web layer |
| `Khutbah/ios-app/Khutba/` (nested iOS repo) | `aayaanios-local` | Has un-pushed refactor commit (872c89b, +463K lines) |

### Git Sync Actions Taken
- ✅ `AayaaniOS` merged with `origin/aliandroidv2` (full web layer update, `-X theirs` for conflicts)
- ✅ `master` synced with `origin/master` via rebase + push
- ✅ `AayaaniOS` pushed to cloud — up-to-date
- ⏳ `aayaanios-local` branch in nested ios-app repo — **NOT YET PUSHED** (large commit, timed out)

---

## iOS App — ContentViewController.swift Fixes (June 10)

Applied all fixes to `Khutbah/ios-app/Khutba/Khutba/ContentViewController.swift`:

### API Fixes ✅
- `initialize(quranMode: false)` → `initialize(mode: .khutbah)` (matches SherpaSTTManager API)
- `stopListening()` → `stopListening { _ in }` (matches SherpaSTTManager API)

### Scope Fix ✅
- Added missing `}` before `// MARK: - Quran Mode Data` (was inside `startTimer()` closure)
- Made `findVerse` `private static` (returns private type `QuranVerse?`)

### Code Review Fixes ✅
- Added `loadQuranData()` call in `viewDidLoad()` (was never called — verses never loaded)
- Removed unused `Identifiable` and `id` field from `QuranVerse` struct
- Pre-computed `totalWords` once before loops in `findVerse` (performance fix)
- Fixed Phase 2 scope: `best`/`bestScore` declared locally inside `if let cur` block
- Fixed Phase 3 scope: `best`/`bestScore` declared before `if let lock` block
- Removed `id:` from `QuranVerse` initialization call site

### 4-Phase Surah-Aware `findVerse` Algorithm ✅
Replaces old 3-phase linear search with:
- **Phase 1**: Sequential nearby search (±5 verses, boundary-aware)
- **Phase 2**: Full scan in current surah (local `best`/`bestScore`)
- **Phase 3**: SurahLock → global fallback (declared before `if let lock`)
- **Phase 4**: Levenshtein similarity fallback

### Build Status ✅
- **BUILD SUCCEEDED** — zero errors
- All pre-existing warnings remain (TranslationWrapper.mm unused functions, duplicate `onnxruntime.a`, `appintentsmetadataprocessor` skipped)

---

## Session Timeline — June 10, 2026

| Phase | Status |
|-------|--------|
| ContentViewController.swift fixes (API, scope, algorithm) | ✅ Complete |
| Git sync: AayaaniOS merged aliandroidv2 | ✅ Complete |
| Git sync: master synced + pushed | ✅ Complete |
| iOS nested repo commit (aayaanios-local) | ✅ Done — NOT YET PUSHED |
| iOS build verification | ✅ BUILD SUCCEEDED |
| Push `aayaanios-local` to cloud | ⏳ Pending — timed out, needs retry |
| QuranMode_master.jsx creation | ⏳ Pending |

---

## Pending Work

### High Priority

**1. Push `aayaanios-local` to cloud** (timed out — needs retry)
Large commit (+463K lines) with refactored iOS structure:
- `AppDelegate.swift` (UIApplicationMain entry point)
- `LanguagePackManager.swift`, `ModelManager.swift`
- `arabic-english-dict.json` (50K+ entries), `hadith-bukhari.json` (7 books)
- `sherpa-onnx.xcframework`, `tarteel-onnx.xcframework`
- Deleted: old `SherpaSTTManager.swift`, `TranslationService.swift`, `SherpaWrapper.m`

⚠️ **Push repeatedly times out.** Git trace shows URL resolving to
`github.com/aay-ali/Khutba.git` instead of `aliyaqoob7575160/Khutbah`
— possible credential cache issue. Tried switching to SSH URL but
timed out again. User may need to:
```bash
# Clear wrong credentials from OS X keychain
git credential-osxkeychain erase
# (host=github.com, protocol=https)

# Then re-authenticate with aliyaqoob7575160 credentials
# Or use SSH URL directly:
cd Khutbah/ios-app/Khutba
git remote set-url origin git@github.com:aliyaqoob7575160/Khutbah.git
git push -u origin aayaanios-local
```

**2. Create `QuranMode_master.jsx`**
Combine the best features from:
- `src/QuranMode.jsx` (aliandroidv2 — 508L, superior algorithm)
- `src/QuranMode_master.jsx` (AayaaniOS — reference mode)
- Wire `findVerse` into the STT transcription flow in the web layer

---

## Error Log (All Fixed ✅)

| Date | Error | Fix |
|------|-------|-----|
| 2026-06-07 | Cannot find 'OrtCreateEnv' in scope (12 errors) | Removed direct ONNX C API calls; built TranslationWrapper.mm with OrtApi struct |
| 2026-06-07 | ModelManager TranslationModelEntry private type in public method | Changed `private struct` → `struct` |
| 2026-06-07 | LanguagePackManager @Published errors | Removed @Published, ObservableObject, Combine |
| 2026-06-07 | TranslationWrapper.mm `_vocab.count` non-static member | Changed to `_vocab.empty()` |
| 2026-06-07 | AppDelegate `.allowBluetoothHFP` invalid | Changed to `.allowBluetooth` |
| 2026-06-07 | iPad 9 black screen — all tabs + speech model loaded at launch | Deferred all heavy init; tabs created on-demand; model lazy-loaded |
| 2026-06-08 | Mic not picking up voice — VAD silently dropping all chunks | Reverted vadSilenceThreshold to 0.003, vadSpeechRatio to 0.2, chunkDuration to 0.6s |
| 2026-06-08 | onnxruntime.xcframework path wrong in project.pbxproj | Fixed path to `ios-onnxruntime/1.17.1/onnxruntime.xcframework` |
| 2026-06-08 | Simulator black screen — no crash logs, no debug output | SFSpeechRecognizer fallback for simulator via `#if targetEnvironment(simulator)` |
| 2026-06-08 | SherpaSTTManager.initialize() hangs on simulator | Added 15s timeout + resetAfterError() with proper C++ destroy() call |
| 2026-06-08 | resumeListening() never called startRecording() | Added `recorder.startRecording()`, `recorder.onError` handler, `self.audioService = recorder` |
| 2026-06-08 | Audio level throttle leaked between recording sessions | Reset `lastAudioLevelUpdate = .distantPast`, `pendingAudioLevel = 0` on each start |
| 2026-06-08 | App laggy on iPad — currentAudioLevel Combine storm (~16k/sec) | Throttled to max 30fps using pendingAudioLevel + lastAudioLevelUpdate Date check |
| 2026-06-08 | DeviceCapability.summary recomputed on every access | Cached as `cachedSummary: String` computed once in `init()` |
| 2026-06-09 | Loading spinner shown during model init but no status text | Added `statusLabel.text = "⏳ Loading speech model..."` in KhutbahTabView isInitializing sink |
| 2026-06-09 | Cloud translation hangs 30+ seconds when Wi-Fi is off | Added 3-second timeout fallback using NSLock + asyncAfter in translateViaCloud |
| 2026-06-09 | DEBUG print statements present in Release builds | Wrapped all `[DEBUG]` prints in `#if DEBUG`/`#endif` |
| 2026-06-09 | Font sizes ignore iOS Dynamic Type accessibility settings | Changed Layout.bodyFont/arabicFont to computed `var` using `scaledForAccessibility()` |
| **2026-06-10** | initialize(quranMode: false) API mismatch | Changed to `initialize(mode: .khutbah)` |
| **2026-06-10** | MARK and struct inside `startTimer()` closure scope | Added `}` before `// MARK: - Quran Mode Data` |
| **2026-06-10** | `findVerse` returns private type but not declared private | Made `private static func findVerse` |
| **2026-06-10** | Phase 2/3 `best`/`bestScore` scope errors | Declared locally inside `if let` blocks |
| **2026-06-10** | `loadQuranData()` never called — verses always empty | Added call in `viewDidLoad()` |
| **2026-06-10** | `totalWords` recomputed in every loop iteration | Pre-compute once before loops |
| **2026-06-10** | `QuranVerse(id:)` but `id` removed from struct | Removed `id:` from initialization call site |

---

## Build Warnings (Pre-existing — not introduced this session)

| Warning | Source | Action |
|---------|--------|--------|
| `unused function 'split'` | TranslationWrapper.mm | Intentional — future ONNX work, harmless |
| `unused function 'readFile'` | TranslationWrapper.mm | Intentional — future ONNX work, harmless |
| `attribute warn_unused_result` (11×) | TranslationWrapper.mm | Intentional — C++ ONNX API pattern |
| `duplicate library: onnxruntime.a` | linker | Pre-existing, harmless |
| `appintentsmetadataprocessor` skipped | Swift Intents | Pre-existing, no AppIntents used |

---

## How to Launch on iPad (USB Trust Step Required)

**On your iPad:**
1. Plug iPad into Mac
2. Go to **Settings → General → Device Management**
3. Tap **"Apple Development: Aayaan Ali (89RUQ4H8S5)"**
4. Tap **"Trust"** → confirm

**Then run on your Mac:**
```bash
cd Khutbah/ios-app/Khutba
xcrun devicectl device process launch --device 00008030-0004348E34C0C02E com.aayaan.khutbah.Khutba
```

---

## Build Commands

```bash
# Build iOS for generic iOS (simulator + device)
cd Khutbah/ios-app/Khutba
xcodebuild -project Khutba.xcodeproj -scheme Khutba -configuration Debug -destination 'generic/platform=iOS' build

# Build for specific simulator
xcodebuild -project Khutba.xcodeproj -scheme Khutba -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO

# Build for iPad (requires signing)
xcodebuild -project Khutba.xcodeproj -scheme Khutba -configuration Debug -destination 'id=00008030-0004348E34C0C02E' build CODE_SIGN_IDENTITY="Apple Development" DEVELOPMENT_TEAM=89RUQ4H8S5

# Build web frontend
cd Khutbah && npm run dev
```

---

## Project File Locations

| Path | Description |
|------|-------------|
| `Khutbah/ios-app/Khutba/Khutba/` | iOS source files — Xcode project root is `Khutbah/ios-app/Khutba/` |
| `Khutbah/ios-app/Khutba/` (nested git repo) | Separate git repository with remote `https://github.com/aliyaqoob7575160/Khutbah` |
| `Khutbah/src/` | Web frontend files (React/Vite) |
| `Khutbah/public/quran.json` | Quran Arabic-English data (7,623 verses) |
| `Khutbah/whisper.cpp/` | Local Whisper.cpp source |
| `Khutbah/functions/api/` | Cloudflare Worker API functions |