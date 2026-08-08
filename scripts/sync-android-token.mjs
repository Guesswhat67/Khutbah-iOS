#!/usr/bin/env node
// Sync VITE_APP_TOKEN from the Android app (Khutbah/.env.local) into the iOS app
// (.env.local at repo root). Vite bakes VITE_* into the JS bundle at build time,
// so this needs to run before `npm run build` (wired in via the `prebuild` hook
// in package.json) — that way every Mac / CI build just picks up whatever the
// Android app is using, with zero manual steps.
//
// Rules:
//   - Idempotent. Safe to run repeatedly.
//   - Never overwrites an existing iOS VITE_APP_TOKEN (warns instead, so a Mac
//     that intentionally uses a different token is not silently clobbered).
//   - If the Android .env.local doesn't exist or has no VITE_APP_TOKEN, warn and
//     do nothing (never delete an existing iOS value).
//   - Errors don't throw — print a clear warning so a missing token never breaks
//     a build that doesn't need AI features (the trackers, corpus, etc. all
//     work offline; only /api/* calls need the token).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ANDROID_ENV = join(ROOT, 'Khutbah', '.env.local')
const IOS_ENV = join(ROOT, '.env.local')
const KEY = 'VITE_APP_TOKEN'

function parseEnv(file) {
  if (!existsSync(file)) return {}
  const out = {}
  const text = readFileSync(file, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
  }
  return out
}

function writeToken(file, key, value) {
  const body =
    `# Auto-synced from android app (Khutbah/.env.local) by scripts/sync-android-token.mjs.\n` +
    `# Edit the Android source instead so both builds stay in sync.\n` +
    `${key}=${value}\n`
  writeFileSync(file, body, 'utf8')
}

function masked(v) {
  if (!v) return '(empty)'
  return v.length <= 8 ? v.slice(0, 2) + '…' : v.slice(0, 4) + '…' + v.slice(-2)
}

const android = parseEnv(ANDROID_ENV)
const ios = parseEnv(IOS_ENV)

if (!android[KEY]) {
  console.warn(
    `[sync-token] No ${KEY} found in ${ANDROID_ENV}. Skipping.\n` +
      `[sync-token] Create Khutbah/.env.local with ${KEY}=<value> and re-run.`
  )
  process.exit(0)
}

if (ios[KEY] && ios[KEY] === android[KEY]) {
  console.log(`[sync-token] ${KEY} already in sync.`)
  process.exit(0)
}

if (ios[KEY] && ios[KEY] !== android[KEY]) {
  console.warn(
    `[sync-token] iOS .env.local has a different ${KEY} — leaving it untouched.\n` +
      `[sync-token]   android: ${masked(android[KEY])}\n` +
      `[sync-token]   ios:     ${masked(ios[KEY])}\n` +
      `[sync-token]   rm .env.local if you want to adopt the android value.`
  )
  process.exit(0)
}

writeToken(IOS_ENV, KEY, android[KEY])
console.log(`[sync-token] Copied ${KEY} ${masked(android[KEY])} from ${ANDROID_ENV} → ${IOS_ENV}`)
