// Du'a Detection v2 — multi-cue state machine with confidence scoring.
// v1 (single-string match) over-fired on intermediate phrases like "rabbana"
// mid-khutbah. v2 requires:
//   * Two consecutive phrases with confidence ≥ 0.5 to ENTER du'a mode, OR
//   * One phrase with confidence ≥ 0.9 (definitive opener) to enter immediately.
// State goes EXACT (off/on) — but we transition the moment a recognizable
// khutbah marker follows (new surah, "أقول قولي", etc.).
//
// Exports:
//   resetDuaState()      — call at session start
//   duaConfidence(text)  — per-phrase 0..1
//   isDuaPhrase(text)    — boolean at threshold ≥ 0.7
//   checkDuaTransition(text) — 'enter' | 'exit' | null (drives divider chips)
//   isCurrentlyDua()     — current mode for UI affordances
//   duaStats()           — debug snapshot { active, consecutiveHits, lastConfidence }

const DUA_CUES = [
  // Strong openers (definitive — 1 hit → enter immediately)
  { ar: 'اللهم',       en: ['allahumma'],                                                          weight: 1.0, tier: 'strong' },
  { ar: 'اللَّهُمَّ',   en: [],                                                                     weight: 1.0, tier: 'strong' },
  { ar: 'ربنا',         en: ['rabbana'],                                                             weight: 0.95, tier: 'strong' },
  { ar: 'رَبَّنَا',     en: [],                                                                     weight: 1.0, tier: 'strong' },
  { ar: 'يا رب',        en: ['ya rabb', 'ya rab'],                                                   weight: 0.9, tier: 'strong' },
  { ar: 'يا اللَّه',    en: ['ya allah'],                                                            weight: 0.9, tier: 'strong' },
  // Reinforcement phrases (need 2 in a row)
  { ar: 'آمين',         en: ['ameen', 'amin'],                                                       weight: 0.7, tier: 'soft' },
  { ar: 'برحمتك',       en: ['bi rahmatika', 'birahmati'],                                           weight: 0.7, tier: 'soft' },
  { ar: 'يا كريم',       en: ['ya karim'],                                                            weight: 0.7, tier: 'soft' },
  { ar: 'تولّى',         en: ['tawalla'],                                                             weight: 0.6, tier: 'soft' },
  { ar: 'اغفر',         en: ['ighfir', 'ghfir', 'agfir'],                                            weight: 0.8, tier: 'soft' },
  { ar: 'ارحم',         en: ['irham'],                                                               weight: 0.8, tier: 'soft' },
  { ar: 'اهدنا',        en: ['ihdina'],                                                              weight: 0.9, tier: 'soft' },
  { ar: 'توكلنا',       en: ['tawakkaltu', 'tawakkalna'],                                            weight: 0.6, tier: 'soft' },
]

const KHUTBAH_RESUME_MARKERS = [
  'أما بعد',                       // ama ba'd — post-du'a pivot
  'أقول قولي',                     // aqoolu qawli — author resuming speech
  'إن كنت',                        // in kunt — conditional pivot
  'اعوذ', 'أعوذ بالله',
  'فأقول',                         // fa aqoolu
  'أما',                           // ama — broad pivot
]

let active = false
let consecutiveHits = 0
let lastConfidence = 0

export function resetDuaState() {
  active = false
  consecutiveHits = 0
  lastConfidence = 0
}

export function isCurrentlyDua() { return active }
export function duaStats() { return { active, consecutiveHits, lastConfidence } }

// Per-phrase confidence 0..1
export function duaConfidence(text) {
  if (!text || typeof text !== 'string') return 0
  let best = 0
  const lo = text.toLowerCase()
  for (const cue of DUA_CUES) {
    if (cue.ar && text.includes(cue.ar)) best = Math.max(best, cue.weight)
    for (const e of cue.en) if (e && lo.includes(e)) best = Math.max(best, cue.weight * 0.9)
  }
  return best
}

export function isDuaPhrase(text) {
  return duaConfidence(text) >= 0.7
}

// Returns 'enter' | 'exit' | null. Drives divider chips on the feed.
export function checkDuaTransition(text) {
  if (!text || typeof text !== 'string') return null

  // Possible EXIT — khutbah pivot marker while in du'a mode
  if (active) {
    const lo = text.toLowerCase()
    if (KHUTBAH_RESUME_MARKERS.some(m => lo.includes(m.toLowerCase()))) {
      active = false
      consecutiveHits = 0
      lastConfidence = 0
      return 'exit'
    }
    return null
  }

  // Off mode. Compute per-phrase confidence.
  const conf = duaConfidence(text)
  lastConfidence = conf

  if (conf >= 0.9) {
    // Definitive single-cue entry
    active = true
    consecutiveHits = 1
    return 'enter'
  }

  if (conf >= 0.5) {
    consecutiveHits += 1
    if (consecutiveHits >= 2) {
      active = true
      return 'enter'
    }
    return null
  }

  consecutiveHits = 0
  return null
}
