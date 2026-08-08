// Shared STT sanity gates for Khutbah + Quran cloud paths.
// Drops hallucinations, wrong-script noise, and repetitive loops before they reach
// the matcher or Claude.

// NOTE the /g flag: without it, .match() returns at most ONE match, which made every
// Arabic transcript count as "1 Arabic char / N" → rejected as wrong script. That bug
// silently dropped ALL Arabic speech in v8.16.0–8.16.2.
const ARABIC_RE = /[؀-ۿ]/g

export function isHallucination(text) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean)
  if (words.length < 6) return false
  const unique = new Set(words.map(w => w.toLowerCase())).size
  return unique / words.length < 0.35
}

export function isRepetitionLoop(text) {
  const t = (text || '').trim()
  if (t.length < 20) return false
  // Classic Whisper loop: same 3–8 word phrase repeated many times
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < 8) return false
  for (let n = 3; n <= 8; n++) {
    if (words.length < n * 3) continue
    const phrase = words.slice(0, n).join(' ')
    let reps = 0
    for (let i = 0; i <= words.length - n; i += n) {
      if (words.slice(i, i + n).join(' ') === phrase) reps++
      else break
    }
    if (reps >= 3) return true
  }
  return false
}

export function isWrongScript(text, lang = 'ar') {
  if (lang !== 'ar' && lang !== 'ur') return false
  const cleaned = (text || '').replace(/\s/g, '')
  if (cleaned.length < 4) return false
  const arabicChars = (cleaned.match(ARABIC_RE) || []).length
  return arabicChars / cleaned.length < 0.4
}

export function isTooShort(text, minLen = 3) {
  return !(text || '').replace(/\s+/g, ' ').trim() || text.trim().length < minLen
}

// Returns null if the segment should be dropped, otherwise the trimmed text.
export function filterTranscript(text, { lang = 'ar', minLen = 3 } = {}) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (isTooShort(t, minLen)) return null
  if (isHallucination(t)) return null
  if (isRepetitionLoop(t)) return null
  if (isWrongScript(t, lang)) return null
  return t
}

// Quran detect: keep partials — only drop empty noise (matcher handles the rest).
export function trimTranscript(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  return t || null
}
