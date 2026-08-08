// Lightweight Quran-quote matcher for Khutbah transcripts.
// When the imam quotes an ayah, ASR often garbles recitation register — this finds
// the canonical verse in the local corpus so we can show real Arabic + translation.

import { norm } from './quranStore'

function buildWordIndex(verses) {
  const idx = new Map()
  for (let i = 0; i < verses.length; i++) {
    const wordSet = new Set(verses[i].n.split(' ').filter(w => w.length > 3))
    for (const w of wordSet) {
      if (!idx.has(w)) idx.set(w, [])
      idx.get(w).push(i)
    }
  }
  return idx
}

function scoreVerse(text, verse) {
  const words = norm(text).split(' ').filter(w => w.length > 2)
  if (!words.length) return 0
  const tSet = new Set(words)
  let hits = 0
  for (const w of words) if (verse.n.includes(w)) hits++
  // Score = MAX(hit-recall, verse-coverage). Hit-recall alone is diluted when a long
  // du'a is mixed with a short ayah (the ayah's words become a small fraction of the
  // transcript). Coverage alone is too generous for very short verses. The MAX picks
  // either: full recall of a short ayah OR strong coverage of a long ayah buried in
  // a noisy transcript. Combined with the < 3 words filter removal in findBestVerse,
  // single-word muqatta'at openers (ن, ق, الر) become reachable.
  const vw = verse.n.split(' ').filter(w => w.length > 2)
  let cov = 0
  if (vw.length) {
    let vh = 0
    for (const w of vw) if (tSet.has(w)) vh++
    cov = vh / vw.length
  }
  return Math.max(hits / words.length, cov)
}

function findBestVerse(transcript, verses, wordIndex) {
  const words = norm(transcript).split(' ').filter(w => w.length > 2)
  if (!words.length) return null

  const candidateIndices = new Set()
  for (const w of words) {
    const indices = wordIndex.get(w)
    if (indices) for (const i of indices) candidateIndices.add(i)
  }
  if (candidateIndices.size === 0) return null

  let best = null
  let bestScore = 0
  for (const i of candidateIndices) {
    const v = verses[i]
    const score = scoreVerse(transcript, v)
    if (score > bestScore && score >= 0.45) {
      bestScore = score
      best = v
    }
  }
  return best ? { verse: best, score: bestScore } : null
}

let _verses = null
let _wordIndex = null

export async function matchQuranQuote(transcript, verses = null) {
  const vv = verses || _verses
  if (!vv || !transcript) return null

  // When an explicit `verses` argument is passed (different from the primed
  // global), build a fresh word index so candidate indices aren't taken from
  // a stale corpus. Reuse the global cache when no override is given.
  const wi = (verses && verses !== _verses) ? buildWordIndex(vv) : (_wordIndex || buildWordIndex(vv))

  const hit = findBestVerse(transcript, vv, wi)
  if (!hit || hit.score < 0.45) return null

  const v = hit.verse
  return {
    surah: v.s,
    ayah: v.a,
    surahName: v.sName || `Surah ${v.s}`,
    arabic: v.ar,
    english: v.en || '',
    score: hit.score,
  }
}

export function primeQuranMatchCache(verses) {
  _verses = verses
  _wordIndex = verses ? buildWordIndex(verses) : null
}
