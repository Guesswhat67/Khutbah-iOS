// Shared reading-goal definitions (used by the Quran Goals view and the Home tile).
//
// Every goal is a list of SECTIONS read in order in the focused goal reader. A section
// is either a whole surah (`surah`) or an explicit passage (`keys`). Sections marked
// `optional: true` (Surah al-Mulk in the nightly goal) sit after the finish point —
// the goal completes without them, but the reader keeps going if the user wants to.

import { surahAyahs } from './surahs'

export const FRIDAY_GOAL = {
  id: 'g-kahf',
  label: 'Surah Al-Kahf',
  ref: 'Surah 18 · 110 ayat',
  sections: [
    { label: 'Surah Al-Kahf', surah: 18 },
  ],
}

export const NIGHTLY_GOAL = {
  id: 'g-nightly',
  label: 'Nightly recitation',
  ref: 'Ikhlas · Falaq · Nas · Ayat al-Kursi · Baqarah end',
  sections: [
    { label: 'Surah Al-Ikhlas',       surah: 112 },
    { label: 'Surah Al-Falaq',        surah: 113 },
    { label: 'Surah An-Nas',          surah: 114 },
    { label: 'Ayat al-Kursi',         keys: ['2:255'] },
    { label: 'Last two of Al-Baqarah', keys: ['2:285', '2:286'] },
    { label: 'Surah Al-Mulk',         surah: 67, optional: true },
  ],
}

// Resolve one section to its "s:a" keys from the static surah table (no corpus needed).
export function resolveSectionKeys(section) {
  if (section.keys) return section.keys
  const total = surahAyahs(section.surah)
  const out = []
  for (let a = 1; a <= total; a++) out.push(`${section.surah}:${a}`)
  return out
}

// All keys the goal REQUIRES (optional sections excluded).
export function requiredKeysOf(goal) {
  return goal.sections.filter(s => !s.optional).flatMap(resolveSectionKeys)
}

// Progress of the required portion against today's read-set → { done, total, pct }.
export function goalProgressIn(goal, readSet) {
  const keys = requiredKeysOf(goal)
  const done = keys.reduce((n, k) => n + (readSet.has(k) ? 1 : 0), 0)
  return { done, total: keys.length, pct: keys.length ? Math.round((done / keys.length) * 100) : 0 }
}

export function goalDoneIn(goal, readSet) {
  return goalProgressIn(goal, readSet).pct === 100
}

// Time-of-day gates for which special goals to surface.
export function isFridayNow(date = new Date()) { return date.getDay() === 5 }
export function isNightlyNow(date = new Date()) { const h = date.getHours(); return h >= 18 || h < 3 } // 6pm–3am
