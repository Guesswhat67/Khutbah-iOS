// @capacitor-community/speech-recognition@7.0.1 ships its iOS source at
// node_modules/@capacitor-community/speech-recognition/ios/Plugin/ as a mix of
// Swift (.swift) AND Objective-C (.h, .m) files. Our iOS project migrated to
// Swift Package Manager instead of CocoaPods, and SPM forbids a single target
// from compiling mixed-language sources.
//
// The plugin's Plugin.m contains the CAP_PLUGIN(...) macro that imperatively
// registers the plugin's methods with Capacitor's runtime. We CAN'T just
// exclude it. So we split the sources into two SPM targets (Swift + ObjC),
// each holding one language. The Swift target depends on the ObjC target so
// they link together. This pattern is what Capacitor 7+ ships natively for
// SPM-friendly community plugins.
//
// Idempotent: if Package.swift is missing or doesn't carry our injection
// marker, we (re)run the migration. If a future upstream Package.swift ships,
// our marker check leaves it untouched so a fix-upstream PR can drop this
// whole script.
//
// This script runs as `postinstall` (see package.json), so a fresh
// `npm install` always re-establishes the dual-target layout even if the
// upstream package wipes it.

import fs from 'fs'
import path from 'path'

const pluginRoot = path.resolve(
  process.cwd(),
  'node_modules/@capacitor-community/speech-recognition'
)
const targetPath = path.join(pluginRoot, 'Package.swift')
const swiftDir = path.join(pluginRoot, 'ios/Plugin')
const objcDir = path.join(pluginRoot, 'ios/PluginObjc')

const marker = 'Injected by scripts/inject-speech-recognition-spm.mjs'

// Idempotency: if Package.swift exists and isn't ours, upstream has shipped
// one — leave it alone (don't risk breaking their future fix).
if (fs.existsSync(targetPath)) {
  const existing = fs.readFileSync(targetPath, 'utf8')
  if (!existing.includes(marker)) {
    console.log(
      '[inject-speech-recognition-spm] Found an unrelated Package.swift — leaving it untouched.'
    )
    process.exit(0)
  }
  console.log(
    '[inject-speech-recognition-spm] Refreshing previously-injected dual-target Package.swift.'
  )
} else {
  console.log(
    '[inject-speech-recognition-spm] No Package.swift found — injecting dual-target Package.swift.'
  )
}

// Step 1: Physically move Plugin.m + Plugin.h out of ios/Plugin into a sibling
// directory so each directory holds one language's source. Re-runs are safe:
// renameSync over an existing dest will overwrite (so re-installs reset the
// split layout even after a branch switch or git pull).
if (!fs.existsSync(objcDir)) {
  fs.mkdirSync(objcDir, { recursive: true })
}
for (const file of ['Plugin.m', 'Plugin.h']) {
  const src = path.join(swiftDir, file)
  const dest = path.join(objcDir, file)
  // If upstream moves it back to the Swift folder, send it back to ObjC.
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest)
  }
}

const manifest = `// swift-tools-version: 5.9
import PackageDescription

// ${marker} on postinstall because the upstream plugin's ios/Plugin folder
// contains both Swift and Objective-C sources, which SPM forbids in a single
// target. We split them into two SPM targets (Swift + ObjC) and link them via
// a target dependency, preserving the CAP_PLUGIN(...) macro's imperative
// runtime registration.
//
// If the upstream plugin ever ships a Package.swift of its own, our inject
// script's marker check will leave it alone — drop this script then.

let package = Package(
    name: "CapacitorCommunitySpeechRecognition",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorCommunitySpeechRecognition",
            targets: ["SpeechRecognitionPlugin", "SpeechRecognitionPluginObjc"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.4.1")
    ],
    targets: [
        .target(
            name: "SpeechRecognitionPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                "SpeechRecognitionPluginObjc"
            ],
            path: "ios/Plugin"),
        .target(
            name: "SpeechRecognitionPluginObjc",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "ios/PluginObjc",
            publicHeadersPath: ".")
    ]
)
`

fs.writeFileSync(targetPath, manifest)
console.log(
  '[inject-speech-recognition-spm] Wrote dual-target Package.swift at ' +
    targetPath
)
