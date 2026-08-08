// Offline prayer times + qibla, computed on-device from the user's coordinates.
//
// Uses the `adhan` library (pure JS, no network). Location and calculation
// preferences live in the app settings object (persisted by App.jsx). Everything
// degrades gracefully to null when no location is set, so callers can show a
// "set your location" prompt instead of crashing.

import {
  Coordinates, CalculationMethod, PrayerTimes, Prayer, Madhab, Qibla, SunnahTimes,
} from 'adhan'

// Calculation-method options surfaced in Settings. Keys map to adhan factories.
export const PRAYER_METHODS = [
  { key: 'NorthAmerica',      label: 'ISNA (North America)' },
  { key: 'MuslimWorldLeague', label: 'Muslim World League' },
  { key: 'Egyptian',          label: 'Egyptian General Authority' },
  { key: 'Karachi',           label: 'Univ. of Islamic Sciences, Karachi' },
  { key: 'UmmAlQura',         label: 'Umm al-Qura (Makkah)' },
  { key: 'Dubai',             label: 'Dubai' },
  { key: 'Qatar',             label: 'Qatar' },
  { key: 'Kuwait',            label: 'Kuwait' },
  { key: 'Singapore',         label: 'Singapore' },
  { key: 'Turkey',            label: 'Turkey (Diyanet)' },
  { key: 'Tehran',            label: 'Tehran' },
  { key: 'MoonsightingCommittee', label: 'Moonsighting Committee' },
]

export const PRAYER_ORDER = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']
export const PRAYER_LABELS = {
  fajr: 'Fajr', sunrise: 'Sunrise', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha',
}

function paramsFor(method, madhab) {
  const factory = CalculationMethod[method] || CalculationMethod.NorthAmerica
  const params = factory()
  params.madhab = (madhab === 'hanafi') ? Madhab.Hanafi : Madhab.Shafi
  return params
}

// Return the six prayer Date objects for `date` at the given location, or null.
export function getPrayerTimes(location, method = 'NorthAmerica', madhab = 'shafi', date = new Date()) {
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') return null
  try {
    const coords = new Coordinates(location.lat, location.lng)
    const pt = new PrayerTimes(coords, date, paramsFor(method, madhab))
    return {
      fajr: pt.fajr, sunrise: pt.sunrise, dhuhr: pt.dhuhr,
      asr: pt.asr, maghrib: pt.maghrib, isha: pt.isha,
      _pt: pt,
    }
  } catch {
    return null
  }
}

// Next upcoming prayer (looks into tomorrow when the day's Isha has passed).
// Returns { name, label, time: Date, inMs } or null.
export function getNextPrayer(location, method = 'NorthAmerica', madhab = 'shafi', now = new Date()) {
  if (!location) return null
  try {
    const coords = new Coordinates(location.lat, location.lng)
    const today = new PrayerTimes(coords, now, paramsFor(method, madhab))
    let next = today.nextPrayer()
    let time
    if (next === Prayer.None) {
      // Past today's Isha → Fajr tomorrow.
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const ptT = new PrayerTimes(coords, tomorrow, paramsFor(method, madhab))
      next = Prayer.Fajr
      time = ptT.fajr
    } else {
      time = today.timeForPrayer(next)
    }
    const name = prayerEnumToName(next)
    if (!name || !time) return null
    return { name, label: PRAYER_LABELS[name] || name, time, inMs: time.getTime() - now.getTime() }
  } catch {
    return null
  }
}

// Which prayer window we're currently in (the most recent one that has started).
export function getCurrentPrayer(location, method = 'NorthAmerica', madhab = 'shafi', now = new Date()) {
  if (!location) return null
  try {
    const coords = new Coordinates(location.lat, location.lng)
    const pt = new PrayerTimes(coords, now, paramsFor(method, madhab))
    const cur = pt.currentPrayer()
    const name = prayerEnumToName(cur)
    return name ? { name, label: PRAYER_LABELS[name] || name } : null
  } catch {
    return null
  }
}

// The current "window" between the previous and next prayer marker (Sunrise counts
// as a marker here, same as most prayer-clock widgets: Fajr→Sunrise→Dhuhr→Asr→
// Maghrib→Isha). Used to draw a progress bar between the two with a countdown.
// Returns { prev: {name,label,time}, next: {name,label,time,inMs}, frac } or null.
export function getPrayerWindow(location, method = 'NorthAmerica', madhab = 'shafi', now = new Date()) {
  if (!location) return null
  try {
    const coords = new Coordinates(location.lat, location.lng)
    const params = paramsFor(method, madhab)
    const today = new PrayerTimes(coords, now, params)
    const marks = PRAYER_ORDER.map(name => ({ name, time: today[name] }))

    let prev, next
    const nextIdx = marks.findIndex(m => m.time > now)
    if (nextIdx === -1) {
      // Past today's Isha — next is tomorrow's Fajr, prev is today's Isha.
      const tomorrow = new PrayerTimes(coords, new Date(now.getTime() + 86400000), params)
      prev = marks[marks.length - 1]
      next = { name: 'fajr', time: tomorrow.fajr }
    } else if (nextIdx === 0) {
      // Before today's Fajr — prev is yesterday's Isha.
      const yesterday = new PrayerTimes(coords, new Date(now.getTime() - 86400000), params)
      prev = { name: 'isha', time: yesterday.isha }
      next = marks[0]
    } else {
      next = marks[nextIdx]
      prev = marks[nextIdx - 1]
    }

    const total = next.time - prev.time
    const frac = total > 0 ? Math.min(1, Math.max(0, (now - prev.time) / total)) : 0
    return {
      prev: { name: prev.name, label: PRAYER_LABELS[prev.name] || prev.name, time: prev.time },
      next: { name: next.name, label: PRAYER_LABELS[next.name] || next.name, time: next.time, inMs: next.time.getTime() - now.getTime() },
      frac,
    }
  } catch {
    return null
  }
}

// Last third of the night (for tahajjud reminders / info).
export function getSunnahTimes(location, method = 'NorthAmerica', madhab = 'shafi', date = new Date()) {
  if (!location) return null
  try {
    const coords = new Coordinates(location.lat, location.lng)
    const params = paramsFor(method, madhab)
    const today = new PrayerTimes(coords, date, params)
    const tomorrow = new PrayerTimes(coords, new Date(date.getTime() + 86400000), params)
    const sunnah = new SunnahTimes(today)
    return { middleOfNight: sunnah.middleOfNight, lastThirdOfNight: sunnah.lastThirdOfNight }
  } catch {
    return null
  }
}

// Qibla bearing in degrees (0=N, 90=E) from the given location, or null.
export function getQiblaBearing(location) {
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') return null
  try {
    return Qibla(new Coordinates(location.lat, location.lng))
  } catch {
    return null
  }
}

function prayerEnumToName(p) {
  switch (p) {
    case Prayer.Fajr:    return 'fajr'
    case Prayer.Sunrise: return 'sunrise'
    case Prayer.Dhuhr:   return 'dhuhr'
    case Prayer.Asr:     return 'asr'
    case Prayer.Maghrib: return 'maghrib'
    case Prayer.Isha:    return 'isha'
    default: return null
  }
}

// Format a Date as a local h:mm am/pm string.
export function fmtTime(d) {
  if (!d) return '--:--'
  try {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return '--:--'
  }
}

// Short "in 1h 20m" / "in 5m" countdown string from a ms delta.
export function fmtCountdown(ms) {
  if (ms == null || ms < 0) return ''
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `in ${h}h ${m}m` : `in ${h}h`
}

// Bare "3h 33m" / "12m" duration, no "in" prefix — for a countdown centred in a bar.
export function fmtDuration(ms) {
  if (ms == null || ms < 0) return ''
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// Everything the native home-screen widget needs, in one shot: today's 6 prayer times
// (as epoch ms — RemoteViews/Java has no adhan port, so the widget only does cheap
// Date-diff math against this cached payload) plus the two rollover marks it needs for
// before-Fajr / after-Isha, the Hijri date string, city, and a same-day staleness key.
export function getWidgetPayload(location, method = 'NorthAmerica', madhab = 'shafi', now = new Date(), tempUnit = 'c') {
  if (!location) return null
  try {
    const coords = new Coordinates(location.lat, location.lng)
    const params = paramsFor(method, madhab)
    const today = new PrayerTimes(coords, now, params)
    const tomorrow = new PrayerTimes(coords, new Date(now.getTime() + 86400000), params)
    const yesterday = new PrayerTimes(coords, new Date(now.getTime() - 86400000), params)
    return {
      fajr: today.fajr.getTime(), sunrise: today.sunrise.getTime(), dhuhr: today.dhuhr.getTime(),
      asr: today.asr.getTime(), maghrib: today.maghrib.getTime(), isha: today.isha.getTime(),
      tomorrowFajr: tomorrow.fajr.getTime(), yesterdayIsha: yesterday.isha.getTime(),
      hijri: getHijriDate(now),
      city: location.city || '',
      lat: location.lat,
      lng: location.lng,
      tempUnit: tempUnit === 'f' ? 'f' : 'c',
      dateKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    }
  } catch {
    return null
  }
}

// Islamic (Hijri) date alongside the Gregorian day/month, e.g. "Wed 16 Muharram · 1 Jul".
// Tries the browser's ICU Umm al-Qura calendar first; some Android WebView builds strip
// the islamic calendars from Intl, so we fall back to a self-contained tabular (Kuwaiti
// algorithm) conversion — accurate to ±1 day of Umm al-Qura, always available.
const HIJRI_MONTHS = [
  'Muharram', 'Safar', "Rabi' al-Awwal", "Rabi' al-Thani", 'Jumada al-Ula', 'Jumada al-Akhirah',
  'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhul-Qa'dah", 'Dhul-Hijjah',
]

// Tabular Islamic calendar (Kuwaiti algorithm) — Gregorian local date → {y, m(1-12), d}.
// Exported for the fasting-day calendar (utils/fasting.js). ±1 day vs moon-sighting.
export function tabularHijri(date) {
  const gy = date.getFullYear(), gm = date.getMonth() + 1, gd = date.getDate()
  const a = Math.floor((14 - gm) / 12)
  const y = gy + 4800 - a
  const m = gm + 12 * a - 3
  const jd = gd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045
  let l = jd - 1948440 + 10632
  const n = Math.floor((l - 1) / 10631)
  l = l - 10631 * n + 354
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238)
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29
  const hm = Math.floor((24 * l) / 709)
  const hd = l - Math.floor((709 * hm) / 24)
  const hy = 30 * n + j - 30
  return { y: hy, m: hm, d: hd }
}

// NOTE: we deliberately do NOT use Intl's islamic calendar here. On several Android
// WebView/ICU builds it doesn't throw when asked for `-u-ca-islamic-umalqura` — it
// silently ignores the extension and returns GREGORIAN month names (confirmed on
// device: showed "17 January" instead of "17 Muharram"). The tabular (Kuwaiti
// algorithm) calculation below is self-contained, has no such failure mode, and is
// what the native widget's result should match (±1 day is normal for any civil/
// tabular Hijri calendar vs. moon-sighting).
export function getHijriDate(now = new Date()) {
  const greg = now.toLocaleDateString([], { day: 'numeric', month: 'short' })
  try {
    const h = tabularHijri(now)
    const weekday = now.toLocaleDateString([], { weekday: 'short' })
    if (h.m >= 1 && h.m <= 12) return `${weekday} ${h.d} ${HIJRI_MONTHS[h.m - 1]} · ${greg}`
  } catch {}
  return ''
}
