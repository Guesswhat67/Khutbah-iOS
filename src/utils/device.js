// Stable per-device identifier so each install only ever sees its OWN saved
// khutbah history. Generated once on first use and persisted in localStorage.
// This is NOT a security credential — it only scopes history rows per device.
const KEY = 'noor-device-id'

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID() } catch {}
  }
  return 'dev-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

let _cached = null

export function getDeviceId() {
  if (_cached) return _cached
  try {
    let id = localStorage.getItem(KEY)
    if (!id) { id = uuid(); localStorage.setItem(KEY, id) }
    _cached = id
  } catch {
    // localStorage unavailable — fall back to an ephemeral per-session id
    _cached = _cached || uuid()
  }
  return _cached
}
