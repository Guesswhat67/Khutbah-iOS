// Family streak circles — client for functions/api/circle.js.
//
// A circle is a family group joined by a short invite code. Members see each other's
// streak numbers only (no reading content). Membership + the last fetched member list
// are cached in localStorage so the Home tile renders offline.
//
// Standalone module (own API base + token, mirroring utils/streak.js) to avoid a
// circular import with App.jsx.

import { Capacitor } from '@capacitor/core'
import { getDeviceId } from './device'
import { todayStr } from './streak'
import { apiFetch, apiHeaders } from './net'

const IS_NATIVE = Capacitor.isNativePlatform()
const API_BASE = IS_NATIVE ? 'https://khutbah-v2.pages.dev' : ''
// Include x-device-id (via apiHeaders) so server-side per-device quota is enforced
// the same way as every other /api/* call. Body still carries device_id for membership.
const jsonHeaders = () => apiHeaders({ 'Content-Type': 'application/json' })

const CIRCLE_KEY = 'noor-circle'          // { code, circleName, displayName }
const MEMBERS_KEY = 'noor-circle-members' // last fetched member list (offline cache)

export function getCachedCircle() {
  try { return JSON.parse(localStorage.getItem(CIRCLE_KEY) || 'null') } catch { return null }
}
export function getCachedMembers() {
  try { return JSON.parse(localStorage.getItem(MEMBERS_KEY) || '[]') } catch { return [] }
}
function saveCircle(c) {
  try {
    if (c) localStorage.setItem(CIRCLE_KEY, JSON.stringify(c))
    else localStorage.removeItem(CIRCLE_KEY)
  } catch {}
  // Notify HomePanel so the Family tile + members list refresh after a Settings
  // change without waiting for a full app restart. See PLAN-022 fix.
  broadcastCircleChanged()
}
function saveMembers(m) {
  try { localStorage.setItem(MEMBERS_KEY, JSON.stringify(m || [])) } catch {}
}

// Broadcast a membership change so HomePanel can refresh the Family tile without
// a full app restart. createCircle / joinCircle / leaveCircle / renameMember all
// dispatch through saveCircle(), so a single hook here covers them.
function broadcastCircleChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('app-circle-changed'))
}

async function post(body) {
  // Use apiFetch so a hung POST to /api/circle (e.g. slow network on first
  // create/join when the user is in a low-signal spot) can't leave the
  // Family Settings sheet stuck on a spinner. 8s timeout + 2 retries matches
  // the fetchToken budget — small Cloudflare Worker endpoints both.
  const res = await apiFetch(
    `${API_BASE}/api/circle`,
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ ...body, device_id: getDeviceId() }) },
    { timeoutMs: 8000, retries: 2 },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function createCircle(circleName, displayName) {
  const data = await post({ action: 'create', circle_name: circleName, display_name: displayName })
  saveCircle({ code: data.code, circleName: data.name || circleName, displayName })
  return data
}

export async function joinCircle(code, displayName) {
  const data = await post({ action: 'join', code, display_name: displayName })
  saveCircle({ code: data.code || code, circleName: data.name || '', displayName })
  return data
}

export async function leaveCircle() {
  try { await post({ action: 'leave' }) } finally {
    saveCircle(null); saveMembers([])
  }
}

export async function renameMember(displayName) {
  await post({ action: 'rename', display_name: displayName })
  const c = getCachedCircle()
  if (c) saveCircle({ ...c, displayName })
}

// Fetch the member list (and refresh the offline cache). Returns [] when not joined.
export async function fetchCircle() {
  if (!getCachedCircle()) return []
  // apiFetch so a hung GET can't make the Home tile look stuck-loading forever.
  // Member list is only consulted on Home entry; refreshes every 15s via the
  // caller's interval, so a single hung request is a UI freeze, not stale data.
  const res = await apiFetch(
    `${API_BASE}/api/circle?device_id=${encodeURIComponent(getDeviceId())}&day=${todayStr()}`,
    { headers: jsonHeaders() },
    { timeoutMs: 8000, retries: 2 },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  const members = Array.isArray(data.members) ? data.members : []
  saveMembers(members)
  if (data.circle) {
    const c = getCachedCircle()
    saveCircle({ ...(c || {}), code: data.circle.code, circleName: data.circle.name || (c && c.circleName) || '' })
  }
  return members
}

// circle.js is a leaf utility under FamilySettings.jsx (App.jsx never imports
// us directly) — keeps its own APP_TOKEN + jsonHeaders() so the dependency
// graph stays one-way.

// A member's streak to DISPLAY, applying the same one-day grace as the local
// getDisplayStreak(): alive only if the last completion was today or yesterday.
// (The earlier `d(0) || d(1) || d(2)` check was a 3-day grace and contradicted
// the comment, so a family circle would show a streak the local app wouldn't —
// fixed in PLAN-022.)
export function displayStreakOf(member) {
  const last = member?.last_completed_day
  if (!last || typeof member.current !== 'number') return 0
  const d = (offset) => {
    const x = new Date(); x.setDate(x.getDate() - offset)
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  }
  return (last === d(0) || last === d(1)) ? (member.current || 0) : 0
}
