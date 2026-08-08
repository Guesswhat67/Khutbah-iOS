#!/usr/bin/env node
// scripts/ios-fix-pkg-cache.mjs
//
// One-shot recovery from Xcode's stale "Missing package product" UI error
// in iOS Capacitor 8 projects with locally-injected SPM packages
// (e.g. @capacitor-community/speech-recognition's dual-target patch via
// scripts/inject-speech-recognition-spm.mjs).
//
// Root cause: when SPM resolves cleanly via `xcodebuild -resolvePackageDependencies`
// but the Xcode IDE STILL shows "Missing product X" in the project navigator,
// the IDE is bound to a stale Package-resolution snapshot in one of:
//
//   • ~/Library/Caches/org.swift.swiftpm/        ← global SPM manifest cache
//   • ~/Library/org.swift.swiftpm/               ← global SPM metadata store
//   • ~/Library/Caches/com.apple.dt.Xcode/       ← Xcode UI history/snapshots
//   • ~/Library/Developer/Xcode/DerivedData/    ← build outputs + workspace checks
//   • <proj>/ios/App/App.xcodeproj/xcuserdata/  ← project-embedded IDE state
//   • <proj>/.../swiftpm/Package.resolved       ← forces SPM to re-pick versions
//
// Wiping these and re-running `npx cap sync ios` forces SPM to bake a fresh
// resolver graph into the Xcode IDE on next open.
//
// Usage:
//   npm run ios:fix-pkg           # interactive (default: auto-quits Xcode, wipes)
//   npm run ios:fix-pkg -- --dry-run  # print the plan, take no action
//   npm run ios:fix-pkg -- --no-quit  # skip auto-quitting Xcode (you do it)
//
// Exit code: 0 if post-wipe `xcodebuild -resolvePackageDependencies` succeeds,
// 1 otherwise.

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const noQuit = args.has('--no-quit')

// All Xcode cache paths below are macOS-specific. Refuse to run on other
// platforms instead of silently destroying files in the wrong location.
if (process.platform !== 'darwin') {
  console.error(`ERROR: ios-fix-pkg-cache only runs on macOS (got: ${process.platform}).`)
  console.error('The Xcode/SPM global cache paths it wipes are macOS-only.')
  process.exit(2)
}

const home = os.homedir()
const projectRoot = process.cwd()
const iosDir = path.join(projectRoot, 'ios/App')
const xcodeproj = path.join(iosDir, 'App.xcodeproj')

const targets = [
  // Project-scoped (safe to wipe — regenerated on next build).
  path.join(xcodeproj, 'xcuserdata'),
  path.join(xcodeproj, 'project.xcworkspace/xcuserdata'),
  path.join(xcodeproj, 'project.xcworkspace/xcshareddata/swiftpm/Package.resolved'),
  // Global SPM caches — the "hidden boss" of stale local-manifest caching.
  path.join(home, 'Library/Caches/org.swift.swiftpm'),
  path.join(home, 'Library/org.swift.swiftpm'),
  // Xcode UI history caches.
  path.join(home, 'Library/Caches/com.apple.dt.Xcode'),
  // Build outputs + workspace-checks metadata.
  path.join(home, 'Library/Developer/Xcode/DerivedData'),
]

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts })
}

function hr(c) {
  return c.repeat(60)
}

console.log(hr('='))
console.log('ios-fix-pkg-cache  —  Xcode SPM cache recovery')
console.log('project:', projectRoot)
console.log('mode:  ', dryRun ? 'DRY RUN (no changes)' : 'LIVE (wipes + re-syncs)')
console.log(hr('='))

// 1. Quitting Xcode is required: wiping xcuserdata while Xcode is open can
//    race with its FileCoordination writes and re-cache the negative state.
if (!noQuit) {
  console.log('\n[1/5] Quitting Xcode...')
  if (!dryRun) {
    // `quit saving no` is critical: plain `quit app "Xcode"` will block on
    // any unsaved-document dialog ("Save changes to ... before closing?")
    // and hang this script indefinitely. We're nuking SPM caches anyway —
    // the user explicitly invoked this script knowing it nukes state.
    const r = spawnSync('osascript', [
      '-e',
      'tell application "Xcode" to quit saving no',
    ])
    if (r.status !== 0 && r.stderr?.toString().trim()) {
      console.warn('  (osascript note):', r.stderr.toString().trim())
    }
    // Brief settle so Xcode fully releases file handles before we wipe xcuserdata.
    spawnSync('sleep', ['1'])
  } else {
    console.log('  (dry-run, skipping osascript)')
  }
} else {
  console.log('\n[1/5] Skipping Xcode quit (--no-quit). Make sure Xcode is closed!')
}

// 2. Wipe caches.
console.log('\n[2/5] Wiping caches...')
for (const t of targets) {
  if (existsSync(t)) {
    if (dryRun) {
      console.log('  would remove:', t)
    } else {
      try {
        rmSync(t, { recursive: true, force: true })
        console.log('  ✓ removed:', t)
      } catch (e) {
        console.warn('  ⚠ failed:', t, '—', e.message)
      }
    }
  } else {
    console.log('  · absent:', t)
  }
}

// 3. Re-run postinstall so the inject script re-establishes the dual-target
//    Package.swift inside node_modules/@capacitor-community/speech-recognition
//    (idempotent — leaves an upstream-shipped Package.swift alone).
console.log('\n[3/5] Re-running postinstall...')
if (!dryRun) run('npm run --silent postinstall', { stdio: 'inherit' })
else console.log('  (dry-run, skipping npm postinstall)')

// 4. capacitor sync regenerates CapApp-SPM/Package.swift from the registered
//    plugins in package.json (it adds the speech-recognition `.package()` and
//    `.product()` lines we depend on).
console.log('\n[4/5] cap sync ios...')
if (!dryRun) run('npx --yes cap sync ios', { stdio: 'inherit' })
else console.log('  (dry-run, skipping cap sync)')

// 5. Re-resolve and verify. If this prints `CapacitorCommunitySpeechRecognition`
//    in the resolved graph, the cache wipe did its job — re-open Xcode and try
//    the build.
console.log('\n[5/5] xcodebuild -resolvePackageDependencies...')
if (dryRun) {
  console.log('  (dry-run, skipping resolve)')
  process.exit(0)
}
try {
  run(
    'xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App -configuration Debug',
    { stdio: 'inherit' }
  )
  console.log('\n' + hr('✓'))
  console.log('SPM re-resolved successfully. Re-open Xcode and try your build.')
  console.log(hr('✓'))
} catch (e) {
  console.error('\n' + hr('✗'))
  console.error('SPM re-resolve FAILED. Re-run with the error log for debugging:')
  console.error(
    '  xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App -configuration Debug -verbose'
  )
  console.error(hr('✗'))
  process.exit(1)
}
