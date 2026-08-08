// Sunnah fasting-day calendar, computed from the tabular Hijri conversion in
// utils/prayer.js (±1 day vs local moon-sighting — all user-facing copy hedges with
// "expected/confirm locally"). Per the user's request, weekly Monday/Thursday fasts
// are deliberately NOT suggested.
//
// Suggested days:
//   • White days — 13/14/15 of every Hijri month, EXCEPT: 13 Dhul-Hijjah (a tashreeq
//     day, when fasting is forbidden) and all of Ramadan (already fasting).
//   • Tasu'a & Ashura — 9 & 10 Muharram.
//   • Day of Arafah — 9 Dhul-Hijjah (for non-pilgrims).
//   • Six of Shawwal — one nudge at 2 Shawwal ("any six days this month").
// Never suggested: Eid al-Fitr (1 Shawwal), Eid al-Adha (10 Dhul-Hijjah),
// tashreeq (11–13 Dhul-Hijjah) — fasting those days is prohibited.

import { tabularHijri } from './prayer'

const HIJRI_MONTHS = [
  'Muharram', 'Safar', "Rabi' al-Awwal", "Rabi' al-Thani", 'Jumada al-Ula', 'Jumada al-Akhirah',
  'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhul-Qa'dah", 'Dhul-Hijjah',
]

export function isRamadan(date = new Date()) {
  try { return tabularHijri(date).m === 9 } catch { return false }
}

// Upcoming sunnah fasting days in the next `daysAhead` days, in date order.
// Each: { date: Date, hijri: {y,m,d}, hijriLabel, label, kind }
export function getUpcomingFasts(daysAhead = 60, from = new Date()) {
  const out = []
  for (let i = 1; i <= daysAhead; i++) {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)
    let h
    try { h = tabularHijri(date) } catch { continue }
    const entry = classify(h)
    if (entry) {
      out.push({
        date, hijri: h,
        hijriLabel: `${h.d} ${HIJRI_MONTHS[h.m - 1]}`,
        ...entry,
      })
    }
  }
  return out
}

function classify(h) {
  // Prohibited days can never be suggested — checked first as a hard guard.
  if (h.m === 10 && h.d === 1) return null                 // Eid al-Fitr
  if (h.m === 12 && h.d >= 10 && h.d <= 13) return null    // Eid al-Adha + tashreeq

  if (h.m === 1 && h.d === 9)  return { label: "Tasu'a (9 Muharram)", kind: 'ashura' }
  if (h.m === 1 && h.d === 10) return { label: 'Ashura (10 Muharram)', kind: 'ashura' }
  if (h.m === 12 && h.d === 9) return { label: 'Day of Arafah', kind: 'arafah' }
  if (h.m === 10 && h.d === 2) return { label: 'Six fasts of Shawwal — any six days this month', kind: 'shawwal6' }

  // White days — skip during Ramadan; 13 Dhul-Hijjah already excluded above.
  if (h.m !== 9 && (h.d === 13 || h.d === 14 || h.d === 15)) {
    return { label: `White day (${h.d} ${HIJRI_MONTHS[h.m - 1]})`, kind: 'white' }
  }
  return null
}

// The next suggested fasting day (for the Home chip), or null.
export function getNextFast(from = new Date()) {
  const list = getUpcomingFasts(60, from)
  if (!list.length) return null
  const next = list[0]
  const days = Math.round((next.date - new Date(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000)
  return { ...next, inDays: days }
}
