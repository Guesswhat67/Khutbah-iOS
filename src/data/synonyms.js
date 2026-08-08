// Curated name/spelling-variant groups for Maktaba's Smart-mode search.
//
// English translations of the Quran & Hadith transliterate Arabic names many ways
// (Satan / Shaitan / Shaytan / Iblis; Isa / Jesus; Salah / prayer …). Literal search
// only matches the exact spelling typed, so a search for "Satan" misses hadith that
// say "Shaitan". When Smart mode is ON we expand a single-word query to its whole
// group and search all variants at once (see expandSynonyms below).
//
// Kept as an offline curated list on purpose: instant, predictable, and no AI round
// trip. Each inner array is one concept; order doesn't matter. All lowercase.

export const SYNONYM_GROUPS = [
  // ── Beings ──
  ['satan', 'shaitan', 'shaytan', 'shaitaan', 'shaytan', 'devil', 'iblis', 'iblees'],
  ['angel', 'angels', 'malaika', 'malaikah', 'jibril', 'jibreel', 'gabriel', 'mikail', 'israfil'],
  ['jinn', 'jinns', 'genie', 'demons'],
  ['allah', 'god', 'lord', 'rabb'],

  // ── Prophets (English name ↔ Arabic name) ──
  ['muhammad', 'mohammed', 'messenger', 'prophet', 'rasul', 'rasool', 'apostle'],
  ['isa', 'jesus', 'christ', 'messiah', 'masih'],
  ['musa', 'moses'],
  ['ibrahim', 'abraham'],
  ['nuh', 'noah'],
  ['adam'],
  ['yusuf', 'joseph'],
  ['sulaiman', 'sulayman', 'solomon'],
  ['dawud', 'dawood', 'david'],
  ['yaqub', 'jacob', 'israel'],
  ['ismail', 'ishmael'],
  ['maryam', 'mary'],
  ['firaun', 'firawn', 'pharaoh'],

  // ── Places / afterlife ──
  ['jannah', 'paradise', 'heaven', 'garden', 'gardens'],
  ['jahannam', 'hell', 'hellfire', 'fire', 'naar', 'hellfire'],
  ['akhira', 'akhirah', 'hereafter', 'afterlife', 'next life'],
  ['dunya', 'world', 'worldly', 'this life'],
  ['qiyamah', 'qiyamat', 'resurrection', 'judgement', 'judgment', 'reckoning', 'last day'],
  ['kaaba', 'kabah', 'kaba', 'house of allah'],

  // ── Worship / pillars ──
  ['salah', 'salat', 'prayer', 'namaz', 'worship'],
  ['zakah', 'zakat', 'charity', 'sadaqah', 'sadaqa', 'almsgiving', 'alms'],
  ['sawm', 'siyam', 'fasting', 'fast', 'ramadan', 'ramadhan'],
  ['hajj', 'pilgrimage', 'umrah'],
  ['wudu', 'wudhu', 'ablution', 'purification'],
  ['dua', "du'a", 'supplication', 'invocation'],
  ['dhikr', 'zikr', 'remembrance'],
  ['quran', "qur'an", 'koran', 'scripture', 'revelation'],

  // ── Virtues / concepts ──
  ['sabr', 'patience', 'perseverance', 'steadfastness'],
  ['taqwa', 'piety', 'god-consciousness', 'righteousness'],
  ['tawakkul', 'reliance', 'trust in allah'],
  ['shukr', 'gratitude', 'thankfulness'],
  ['tawbah', 'tawba', 'repentance', 'forgiveness'],
  ['rahmah', 'mercy', 'compassion'],
  ['ilm', 'knowledge', 'learning'],
  ['iman', 'faith', 'belief'],
  ['sin', 'sins', 'dhanb', 'transgression'],
  ['halal', 'lawful', 'permissible'],
  ['haram', 'forbidden', 'unlawful', 'prohibited'],
]

// term (lowercase) → the full group it belongs to.
const LOOKUP = (() => {
  const m = new Map()
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) m.set(term, group)
  }
  return m
})()

// Expand a query to its synonym group if it's a single known word.
// Returns an array of variant terms, or null when there's nothing to expand
// (multi-word query, or a word we don't have a group for).
export function expandSynonyms(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q || /\s/.test(q)) return null   // only expand single words
  const group = LOOKUP.get(q)
  if (!group) return null
  // Put the typed word first, then the rest of the group.
  return [q, ...group.filter(t => t !== q)]
}
