// Local reading-reminder notifications for the daily Quran streak.
//
// Fully on-device (Capacitor LocalNotifications) — no server push. We schedule a
// rolling window of the next few days at 6 AM / 4 PM / 8 PM, each carrying a
// pre-baked rotating quote so the notification reads correctly even when the app
// is closed and offline. Every call cancels all pending and reschedules, so the
// schedule always reflects the current goal, completion state and fresh quotes.

import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { getProgress, nextQuotes } from './streak'
import { getPrayerTimes, PRAYER_LABELS, getHijriDate } from './prayer'
import { getUpcomingFasts } from './fasting'
import { PRAYER_QUOTES } from '../data/prayerQuotes'

const IS_NATIVE = Capacitor.isNativePlatform()
const CHANNEL_ID = 'quran-streak'
const PRAYER_CHANNEL_ID = 'prayer-times'
const FASTING_CHANNEL_ID = 'fasting-days'
// iOS caps pending local notifications at 64 and SILENTLY drops the overflow.
// Android has no 64-cap but we keep the rolling window bounded to the same shape
// across platforms — easier to reason about, and the 6-day horizon comfortably
// covers the busiest fasting runs. (Earlier DAYS_AHEAD = 7 on Android produced
// 7×(3 streak + 5 prayer) + up to 6 sunnah fasts × 2 nudges = 68, which on iOS
// would silently drop; trimming to 6 keeps us at ≤60 on every platform — fixed
// in PLAN-022.)
const DAYS_AHEAD = Capacitor.getPlatform() === 'ios' ? 4 : 6

// Notification-ID ranges kept disjoint so the streak / prayer / fasting schedulers can
// each clear/reschedule their own without wiping the others' pending notifications.
const STREAK_ID_MIN = 1,    STREAK_ID_MAX = 999
const PRAYER_ID_MIN = 1000, PRAYER_ID_MAX = 1999
const FASTING_ID_MIN = 2000, FASTING_ID_MAX = 2999

// Three daily slots with escalating tone.
const SLOTS = [
  { h: 6,  title: '🌅 Start your day with the Qur’an', lead: 'A beautiful habit after Fajr — read a few verses now.' },
  { h: 16, title: '📖 Don’t miss today’s reading',       lead: 'Most of the day is gone — keep your streak alive.' },
  { h: 20, title: '🌙 Last call for today',              lead: 'A few verses before the day ends — don’t break your streak.' },
]

async function ensurePermission() {
  if (!IS_NATIVE) return false
  try {
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions()
    return perm.display === 'granted'
  } catch { return false }
}

async function ensureChannel() {
  if (!IS_NATIVE) return
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Quran Reading Reminders',
      description: 'Daily nudges to keep your reading streak',
      importance: 4,
    })
  } catch {}
}

async function cancelAllPending() {
  if (!IS_NATIVE) return
  try {
    const pending = await LocalNotifications.getPending()
    if (pending?.notifications?.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) })
    }
  } catch {}
}

// Cancel only pending notifications whose id falls in [min, max].
async function cancelRange(min, max) {
  if (!IS_NATIVE) return
  try {
    const pending = await LocalNotifications.getPending()
    const ids = (pending?.notifications || []).filter(n => n.id >= min && n.id <= max).map(n => ({ id: n.id }))
    if (ids.length) await LocalNotifications.cancel({ notifications: ids })
  } catch {}
}

// Cancel everything, then (if enabled & permitted) reschedule the rolling window.
// Call on app open, whenever the toggle/goal changes, and right after a day is
// completed (so today's remaining nudges drop off).
export async function refreshReminders({ enabled, goal }) {
  if (!IS_NATIVE) return
  await cancelRange(STREAK_ID_MIN, STREAK_ID_MAX)
  if (!enabled) return
  if (!(await ensurePermission())) return
  await ensureChannel()

  const now = new Date()
  const completedToday = getProgress(goal).completed

  // Collect the concrete future slots first so we can pull exactly that many quotes.
  const slots = []
  for (let d = 0; d < DAYS_AHEAD; d++) {
    for (let s = 0; s < SLOTS.length; s++) {
      const at = new Date(now)
      at.setDate(at.getDate() + d)
      at.setHours(SLOTS[s].h, 0, 0, 0)
      if (at <= now) continue                 // already passed
      if (d === 0 && completedToday) continue  // today already done → no nudges today
      slots.push({ d, s, at })
    }
  }
  if (slots.length === 0) return

  const quotes = nextQuotes(slots.length)
  const notifications = slots.map((slot, i) => {
    const def = SLOTS[slot.s]
    const q = quotes[i] || { text: '', source: '' }
    return {
      id: slot.d * 10 + slot.s + 1, // deterministic, unique, small int
      title: def.title,
      body: `${def.lead}\n\n“${q.text}” — ${q.source}`,
      channelId: CHANNEL_ID,
      schedule: { at: slot.at, allowWhileIdle: true },
    }
  })

  try { await LocalNotifications.schedule({ notifications }) } catch {}
}

// Explicitly clear the streak reminders (e.g. when the user turns them off).
export async function clearReminders() { await cancelRange(STREAK_ID_MIN, STREAK_ID_MAX) }

// ── Prayer-time reminders ───────────────────────────────────────────────────
// Schedules the five daily prayers for the next few days as local notifications.
// Cancels + reschedules its own ID range each call so it always reflects the
// current location / method. Sunrise is informational only, not scheduled.
const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']

async function ensurePrayerChannel() {
  if (!IS_NATIVE) return
  try {
    await LocalNotifications.createChannel({
      id: PRAYER_CHANNEL_ID,
      name: 'Prayer Times',
      description: 'Adhan reminders at each prayer time',
      importance: 4,
    })
  } catch {}
}

export async function refreshPrayerReminders({ enabled, location, method, madhab, city }) {
  if (!IS_NATIVE) return
  await cancelRange(PRAYER_ID_MIN, PRAYER_ID_MAX)
  if (!enabled || !location) return
  if (!(await ensurePermission())) return
  await ensurePrayerChannel()

  const now = new Date()
  const where = city ? ` in ${city}` : ''
  const notifications = []
  // PLAN-024.1 (Bug #10): `getPrayerTimes` is called DAYS_AHEAD × 1 times (one
  // per day, not per prayer slot — `adhan` returns all six slots in a single
  // PrayerTimes object). `adhan` is ~10 ms per call; DAYS_AHEAD is at most 6
  // on Android and 4 on iOS, so the worst-case is a single ~60 ms synchronous
  // block. Not memoised on purpose because:
  //   • this function only fires on app open + settings change (mounted on
  //     App.jsx useEffects at lines 829/841); not a hot path.
  //   • a memoised cache would need invalidation on timezone/DST change, which
  //     the user can trigger by just flying — the recompute is cheaper than
  //     reasoning about cache freshness.
  for (let d = 0; d < DAYS_AHEAD; d++) {
    const day = new Date(now)
    day.setDate(day.getDate() + d)
    const times = getPrayerTimes(location, method, madhab, day)
    if (!times) continue
    const hijri = getHijriDate(day) // that day's Islamic date, baked in at schedule time
    PRAYER_KEYS.forEach((key, idx) => {
      const at = times[key]
      if (!(at instanceof Date) || at <= now) return
      
      const quotes = PRAYER_QUOTES[key] || []
      const randomQuote = quotes.length > 0 ? quotes[Math.floor(Math.random() * quotes.length)] : `It's time for ${PRAYER_LABELS[key]}${where}.`
      const bodyText = `${randomQuote}${hijri ? `\n\n${hijri}` : ''}`

      notifications.push({
        id: PRAYER_ID_MIN + d * 10 + idx,   // 1000..1064, within the prayer range
        title: `🕌 ${PRAYER_LABELS[key]}`,
        body: bodyText,
        channelId: PRAYER_CHANNEL_ID,
        schedule: { at, allowWhileIdle: true },
      })
    })
  }
  if (!notifications.length) return
  try { await LocalNotifications.schedule({ notifications }) } catch {}
}

export async function clearPrayerReminders() { await cancelRange(PRAYER_ID_MIN, PRAYER_ID_MAX) }

// ── Sunnah fasting-day reminders ────────────────────────────────────────────
// Two nudges per suggested fast: ~3 days ahead and the evening before, both at 8 PM
// (so there's time to plan suhoor). Dates come from the tabular Hijri calendar (±1 day
// vs moon-sighting) — the copy hedges with "expected / confirm locally" on purpose.
// Weekly Mon/Thu fasts are intentionally not suggested (user preference).

async function ensureFastingChannel() {
  if (!IS_NATIVE) return
  try {
    await LocalNotifications.createChannel({
      id: FASTING_CHANNEL_ID,
      name: 'Sunnah Fasting Days',
      description: 'Heads-up before recommended fasting days',
      importance: 3,
    })
  } catch {}
}

export async function refreshFastingReminders({ enabled }) {
  if (!IS_NATIVE) return
  await cancelRange(FASTING_ID_MIN, FASTING_ID_MAX)
  if (!enabled) return
  if (!(await ensurePermission())) return
  await ensureFastingChannel()

  const now = new Date()
  const upcoming = getUpcomingFasts(45, now).slice(0, 6) // cap → ≤12 notifications
  const notifications = []
  upcoming.forEach((f, i) => {
    const slots = [
      { daysBefore: 3, title: '🌙 Sunnah fast coming up', lead: `${f.label} is expected in 3 days` },
      { daysBefore: 1, title: '🌙 Fasting tomorrow?', lead: `Tomorrow is expected to be ${f.label} — a good night to intend and plan suhoor` },
    ]
    slots.forEach((s, j) => {
      const at = new Date(f.date)
      at.setDate(at.getDate() - s.daysBefore)
      at.setHours(20, 0, 0, 0)
      if (at <= now) return
      notifications.push({
        id: FASTING_ID_MIN + i * 4 + j,
        title: s.title,
        body: `${s.lead} (${f.hijriLabel}). Dates follow the calculated calendar — confirm with local moonsighting.`,
        channelId: FASTING_CHANNEL_ID,
        schedule: { at, allowWhileIdle: true },
      })
    })
  })
  if (!notifications.length) return
  try { await LocalNotifications.schedule({ notifications }) } catch {}
}

export async function clearFastingReminders() { await cancelRange(FASTING_ID_MIN, FASTING_ID_MAX) }
