// Anchor-based Quran recitation tracker for CLEAN cloud STT (ElevenLabs Scribe).
//
// The old matcher (findVerse/trackVerse/calibration vote in QuranMode.jsx) was built to
// survive garbled on-device Whisper. With accurate transcripts the problem is simpler and
// different: *sequence alignment*. We flatten the whole Quran into one linear token stream,
// index every 3-word window (trigram), and locate a transcript by the longest chain of
// CONSECUTIVE trigram hits. A genuine recitation produces a monotonic chain of adjacent
// anchors; coincidental single hits don't. Tracking is then just advancing a cursor.
//
// norm() must match src/utils/quranStore.js byte-for-byte (letter-only Arabic).
import { norm } from './quranStore.js'   // explicit .js so Node test harness resolves it too

const LOCK_CONF = 3          // trigram-chain length to lock / accept a far jump
const NEAR_BACK = 40         // tokens to look behind the cursor (short repeats)
const NEAR_FWD  = 600        // tokens to look ahead (a commit can carry several ayat)
const WINDOW    = 24         // align only the last WINDOW tokens of the input (the recent tail)
const MAX_TRAIL = 5          // cap forward projection past the last matched anchor (drop-tolerant, garbage-proof)

// Align the tail (most recent WINDOW tokens). Scribe commits per-ayah on VAD pauses, and a
// short ayah (2-3 words) can't form a trigram on its own — so the CLIENT feeds a rolling
// buffer of recent transcript that spans ayah boundaries, and we align its tail near the
// cursor. This keeps short ayat trackable and self-corrects drift on long, fluent recitation.
function tailTokens(text) {
  const all = tokenize(text)
  return all.length > WINDOW ? all.slice(-WINDOW) : all
}

// ال (definite article) is frequently dropped by Scribe ("الرحمن" -> "رحمن", see log #1757).
// Fold it out of every token — at BOTH index-build and query time — so matching is
// ال-insensitive. Guarded by length > 4 so "الله" (God) and openers like "الم"/"الر" survive.
// Uses charCode comparison (no literal Arabic in source — RTL hazard, see quranStore norm).
const ALEF = 0x0627, LAM = 0x0644
function stripAl(w) {
  return (w.length > 4 && w.charCodeAt(0) === ALEF && w.charCodeAt(1) === LAM) ? w.slice(2) : w
}

function tokenize(text) {
  return norm(text).split(' ').filter(w => w.length > 1).map(stripAl)
}

export class QuranTracker {
  constructor(verses) {
    this.verses = verses
    // Linear token stream: WORDS[k] = { w, vi } — vi is the index into `verses`.
    // vStart[vi] = first token index of that verse (for word-offset → highlight).
    this.WORDS = []
    this.vStart = new Array(verses.length)
    for (let vi = 0; vi < verses.length; vi++) {
      this.vStart[vi] = this.WORDS.length
      const vw = (verses[vi].n || '').split(' ').filter(w => w.length > 1)
      for (const w of vw) this.WORDS.push({ w: stripAl(w), vi })   // ال-folded anchor token
    }
    // Trigram anchor index: "w1 w2 w3" → [startPos, ...] into WORDS.
    this.tri = new Map()
    for (let i = 0; i + 2 < this.WORDS.length; i++) {
      const key = this.WORDS[i].w + ' ' + this.WORDS[i + 1].w + ' ' + this.WORDS[i + 2].w
      let arr = this.tri.get(key)
      if (!arr) { arr = []; this.tri.set(key, arr) }
      arr.push(i)
    }
    // Surah → verse-index range, and "s:a" → verse index — used by the Haiku rescue lock.
    this.surahRange = new Map()
    this.saToVi = new Map()
    for (let vi = 0; vi < verses.length; vi++) {
      const s = verses[vi].s
      this.saToVi.set(`${s}:${verses[vi].a}`, vi)
      const r = this.surahRange.get(s)
      if (!r) this.surahRange.set(s, { lo: vi, hi: vi })
      else r.hi = vi
    }
    this.reset()
  }

  reset() {
    this.cursor = -1   // token index of the last matched word; -1 = unlocked
    this.locked = false
  }

  get cursorVerseIndex() {
    return this.cursor >= 0 ? this.WORDS[this.cursor].vi : -1
  }

  // Core: align `tokens` against the corpus, preferring a start position near `preferPos`
  // (the cursor). Returns the best { start, end, chain } or null.
  //   start/end = token range in WORDS that the transcript maps to (inclusive-ish)
  //   chain     = number of consecutive trigram anchors that agreed (confidence)
  _align(tokens, preferPos = -1) {
    if (tokens.length < 3) return null

    // For each transcript trigram, the set of corpus positions it could start at, but
    // OFFSET back to where the transcript would have started — so hits from the same
    // aligned run all vote for the same origin. tallies[origin] = count.
    const tallies = new Map()   // origin corpus pos → hit count
    const lastT = new Map()      // origin → largest transcript-trigram index that agreed
    const pinned = new Set()     // origins backed by a globally-unique trigram (exact location)
    for (let t = 0; t + 2 < tokens.length; t++) {
      const key = tokens[t] + ' ' + tokens[t + 1] + ' ' + tokens[t + 2]
      const positions = this.tri.get(key)
      if (!positions) continue
      const unique = positions.length === 1   // this trigram occurs exactly once in the Quran
      for (const p of positions) {
        const origin = p - t          // where the transcript's word 0 lands in the corpus
        tallies.set(origin, (tallies.get(origin) || 0) + 1)
        lastT.set(origin, t)          // t increases monotonically → this is the max
        if (unique) pinned.add(origin)
      }
    }
    if (tallies.size === 0) return null

    // Pick the origin with the most agreeing trigrams; tie-break toward `preferPos`
    // (forward-biased window) so ordinary forward progress wins over a far coincidence.
    // A unique anchor gets a bonus — it identifies the location almost by itself.
    let bestOrigin = null, bestScore = -Infinity
    for (const [origin, count] of tallies) {
      let score = count * 100
      if (pinned.has(origin)) score += 25
      if (preferPos >= 0) {
        const dist = origin - preferPos
        // Strong bonus near the cursor; HEAVY penalty far away. The far penalty must exceed
        // bonus + 100 so a far origin needs a chain ≥2 LONGER than the near one to win — the
        // Quran's mutashabihat share whole consecutive ayat (e.g. 27:3 ≈ 31:4), and a diff of 1
        // trigram was enough to fling the cursor to the twin surah. Genuine far jumps (surah
        // change in salah) go through the fresh-tail jump check instead, which has no old
        // context, so this penalty doesn't slow them.
        if (dist >= -NEAR_BACK && dist <= NEAR_FWD) score += 50 - Math.min(50, Math.abs(dist) * 0.1)
        else score -= 160
      }
      if (score > bestScore) { bestScore = score; bestOrigin = origin }
    }
    if (bestOrigin == null) return null

    const chain = tallies.get(bestOrigin) || 0
    // Ambiguous opening: another origin in a DIFFERENT surah agrees with the same chain length.
    // This is exactly what the shared openings produce — the Basmala (113 surahs) and the
    // muqatta'at (الم across 2/3/29/30/31/32, حم across 40-46, …). We can't tell which surah yet,
    // so cold locks and jumps should wait for the disambiguating word instead of guessing the
    // earliest. (Not applied to unique/pinned anchors, and irrelevant once a cursor exists.)
    let ambiguous = false
    if (!pinned.has(bestOrigin)) {
      const clamp = o => Math.max(0, Math.min(this.WORDS.length - 1, o))
      const bestSurah = this.verses[this.WORDS[clamp(bestOrigin)].vi].s
      // Cold (no cursor): also treat NEAR-ties (within 1 chain) as ambiguous — noise/word-drops
      // can flip which twin of a shared opening (musabbihat, muqatta'at) scores one higher, and
      // a wrong confident lock is far worse than deferring one more chunk. With a cursor the
      // forward bias already resolves twins correctly, so exact ties only.
      const margin = preferPos < 0 ? chain - 1 : chain
      for (const [origin, count] of tallies) {
        if (origin === bestOrigin || count < margin) continue
        if (this.verses[this.WORDS[clamp(origin)].vi].s !== bestSurah) { ambiguous = true; break }
      }
    }
    const start = Math.max(0, bestOrigin)
    // End of the matched span. Anchor it to the LAST agreeing trigram (origin + lastT + 2), then
    // project forward by however many transcript words trail it — but CAP that projection. A few
    // trailing unmatched words are normal STT drops mid-recitation (project them so the cursor
    // keeps up); a LONG trailing block is dua / chatter / garbage after the recitation and must
    // NOT push the cursor past the real match (that drifted into the next surah + over-ran the
    // highlight). MAX_TRAIL separates the two.
    const lt = lastT.get(bestOrigin) || 0
    let matchedEnd = Math.min(this.WORDS.length - 1, Math.max(0, bestOrigin) + lt + 2)
    // SEQUENTIAL EXTENSION past the last trigram anchor: one dropped/misheard word kills up to
    // three trigrams, but the words after it still match the corpus 1:1 — walk them (with a
    // 1-word slack on either side) so short ayat and noisy tails keep advancing on REAL evidence.
    // Matched words may cross verse boundaries (that's evidence, not speculation).
    // Slack branches use a 2-match LOOKAHEAD CONFIRM: a lone coincidence on a common word
    // ("الله" in a dhikr/dua) must not extend the match across a verse boundary — the word
    // AFTER the skip must also line up before we accept the skip.
    let ti = lt + 3, ci = matchedEnd + 1
    const W = this.WORDS
    while (ti < tokens.length && ci < W.length) {
      if (tokens[ti] === W[ci].w) { matchedEnd = ci; ti++; ci++ }
      else if (ci + 1 < W.length && tokens[ti] === W[ci + 1].w &&
               (ti + 1 >= tokens.length || (ci + 2 < W.length && tokens[ti + 1] === W[ci + 2].w))) { ci++ }  // STT dropped a corpus word
      else if (ti + 1 < tokens.length && tokens[ti + 1] === W[ci].w &&
               (ti + 2 >= tokens.length || (ci + 1 < W.length && tokens[ti + 2] === W[ci + 1].w))) { ti++ }  // STT inserted a junk word
      else {
        // REPEATED SEGMENT (Qari re-recites an ayah/phrase for beauty): if the next tokens
        // re-trace corpus we ALREADY passed (bigram anchor within the last 40 tokens + a run),
        // this is a rewind → re-advance. Consume it, and when the re-trace run extends PAST the
        // old position (it flows through into the next ayah), move matchedEnd with it — without
        // this the pre-repeat prefix dominated the vote and the cursor froze (52:5 through 52:8).
        let rp = -1
        for (let back = 1; back <= 40 && matchedEnd - back >= 0; back++) {
          if (W[matchedEnd - back].w === tokens[ti] && ti + 1 < tokens.length &&
              W[matchedEnd - back + 1] && W[matchedEnd - back + 1].w === tokens[ti + 1]) { rp = matchedEnd - back; break }
        }
        if (rp >= 0) {
          let k = 0
          while (ti + k < tokens.length && rp + k < W.length && tokens[ti + k] === W[rp + k].w) k++
          if (k >= 2) {
            ti += k
            if (k >= 3 && rp + k - 1 > matchedEnd) { matchedEnd = rp + k - 1; ci = matchedEnd + 1 }
            continue
          }
        }
        break
      }
    }
    // Clamp the remaining UNMATCHED trailing projection to the END OF THE MATCHED VERSE. Those
    // words are either mid-ayah STT drops (project a little so the karaoke cursor keeps moving)
    // or non-Quran (dhikr/dua/garbage) — speculation must never cross an ayah boundary: that
    // both crept the cursor forward during ruku'/sujud dhikr and could spill into the next surah.
    const trailing = Math.max(0, tokens.length - ti)
    const mvi = this.WORDS[matchedEnd].vi
    const verseEnd = (mvi + 1 < this.vStart.length) ? this.vStart[mvi + 1] - 1 : this.WORDS.length - 1
    const end = Math.max(matchedEnd, Math.min(matchedEnd + Math.min(trailing, MAX_TRAIL), verseEnd))
    return { start, end, chain, pinned: pinned.has(bestOrigin), ambiguous }
  }

  // Max agreeing-trigram count of any single origin INSIDE surah `s` for these tokens.
  // Used by the fresh-jump context guard (mutashabihat: does the current surah still explain
  // the newest words nearly as well as the proposed jump target?).
  _maxCountInSurah(tokens, s) {
    const rng = this.surahRange.get(s)
    if (!rng || tokens.length < 3) return 0
    const tallies = new Map()
    for (let t = 0; t + 2 < tokens.length; t++) {
      const positions = this.tri.get(tokens[t] + ' ' + tokens[t + 1] + ' ' + tokens[t + 2])
      if (!positions) continue
      for (const p of positions) {
        const origin = p - t
        const w = this.WORDS[Math.max(0, Math.min(this.WORDS.length - 1, origin))]
        if (w && w.vi >= rng.lo && w.vi <= rng.hi) tallies.set(origin, (tallies.get(origin) || 0) + 1)
      }
    }
    let best = 0
    for (const c of tallies.values()) if (c > best) best = c
    return best
  }

  // Try to LOCK from cold. Returns { verseIndex, wordIdx, conf } or null.
  lock(text) {
    const a = this._align(tailTokens(text), -1)
    // Lock on a solid chain (>=3 trigrams / ~5 clean words) OR a single globally-unique
    // anchor — a trigram that occurs exactly once in the Quran pins the location even from
    // a 3-word opening (e.g. "قل هو الله"), giving a fast lock without inviting false ones.
    // Don't lock on an ambiguous opening (Basmala / muqatta'at tie across surahs) unless pinned.
    if (!a || ((a.chain < LOCK_CONF || a.ambiguous) && !a.pinned)) return null
    this.cursor = a.end
    this.locked = true
    return this._state(a)
  }

  // Advance an already-locked cursor with a new transcript.
  // Returns { verseIndex, wordIdx, moved, jumped, conf } or null (gap / no anchor).
  advance(text) {
    const tokens = tailTokens(text)
    if (!this.locked) { const l = this.lock(text); return l ? { ...l, moved: true, jumped: true } : null }

    // Cross-surah jump (salah: Al-Fatiha → next surah). The rolling buffer still holds the
    // previous surah, which dilutes the global alignment — so check the FRESHEST words: if they
    // confidently anchor in a DIFFERENT surah, the reciter has moved on, jump there. Restricted
    // to a different surah so in-surah repeats (Ar-Rahman refrain) never trigger a stray jump.
    if (tokens.length >= 3) {
      const freshToks = tokens.slice(-Math.min(12, tokens.length))
      const fresh = this._align(freshToks, -1)
      if (fresh && !fresh.ambiguous && (fresh.pinned || fresh.chain >= LOCK_CONF)) {
        const curSurah = this.verses[this.WORDS[this.cursor].vi].s
        const newVi = this.WORDS[fresh.end].vi
        const newSurah = this.verses[newVi].s
        // Ignore a jump that lands in the Basmala prefix (first ~4 tokens of a surah's ayah 1):
        // "بسم الله الرحمن الرحيم" is identical across 113 surahs so it cannot identify WHICH one.
        // Wait for the real post-Basmala words — this avoids garbage/ambiguous jumps to e.g. 2:1.
        const inBasmala = this.verses[newVi].a === 1 && (fresh.end - this.vStart[newVi]) < 4
        // Context guard (mutashabihat): whole consecutive ayat repeat across surahs (27:3 ≈ 31:4,
        // 2:5 ≈ 31:5…). If the CURRENT surah also explains the fresh tail nearly as well, the
        // reciter almost certainly hasn't moved — stay. A genuine surah change (salah, juz')
        // leaves ~no anchors in the old surah, so this never blocks real jumps.
        const curCount = this._maxCountInSurah(freshToks, curSurah)
        if (newSurah !== curSurah && !inBasmala && curCount < fresh.chain - 1) {
          this.cursor = fresh.end
          return { ...this._state(fresh), moved: true, jumped: true }
        }
      }
    }

    const a = this._align(tokens, this.cursor)
    if (!a || a.chain < 2) return null    // no anchor near or far → treat as gap, hold

    const prevVi = this.cursorVerseIndex
    const jumpDist = a.end - this.cursor
    const isFar = a.start < this.cursor - NEAR_BACK || a.start > this.cursor + NEAR_FWD

    // Far jump (skip / restart / different surah) needs a strong chain of its own, OR a
    // globally-unique anchor that unambiguously identifies the new location.
    if (isFar && a.chain < LOCK_CONF && !a.pinned) return null

    // Never regress the cursor on a weak in-window match — only move forward or on a
    // confident jump. (Backward within-verse re-reads keep the same verse anyway.)
    if (!isFar && a.end < this.cursor && a.chain < LOCK_CONF) {
      return { ...this._state({ start: this.vStart[prevVi], end: this.cursor, chain: a.chain }), moved: false, jumped: false }
    }

    // Crossing into a DIFFERENT surah on a weak chain is likely drift from a dua / non-Quran
    // phrase (Witr Qunut, chatter) leaking into the adjacent surah in the linear corpus — a real
    // surah change comes through the confident cross-surah jump above. Hold unless it's strong.
    const nextSurah = this.verses[this.WORDS[a.end].vi].s
    if (nextSurah !== this.verses[this.WORDS[this.cursor].vi].s && a.chain < LOCK_CONF && !a.pinned) {
      return { ...this._state({ start: this.vStart[prevVi], end: this.cursor, chain: a.chain }), moved: false, jumped: false }
    }

    this.cursor = a.end
    const newVi = this.cursorVerseIndex
    return { ...this._state(a), moved: newVi !== prevVi, jumped: isFar }
  }

  // RESCUE LOCK — when the local matcher is lost, Haiku identifies the surah (+ rough ayah)
  // from a hard transcript. We don't trust Haiku's exact ayah: instead we SNAP to the precise
  // position by aligning the transcript with candidate origins restricted to that surah. If no
  // anchor lands inside the surah (transcript too garbled), soft-seed at the hinted ayah / surah
  // start. Returns { verseIndex, wordIdx, conf, rescued } or null if the surah number is bad.
  lockToSurah(text, surah, ayahHint = 0) {
    const rng = this.surahRange.get(surah)
    if (!rng) return null
    const tokens = tailTokens(text)
    let best = null
    if (tokens.length >= 3) {
      const tallies = new Map()
      for (let t = 0; t + 2 < tokens.length; t++) {
        const key = tokens[t] + ' ' + tokens[t + 1] + ' ' + tokens[t + 2]
        const positions = this.tri.get(key)
        if (!positions) continue
        for (const p of positions) {
          const origin = p - t
          const w = this.WORDS[origin]
          if (w && w.vi >= rng.lo && w.vi <= rng.hi) tallies.set(origin, (tallies.get(origin) || 0) + 1)
        }
      }
      let bo = null, bc = 0
      for (const [o, c] of tallies) if (c > bc) { bc = c; bo = o }
      if (bo != null) best = { start: bo, end: Math.min(this.WORDS.length - 1, bo + tokens.length - 1), chain: bc, pinned: false }
    }
    if (!best) {
      const vi = this.saToVi.get(`${surah}:${ayahHint}`) ?? rng.lo   // soft seed
      best = { start: this.vStart[vi], end: this.vStart[vi], chain: 0, pinned: false }
    }
    this.cursor = best.end
    this.locked = true
    return { ...this._state(best), rescued: true }
  }

  // Map an alignment span to {verseIndex, wordIdx} for UI. wordIdx = furthest word
  // reached within the current verse (drives the karaoke highlight).
  _state(a) {
    const vi = this.WORDS[a.end].vi
    const wordIdx = a.end - this.vStart[vi]
    return { verseIndex: vi, wordIdx, conf: a.chain }
  }
}

let _tracker = null
export function primeTracker(verses) {
  _tracker = verses && verses.length ? new QuranTracker(verses) : null
  return _tracker
}
export function getTracker() { return _tracker }
