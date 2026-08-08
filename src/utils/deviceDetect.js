// Device detection + perf-tier classification.
//
// Why UA-based (no @capacitor/device SPM dep):
//   - App is already on Capacitor 8 + iOS 16+ WKWebView. UA reliably says
//     "iPad" or "iPhone" but not the specific model (Apple strips HW model).
//   - Adding @capacitor/device would mean another SPM dependency in
//     CapApp-SPM/Package.swift + another `npx cap sync ios` cycle + a
//     native re-link step on the Mac.
//   - Adding a manual picker UI is only one tap — and it's the user-explicit
//     truth-source for tier (which Sentry/sentry_cocoa can't reliably give).
//
// Tiers (chosen against the app's frame budget on iOS 16+):
//   high   — M-series + A15+ on iPhone, M-series iPads, recent iPad Pros
//   medium — A13/A14 + older iPad / iPhone (the iPad 9 sits here = medium)
//   low    — A11/A12 / older iPhones (iPhone 8/XR). Falls back to "high"
//            graphics but capped audio analyzer cadence.
//
// The catalog is grouped + ordered so the picker reads top-to-bottom newest→oldest
// (tabs > phones). Tier badges light up the cost knob the app will dial.

const DEVICE_CATALOG = [
  // ── iPad Pro (M-series, always high) ─────────────────────────────────────
  { id: 'ipad-pro-m4',     group: 'iPad Pro', name: 'iPad Pro (M4)',     sub: 'M4 · 11"/13"',          chip: 'M4',     tier: 'high'   },
  { id: 'ipad-pro-m2',     group: 'iPad Pro', name: 'iPad Pro (M2)',     sub: 'M2 · 11"/12.9"',        chip: 'M2',     tier: 'high'   },
  { id: 'ipad-pro-m1',     group: 'iPad Pro', name: 'iPad Pro (M1)',     sub: 'M1 · 11"/12.9"',        chip: 'M1',     tier: 'high'   },
  { id: 'ipad-pro-a12z',   group: 'iPad Pro', name: 'iPad Pro (A12Z)',   sub: 'A12Z · 11"/12.9"',      chip: 'A12Z',   tier: 'high'   },

  // ── iPad Air ─────────────────────────────────────────────────────────────
  { id: 'ipad-air-m3',     group: 'iPad Air', name: 'iPad Air (M3)',     sub: 'M3 · 11"/13"',          chip: 'M3',     tier: 'high'   },
  { id: 'ipad-air-m2',     group: 'iPad Air', name: 'iPad Air (M2)',     sub: 'M2 · 11"/13"',          chip: 'M2',     tier: 'high'   },
  { id: 'ipad-air-5',      group: 'iPad Air', name: 'iPad Air (5th gen)',sub: 'M1 · 10.9"',            chip: 'M1',     tier: 'high'   },
  { id: 'ipad-air-4',      group: 'iPad Air', name: 'iPad Air (4th gen)',sub: 'A14 · 10.9"',           chip: 'A14',    tier: 'medium' },

  // ── iPad (regular) ───────────────────────────────────────────────────────
  { id: 'ipad-11',         group: 'iPad',     name: 'iPad (A16)',        sub: 'A16 · 11"',             chip: 'A16',    tier: 'high'   },
  { id: 'ipad-10',         group: 'iPad',     name: 'iPad (10th gen)',   sub: 'A14 · 10.9"',           chip: 'A14',    tier: 'medium' },
  { id: 'ipad-9',          group: 'iPad',     name: 'iPad (9th gen)',    sub: 'A13 · 10.2"',           chip: 'A13',    tier: 'medium' },
  { id: 'ipad-8',          group: 'iPad',     name: 'iPad (8th gen)',    sub: 'A12 · 10.2"',           chip: 'A12',    tier: 'medium' },
  { id: 'ipad-7',          group: 'iPad',     name: 'iPad (7th gen)',    sub: 'A10 · 10.2"',           chip: 'A10',    tier: 'low'    },

  // ── iPad mini ────────────────────────────────────────────────────────────
  { id: 'ipad-mini-7',     group: 'iPad mini',name: 'iPad mini (A17 Pro)',sub:'A17 Pro · 8.3"',        chip: 'A17',    tier: 'high'   },
  { id: 'ipad-mini-6',     group: 'iPad mini',name: 'iPad mini (6th gen)',sub:'A15 · 8.3"',            chip: 'A15',    tier: 'high'   },
  { id: 'ipad-mini-5',     group: 'iPad mini',name: 'iPad mini (5th gen)',sub:'A12 · 7.9"',            chip: 'A12',    tier: 'medium' },

  // ── iPhone (Pro / non-Pro) ───────────────────────────────────────────────
  { id: 'iphone-16-pro',   group: 'iPhone',   name: 'iPhone 16 Pro',     sub: 'A18 Pro · 6.3"/6.9"',  chip: 'A18',    tier: 'high'   },
  { id: 'iphone-16',       group: 'iPhone',   name: 'iPhone 16',         sub: 'A18 · 6.1"/6.7"',      chip: 'A18',    tier: 'high'   },
  { id: 'iphone-15-pro',   group: 'iPhone',   name: 'iPhone 15 Pro',     sub: 'A17 Pro · 6.1"/6.7"',  chip: 'A17',    tier: 'high'   },
  { id: 'iphone-15',       group: 'iPhone',   name: 'iPhone 15',         sub: 'A16 · 6.1"/6.7"',      chip: 'A16',    tier: 'high'   },
  { id: 'iphone-14-pro',   group: 'iPhone',   name: 'iPhone 14 Pro',     sub: 'A16 · 6.1"/6.7"',      chip: 'A16',    tier: 'high'   },
  { id: 'iphone-14',       group: 'iPhone',   name: 'iPhone 14',         sub: 'A15 · 6.1"/6.7"',      chip: 'A15',    tier: 'high'   },
  { id: 'iphone-13',       group: 'iPhone',   name: 'iPhone 13',         sub: 'A15 · 6.1"/5.4"',      chip: 'A15',    tier: 'high'   },
  { id: 'iphone-13-mini',  group: 'iPhone',   name: 'iPhone 13 mini',    sub: 'A15 · 5.4"',           chip: 'A15',    tier: 'high'   },
  { id: 'iphone-se3',      group: 'iPhone',   name: 'iPhone SE (3rd gen)',sub:'A15 · 4.7"',           chip: 'A15',    tier: 'high'   },
  { id: 'iphone-12',       group: 'iPhone',   name: 'iPhone 12',         sub: 'A14 · 6.1"/5.4"',      chip: 'A14',    tier: 'medium' },
  { id: 'iphone-11',       group: 'iPhone',   name: 'iPhone 11',         sub: 'A13 · 6.1"',           chip: 'A13',    tier: 'medium' },
  { id: 'iphone-se2',      group: 'iPhone',   name: 'iPhone SE (2nd gen)',sub:'A13 · 4.7"',           chip: 'A13',    tier: 'medium' },
  { id: 'iphone-xr',       group: 'iPhone',   name: 'iPhone XR',         sub: 'A12 · 6.1"',           chip: 'A12',    tier: 'low'    },
  { id: 'iphone-8',        group: 'iPhone',   name: 'iPhone 8',          sub: 'A11 · 4.7"',           chip: 'A11',    tier: 'low'    },
]

// Catalog index for O(1) lookup by id.
const DEVICE_BY_ID = new Map(DEVICE_CATALOG.map(d => [d.id, d]))

// Best-guess default for the "iPad 9" detection from a UA that doesn't know.
// Honest default = the A13 iPad 9 since that's the floor of iOS 16+ for iPad.
// User gets one tap through the picker to upgrade to their actual device.
const DEFAULT_IPAD_BASELINE = 'ipad-9'
const DEFAULT_IPHONE_BASELINE = 'iphone-13'

// Detect device family from the WKWebView UA + iPadOS reports-as-Mac heuristic.
// Returns the DEVICE_CATALOG entry — by-id for known models, by-baseline for
// the "iPad but we can't tell which" case.
export function detectDevice() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return DEVICE_BY_ID.get(DEFAULT_IPAD_BASELINE) // SSR / native bridge edge case
  }
  const ua = navigator.userAgent || ''
  const isIPhone = /iPhone/.test(ua)
  // iPadOS 13+ reports as Macintosh with maxTouchPoints>1 when Safari's
  // "Request Desktop Website" is on. Treat that as iPad too. The plain /\biPad\b/
  // matches Safari iPad UAs regardless of the "Desktop" toggle.
  const isIPad = /\biPad\b/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)

  if (isIPad) return DEVICE_BY_ID.get(DEFAULT_IPAD_BASELINE)
  if (isIPhone) return DEVICE_BY_ID.get(DEFAULT_IPHONE_BASELINE)
  // Web build / dev / other — assume a recent iPad-equivalent perf
  return DEVICE_BY_ID.get(DEFAULT_IPAD_BASELINE)
}

export function getDeviceById(id) {
  return DEVICE_BY_ID.get(id) || null
}

export function getDeviceCatalog() {
  return DEVICE_CATALOG
}

// Group catalog by family for the picker UI. Stable order: iPad-side first,
// then iPhone, then any "Other" bucket.
export function getDeviceCatalogGrouped() {
  const groups = []
  const groupIds = []
  for (const d of DEVICE_CATALOG) {
    if (!groupIds.includes(d.group)) {
      groupIds.push(d.group)
      groups.push({ id: d.group, label: d.group, devices: [] })
    }
    groups[groupIds.indexOf(d.group)].devices.push(d)
  }
  return groups
}

// localStorage key — kept namespaced under `noor-` like the rest of the app.
export const DEVICE_CONFIRM_KEY = 'noor-device-confirmed'

// Persist {id, tier, confirmedAt}. Returns parsed record or null.
export function loadConfirmedDevice() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(DEVICE_CONFIRM_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.id) return null
    // Re-resolve against the catalog so an id that was dropped from a future
    // release still resolves to a sensible default rather than throwing.
    const entry = DEVICE_BY_ID.get(parsed.id) || DEVICE_BY_ID.get(DEFAULT_IPAD_BASELINE)
    return {
      id: entry.id,
      tier: entry.tier,
      chip: entry.chip,
      name: entry.name,
      sub: entry.sub,
      confirmedAt: parsed.confirmedAt || 0,
    }
  } catch {
    return null
  }
}

export function saveConfirmedDevice(id) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(DEVICE_CONFIRM_KEY, JSON.stringify({
      id,
      confirmedAt: Date.now(),
    }))
  } catch {}
}

export function clearConfirmedDevice() {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(DEVICE_CONFIRM_KEY) } catch {}
}

// Sync tier class application. Called both synchronously (useState lazy init)
// so first paint already reflects the tier, AND from the re-apply useEffect
// when the user confirms or changes device. Idempotent — removes all three
// tier classes first so a swap between (e.g.) medium→high never leaves stale
// `.tier-medium` on the body. Defensive: no-op under SSR / no-document.
export function applyTierClass(tier) {
  if (typeof document === 'undefined' || !document.body) return
  document.body.classList.remove('tier-high', 'tier-medium', 'tier-low')
  if (tier && ['high', 'medium', 'low'].includes(tier)) {
    document.body.classList.add(`tier-${tier}`)
  }
}
