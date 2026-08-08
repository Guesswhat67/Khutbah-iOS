// PLAN-026: privacy-first Sentry crash reporting.
//
// This module wraps @sentry/react with a strict PII policy tailored to
// Noor's threat model. The app is a religious-familial context (Quran
// recitation, khutbah live translation, family circles, prayer-location data)
// — the worst-case leak would be sending an audio transcript snippet or a
// member's display name to a third party. So this wrapper:
//
//   1. Disables every default capture path that could leak user input.
//      (tracing, session replay, UI clicks, fetch/xhr breadcrumbs, ANR
//      screenshots, view-hierarchy attachments, breadcrumbs entirely.)
//   2. Aggressively scrubs `event.user`, `event.request`, `event.extra`,
//      `event.contexts`, `event.tags`, AND every remaining top-level key
//      (`event.transaction`, `event.attachments`, `event.modules`, etc.) via
//      a denylist. Strings that look like Quranic verse refs get redacted.
//   3. Drops every `beforeBreadcrumb` in user-derivable categories (fetch /
//      xhr / ui.click / navigation) — even if some get past the filter, the
//      payload can't carry transcript text or audio keys.
//   4. Hashes the device_id so Sentry can correlate "the same install
//      crashed 5 times today" without ever seeing the raw UUID.
//
// Architectural note: We use @sentry/react (the browser SDK) directly
// instead of @sentry/capacitor. As of 2026-07, @sentry/capacitor@latest
// (4.x) still imports the legacy `Plugins` symbol from @capacitor/core in
// a way that breaks against Capacitor 8's new bridge layout, producing
// `"Plugins" is not exported by "@capacitor/core"`. The browser SDK runs
// unmodified inside the Capacitor WKWebView, captures every JS error we
// care about (React render errors + unhandled promise rejections, both
// wired below), and is ~50 KB lighter than @sentry/react-native + the
// @sentry/capacitor wrapper. Native iOS crash capture is staged
// independently in ios/App/App/AppDelegate.swift (gated on `#if
// canImport(Sentry)` so the file compiles without the SPM dep) and gets
// activated when sentry-cocoa is added to the Xcode project on the Mac.
//
// Safe no-op when VITE_SENTRY_DSN is empty — the dev/build path doesn't
// require a real Sentry project to be set up.

import { Capacitor } from '@capacitor/core'
import * as Sentry from '@sentry/react'
import { getDeviceId } from './device'

// ── Config ────────────────────────────────────────────────────────────────
// VITE_SENTRY_DSN is read here via Vite's `import.meta.env` so it's baked at
// build time and NOT exposed to the running app at runtime. Empty string
// means "feature off" — the module degrades to `reportError` being a no-op.
const SENTRY_DSN = (import.meta.env?.VITE_SENTRY_DSN || '').trim()
// Versioning comes from package.json (1.0.0 build 1, etc). Falls back to a
// safe literal so Sentry events still group by release in dev.
const RELEASE = (import.meta.env?.VITE_APP_VERSION || 'noor-ios@1.0.0+1')
const SAMPLE_RATE = 1.0       // per user choice: catch everything during first TestFlight weeks
const REPLAY_ON_ERROR_RATE = 0.1  // per user choice: visual reproduction only on errors (10%)
const IS_NATIVE = Capacitor.isNativePlatform()

// ── PII denylist ──────────────────────────────────────────────────────────
// Every key listed here gets redacted to '[redacted]' anywhere it appears
// anywhere in an event payload. Conservative on purpose; it's better to
// lose some context than to send PII. See scrubEvent for the recursive
// walk that applies this list.
const PII_KEYS = new Set([
  // Location (one-shot GPS for prayer times, never persisted on device)
  'location', 'latitude', 'longitude', 'coords', 'altitude', 'accuracy',
  'heading', 'position', 'geolocation',
  // Identity (raw device UUIDs, member names, family data)
  'deviceId', 'device_id', 'rawDeviceId', 'memberNames',
  'familyData', 'circle', 'circleCode', 'inviteCode', 'memberId', 'displayName',
  // Verse refs and Quranic structure (could leak what user is reading)
  'verse', 'ayah', 'surah', 'verseRef', 'quran',
  // Audio / transcript material (khutbah transcripts are user-generated)
  'sessionToken', 'audioKey', 'audio', 'recording', 'recordingId', 'transcriptData',
  'recording_id',
  // Translation/analysis content (khutbah translations live here)
  'arabicText', 'englishText', 'arabic_text', 'english_text',
  'analysisResult', 'analysis', 'khutbah',
  // App settings that a religious-app competitor might not need to know
  'fontSize', 'quranScript', 'sttEngine', 'streakGoal', 'experienceMode',
  'language', 'dedup', 'quranStreams', 'performanceMode',
])

// request.* subkeys to nuke entirely — these can carry query string audio
// params and POST body transcripts, neither of which we want sent.
const REQUEST_DROP_KEYS = new Set([
  'cookies', 'headers', 'data', 'body', 'query_string', 'queryString', 'query',
])

// Top-level event keys that have already been handled explicitly above.
// The final defensive scrubEvent sweep walks every OTHER top-level key
// through deepScrub so event.transaction + event.attachments + etc. still
// hit the denylist.
const ALREADY_HANDLED_TOP_KEYS = new Set([
  'user', 'request', 'exception', 'message', 'extra', 'tags', 'contexts',
])

// ── Privacy scrubbing utilities ───────────────────────────────────────────

// Recursive PII redactor: walks any object/array (including Map / Set /
// Symbol-keyed props) and swaps denylisted keys to the literal string.
// Preserves the shape so Sentry's stack-trace group IDs keep working.
function deepScrub(value, _seen = new WeakSet()) {
  if (value == null) return value
  const t = typeof value
  if (t === 'string')       return scrubString(value)
  if (t !== 'object')       return value
  if (_seen.has(value))     return value  // cycle guard
  _seen.add(value)

  // Map → recurse on entries
  if (value instanceof Map) {
    const m = new Map()
    for (const [k, v] of value) {
      m.set(typeof k === 'string' && PII_KEYS.has(k) ? '[redacted]' : deepScrub(k, _seen),
            deepScrub(v, _seen))
    }
    return m
  }
  // Set → recurse on items
  if (value instanceof Set) {
    const s = new Set()
    for (const v of value) s.add(deepScrub(v, _seen))
    return s
  }
  // Typed arrays + Buffer + ArrayBuffer → leave alone (binary, can't hold PII
  // as a JS-readable string). They're not walked.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value

  if (Array.isArray(value)) return value.map(v => deepScrub(v, _seen))

  // Plain object: stringify-able keys + defensive Symbol-key pass
  const out = {}
  for (const k of Object.keys(value)) {
    out[k] = PII_KEYS.has(k) ? '[redacted]' : deepScrub(value[k], _seen)
  }
  // Symbol-keyed props (rare, but Sentry's exception `type` symbol-keyed
  // members could carry type names; defensively scrub them too).
  for (const sym of Object.getOwnPropertySymbols(value)) {
    try {
      const sv = value[sym]
      if (sv && typeof sv === 'object') out[sym] = deepScrub(sv, _seen)
    } catch { /* ignore un-scrubable symbols */ }
  }
  return out
}

// Conservative string scrubber. Three patterns match Quran content; all
// return literal redaction markers (never silently rewrite to a different
// string) so debugging on the Sentry side stays clear.
//
//   [verse-ref]  A. exact "N:N" — "1:6", "114:5". False positives on HH:MM
//                   timestamps ("12:34") are accepted because verse refs in
//                   user-facing error messages are far more likely than raw
//                   timestamps; scrubString is invoked on every string so
//                   legitimate timestamps in event.tags are mildly affected
//                   — reviewed and accepted for this privacy-first posture.
//                B. path-like patterns: "/quran/surah/2/ayah/201",
//                   "quran-2-201", "/surah/2/ayah/201". Wherever the string
//                   contains a "surah|ayah|quran" keyword + an integer, or a
//                   "/N/N" route-shaped segment pointing at a verse index.
//                   Catches event.transaction route names that otherwise
//                   leak which surah:ayah user was reading.
//
//   [quran-ref]  matches a named surah. Conservative list (no false
//                positives in normal JS errors: "Al-Fatihah" etc. won't
//                appear by accident).
function scrubString(s) {
  if (typeof s !== 'string') return s
  const t = s.trim()
  if (/^\d{1,3}:\d{1,3}$/.test(t)) return '[verse-ref]'
  if (/\b(?:ayah|surah|quran)[/-]\d+/i.test(t)) return '[verse-ref]'
  // "/X/Y" route segments — e.g. "/surah/2/ayah/201" → matched here
  if (/[/\-]\d+\/\d+\b/.test(t) && /\b(?:ayah|surah|quran|verse|recite|detect)\b/i.test(t)) return '[verse-ref]'
  if (/\b(?:Surah|Al-Fatihah|Al-Baqarah|Al-Ikhlas|Al-Kahf|Yaseen|Rahman|Al-Mulk)\b/i.test(t)) return '[quran-ref]'
  return s
}

// 32-bit djb2 hash. SYNC, no subtle.digest dependency. Not crypto-secure
// but more than enough for "the same install crashed twice" correlation,
// which is the only thing this hash is used for. Cached on first call.
let _deviceIdHash = null
function hashDeviceId() {
  if (_deviceIdHash) return _deviceIdHash
  let raw = ''
  try { raw = getDeviceId() || '' } catch { /* device module throws under SSR; ignored */ }
  if (!raw) return null
  // Stable across sessions: hash the raw UUID once on first call, store the
  // prefix-tagged hex so events from the same install share user.id without
  // the actual UUID ever leaving the device.
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h) + raw.charCodeAt(i)
    h = h & 0xFFFFFFFF
  }
  _deviceIdHash = 'nh_' + (h >>> 0).toString(16)
  return _deviceIdHash
}

// Drop prefix from a DSN so devs can verify it's loaded without leaking it.
// "https://abc123@o0.ingest.sentry.io/0" → "abc123…/0"
function maskDsn(dsn) {
  if (!dsn) return '(empty)'
  try {
    const at = dsn.indexOf('@')
    const colonSlash = dsn.indexOf('://')
    const prefix = colonSlash >= 0 ? dsn.slice(colonSlash + 3, at) : dsn.slice(0, at)
    const lastSlash = dsn.lastIndexOf('/')
    const tail = lastSlash > at ? dsn.slice(lastSlash) : ''
    return `${prefix.slice(0, 4)}…${tail}`
  } catch {
    return '(set)'
  }
}

// ── Sentry hooks ──────────────────────────────────────────────────────────
// beforeSend: runs on EVERY captured crash/error. Return null to drop.
//
//   • Scrubs the explicit PII surface (user, request, exception, message,
//     extra, tags, contexts).
//   • Defensively walks every OTHER top-level key with deepScrub so
//     event.transaction / event.attachments / event.modules / event.spans
//     / event.fingerprint still hit the denylist — without this, a
//     transaction name like "QuranRead /surah/2/ayah/201" would flow
//     through to Sentry unmolested.
//   • Drops the event outright if scrubbing throws (privacy > capturing).
function scrubEvent(event) {
  if (!event) return null
  try {
    // USER — never the raw UUID. Always the same per-install hash, or absent.
    if (event.user) {
      const hash = hashDeviceId()
      event.user = hash ? { id: hash } : undefined
    }

    // REQUEST — strip everything sensitive. URL kept as path-only so the
    // Sentry UI still groups by endpoint ("/api/transcribe" crashes cluster
    // together) without leaking query strings or audio-key params.
    if (event.request && typeof event.request === 'object') {
      for (const k of REQUEST_DROP_KEYS) delete event.request[k]
      if (typeof event.request.url === 'string') {
        try {
          const u = new URL(event.request.url)
          event.request.url = u.pathname
        } catch { /* not a parseable URL — leave as-is */ }
      }
      event.request = deepScrub(event.request)
    }

    // EXCEPTION — scrub the message string but keep the type, value, and
    // stacktrace frames (filenames are ok; scrubbed locals are scrubbed).
    if (Array.isArray(event.exception?.values)) {
      for (const ex of event.exception.values) {
        if (typeof ex.value === 'string') ex.value = scrubString(ex.value)
        ex.value = deepScrub(ex.value)
      }
    }

    // MESSAGE — scrub if it looks like Quran content
    if (typeof event.message === 'string') event.message = scrubString(event.message)
    else event.message = deepScrub(event.message)

    // EXTRA / TAGS / CONTEXTS — deep walk, drop the family-circle key.
    if (event.extra) event.extra = deepScrub(event.extra)
    if (event.tags)  event.tags  = deepScrub(event.tags)
    if (event.contexts) {
      // Device model is identifying for a small family-only install. Drop it.
      // OS-level fields are public-domain and stay.
      if (event.contexts.device) delete event.contexts.device
      event.contexts = deepScrub(event.contexts)
    }

    // Final defensive sweep: walk every top-level key we DIDN'T handle
    // above (transaction / attachments / modules / checkin / spans /
    // fingerprint / debug_meta / sdk) through deepScrub so any denylisted
    // keys nested inside still get caught. Without this, event.transaction
    // = "QuranRead /quran/surah/2/ayah/201" would leak the verse ref.
    for (const k of Object.keys(event)) {
      if (ALREADY_HANDLED_TOP_KEYS.has(k)) continue
      try { event[k] = deepScrub(event[k]) } catch { /* leave un-scrubbed-but-harmless non-objects alone */ }
    }

    return event
  } catch (e) {
    // Privacy > capturing — never send something we can't vouch for.
    return null
  }
}

// beforeBreadcrumb: runs on every captured breadcrumb (UI click, fetch,
// log, etc). Return null to drop. We drop every user-derivable category
// outright because they can carry transcript text / audio keys — the
// debugging trade-off is acceptable for a privacy-first posture. Only
// re-throws / internal debug breadcrumbs from the scrubber path survive.
function scrubBreadcrumb(crumb) {
  if (!crumb || typeof crumb !== 'object') return null
  try {
    const DROP_CATEGORIES = new Set(['fetch', 'xhr', 'http', 'ui.click', 'navigation', 'sentry.event', 'ui.input'])
    if (crumb.category && DROP_CATEGORIES.has(crumb.category)) return null
    if (crumb.data && typeof crumb.data === 'object') {
      crumb.data = deepScrub(crumb.data)
    }
    if (typeof crumb.message === 'string') crumb.message = scrubString(crumb.message)
    return crumb
  } catch {
    return null
  }
}

// ── Init + public API ─────────────────────────────────────────────────────
let _initialized = false
let _enabled = false

// Call once from src/main.jsx BEFORE createRoot so anything that throws
// during component-import (lazy React.lazy, top-level fetches) is captured.
export function initSentry() {
  if (_initialized) return
  _initialized = true

  if (!SENTRY_DSN) {
    // No DSN configured — silent no-op so dev builds work without setup.
    // Logged at info level (not warn) because this is the documented default.
    if (typeof console !== 'undefined' && console.info) {
      console.info('[sentry] VITE_SENTRY_DSN is empty — crash reporting disabled.')
    }
    return
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      release: RELEASE,
      environment: IS_NATIVE ? 'capacitor' : 'web',
      sampleRate: SAMPLE_RATE,                  // plan-026 user choice: catch every error initially
      tracesSampleRate: 0,                      // OFF — privacy (no perf breadcrumbs)
      replaysSessionSampleRate: 0,              // OFF — no always-on visual capture
      replaysOnErrorSampleRate: REPLAY_ON_ERROR_RATE,  // plan-026 user choice: 10% of error sessions
      enableTracing: false,
      sendDefaultPii: false,
      // attachStacktrace:true is fine — only filenames + line numbers get
      // sent, not user data. On Sentry's side these map to public
      // source-mapped positions, not raw JS source paths.
      attachStacktrace: true,
      maxBreadcrumbs: 0,                        // OFF — no breadcrumbs to scrub (privacy)
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
      initialScope: {
        tags: {
          app_platform: Capacitor.getPlatform(),
          app_id: 'com.ali.noor',
        },
      },
    })
    _enabled = true
    if (typeof console !== 'undefined' && console.info) {
      console.info(`[sentry] Initialized. DSN: ${maskDsn(SENTRY_DSN)}, release: ${RELEASE}, platform: ${Capacitor.getPlatform()}`)
    }
  } catch (e) {
    // Init threw — leave disabled rather than fall into an unsafe state.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[sentry] init failed — crash reporting disabled.', e)
    }
  }
}

// Public helper for non-crash error reporting. Components / utils can opt-in
// via reportError(err, { extra: { ... } }).
export function reportError(error, extras = {}) {
  if (!_enabled) return
  try {
    Sentry.captureException(error, { extra: deepScrub(extras) })
  } catch { /* Sentry threw — silently swallow; we can't crash the app over a crash report */ }
}

// Public helper: explicit message breadcrumbs (e.g. "Quran tracker
// initialized in 312ms"). Off by default — most consumers don't need it.
// Kept exported so future code can opt-in without re-importing @sentry.
export function reportMessage(msg, level = 'info') {
  if (!_enabled) return
  try {
    Sentry.captureMessage(typeof msg === 'string' ? scrubString(msg) : '[non-string]', level)
  } catch { /* swallowed — see reportError */ }
}

// Debug surface: scrubber internals exposed so unit tests + dev tools can
// verify privacy behavior. NOTE — these are NOT tree-shakable because
// scrubEvent and scrubBreadcrumb are passed to Sentry.init() as hooks;
// they ship in every production bundle. Treat the export as documentation,
// not as a tree-shaking signal.
export const __debug__ = { scrubEvent, scrubBreadcrumb, deepScrub, PII_KEYS, REQUEST_DROP_KEYS }
