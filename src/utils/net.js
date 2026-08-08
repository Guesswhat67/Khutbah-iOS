// fetch wrapper that adds a hard timeout and an optional one-shot retry.
// Live khutbah translation runs over flaky masjid Wi-Fi; without this a single
// hung request can leave a feed card stuck "pending" forever.
//
// Also owns the shared HTTP header factory (apiHeaders / APP_TOKEN / device id)
// so consumers (App.jsx, QuranMode.jsx, ReferenceMode.jsx) no longer import those
// values from App.jsx — that round-trip was a static circular dependency and
// would break under stricter build pipelines / future refactors.

import { Capacitor } from '@capacitor/core'
import { getDeviceId } from './device'

const IS_NATIVE = Capacitor.isNativePlatform()
const API_BASE = IS_NATIVE ? 'https://khutbah-v2.pages.dev' : ''
// Optional shared gate token (baked at build time, never committed). Empty unless VITE_APP_TOKEN is set.
const APP_TOKEN = (import.meta.env.VITE_APP_TOKEN || '')

// Re-export the constant alongside the function form: direct `import { API_BASE }`
// is what QuranMode.jsx already does (and reads it once at module scope, which is
// fine — the value is constant for the lifetime of the build). `getApiBase()` stays
// for callers that need late binding.
export { API_BASE, IS_NATIVE }
export function getApiBase() { return API_BASE }
export function getAppToken() { return APP_TOKEN }

// Always send x-device-id so the server-side per-device quota can cap a leaked token.
export function apiHeaders(extra = {}) {
  const h = { ...extra, 'x-device-id': getDeviceId() }
  if (APP_TOKEN) h['x-app-token'] = APP_TOKEN
  return h
}

export class TimeoutError extends Error {
  constructor(ms) {
    super(`Request timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const caller = options.signal

  if (caller) {
    if (caller.aborted) controller.abort()
    else caller.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return fetch(url, { ...options, signal: controller.signal })
    .catch(err => {
      // Distinguish our timeout from a caller-initiated abort
      if (controller.signal.aborted && (!caller || !caller.aborted)) {
        throw new TimeoutError(timeoutMs)
      }
      throw err
    })
    .finally(() => clearTimeout(timer))
}

// options: standard fetch options (may include `signal`)
// config: { timeoutMs, retries, retryDelayMs }
export async function apiFetch(url, options = {}, config = {}) {
  const { timeoutMs = 15000, retries = 1, retryDelayMs = 600 } = config
  let lastErr

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs)
      // Retry once on transient upstream errors
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`)
        await delay(retryDelayMs)
        continue
      }
      return res
    } catch (err) {
      lastErr = err
      // Never retry a caller-initiated cancellation
      if (options.signal && options.signal.aborted) throw err
      if (attempt < retries) { await delay(retryDelayMs); continue }
      throw err
    }
  }
  throw lastErr
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
