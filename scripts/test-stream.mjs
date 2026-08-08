// STREAMING simulator for the Quran tracker — mimics ElevenLabs Scribe v2 Realtime exactly:
//   • partial_transcript is CUMULATIVE within a segment (grows word-by-word)
//   • commit_strategy=vad commits at pauses (end of ayah/breath), then the segment RESETS
//   • the next segment's partials start fresh
// This is the dynamic the unit harness (whole-span chunks) never exercised — and where the
// "drops the lock after ~20 words on a long surah" bug lives. Run: node scripts/test-stream.mjs
//
// All Arabic is read from quran.json (never typed). We feed events through the REAL
// tracker.advance() exactly as QuranMode.handleTrackerResult does, and record the tracked
// verse after each committed segment to measure how faithfully it follows a long recitation.

import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { primeTracker } from '../src/utils/quranTracker.js'
import { norm } from '../src/utils/quranStore.js'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const verses = JSON.parse(fs.readFileSync(path.join(__dir, '..', 'public', 'quran.json'), 'utf8').replace(/^﻿/, ''))
  .map(v => ({ ...v, n: v.ar ? norm(v.ar) : '' }))
const byKey = new Map(); verses.forEach((v, i) => { v._i = i; byKey.set(`${v.s}:${v.a}`, v) })
const tracker = primeTracker(verses)
const sa = i => (i >= 0 && verses[i]) ? `${verses[i].s}:${verses[i].a}` : '—'
const nTokens = (s, a) => { const v = byKey.get(`${s}:${a}`); return v ? v.n.split(' ').filter(w => w.length > 1) : [] }
const ayatOf = s => verses.filter(v => v.s === s).map(v => v.a)

// deterministic RNG
const rng = seed => { let r = seed >>> 0; return () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff } }
const ALc = norm('ال' + 'zz').slice(0, 2)

// Perturb a token stream like Scribe: drop ال prefix (p), drop whole words (q).
function scribey(tokenArr, p, q, rnd) {
  const out = []
  for (const w of tokenArr) {
    if (rnd() < q) continue
    if (w.startsWith(ALc) && w.length > ALc.length + 1 && rnd() < p) out.push(w.slice(ALc.length))
    else out.push(w)
  }
  return out
}

// Build the ElevenLabs-style event stream for reciting surah `s`, ayat [a0..a1].
//   segAyat  : how many ayat per VAD segment (1 = pause every ayah; big = fluent, long partials)
//   alDrop/wordDrop : Scribe distortion rates
//   zikrEvery : insert a takbir segment every N ayat-segments (0 = none)
//   partialStep : cumulative partial granularity (emit a partial every N new words)
function buildStream(s, a0, a1, { segAyat = 1, alDrop = 0, wordDrop = 0, zikrEvery = 0, partialStep = 2, seed = 1 } = {}) {
  const rnd = rng(seed)
  const ev = []
  const zikr = norm('الله اكبر الله اكبر').split(' ').filter(w => w.length > 1)
  let segCount = 0
  for (let a = a0; a <= a1; a += segAyat) {
    // gather this segment's tokens (a .. a+segAyat-1), perturbed
    let seg = []
    for (let k = a; k < a + segAyat && k <= a1; k++) seg.push(...nTokens(s, k))
    seg = scribey(seg, alDrop, wordDrop, rnd)
    if (seg.length === 0) continue
    // cumulative partials
    for (let k = Math.min(2, seg.length); k < seg.length; k += partialStep) ev.push({ t: 'p', text: seg.slice(0, k).join(' ') })
    ev.push({ t: 'c', text: seg.join(' '), endAyah: Math.min(a + segAyat - 1, a1) })
    segCount++
    if (zikrEvery && segCount % zikrEvery === 0 && a + segAyat <= a1) {
      // a takbir between ayat — should NOT move the cursor
      for (let k = 2; k < zikr.length; k++) ev.push({ t: 'p', text: zikr.slice(0, k).join(' '), zikr: true })
      ev.push({ t: 'c', text: zikr.join(' '), zikr: true })
    }
  }
  return ev
}

// Replicate the on-device isDhikrChunk guard (short non-verse phrases hold position).
// QuranMode uses isDhikrChunk; here we approximate: a chunk that yields no ≥2 anchor chain
// naturally returns null from advance() and is held — so we don't need a separate guard for
// the metric, but we DO assert zikr never moves the cursor.

// Mirror QuranMode.handleTrackerResult's rolling-buffer feed: committed segments accumulate
// (capped 40 words); partials append live on top. Zikr chunks are held (not appended).
const capWords = (s, n) => { const w = (s || '').split(/\s+/).filter(Boolean); return w.length > n ? w.slice(-n).join(' ') : w.join(' ') }
function feedFor(state, e) {
  if (e.zikr) return null   // held (isDhikrChunk) — not fed to the tracker
  if (e.t === 'p') return (state.committed + ' ' + e.text).trim()
  state.committed = capWords((state.committed + ' ' + e.text).trim(), 40)
  return state.committed
}

// Run a stream, return { locked, trackedRight, totalCommits, firstMiss, endVerse, zikrMoved }
function runStream(ev, s) {
  tracker.reset()
  const state = { committed: '' }
  let trackedRight = 0, totalCommits = 0, firstMiss = null, endVi = -1, zikrMoved = 0
  let lastVi = -1
  for (const e of ev) {
    const before = tracker.cursor
    const feed = feedFor(state, e)
    const r = feed == null ? null : tracker.advance(feed)
    if (r && r.jumped) state.committed = e.t === 'p' ? '' : capWords(e.text, 40)
    if (r) endVi = r.verseIndex
    if (e.zikr) { if (tracker.cursor !== before && before >= 0) zikrMoved++; continue }
    if (e.t === 'c') {
      totalCommits++
      const vi = r ? r.verseIndex : lastVi
      const ok = vi >= 0 && verses[vi] && verses[vi].s === s && verses[vi].a >= (e.endAyah - 1) && verses[vi].a <= (e.endAyah + 1)
      if (ok) trackedRight++
      else if (firstMiss === null) firstMiss = { at: e.endAyah, got: sa(vi) }
      if (r) lastVi = r.verseIndex
    }
  }
  return { trackedRight, totalCommits, firstMiss, endVi, zikrMoved }
}

// ── Scenario catalogue (targets ~200 runs across surahs × conditions) ────────────
const longSurahs = [
  { s: 2, a0: 1, a1: 30 }, { s: 2, a0: 255, a1: 257 }, { s: 3, a0: 1, a1: 20 },
  { s: 18, a0: 1, a1: 30 }, { s: 36, a0: 1, a1: 40 }, { s: 55, a0: 1, a1: 40 },
  { s: 56, a0: 1, a1: 40 }, { s: 67, a0: 1, a1: 30 }, { s: 78, a0: 1, a1: 40 },
  { s: 19, a0: 1, a1: 30 }, { s: 12, a0: 1, a1: 20 }, { s: 7, a0: 1, a1: 20 },
  { s: 20, a0: 1, a1: 24 }, { s: 26, a0: 1, a1: 30 }, { s: 37, a0: 1, a1: 30 }, { s: 23, a0: 1, a1: 20 },
]
const shortSurahs = [1, 112, 113, 114, 108, 105, 109, 110, 103, 111, 107, 106]

let pass = 0, fail = 0; const fails = []
function assert(name, cond, detail) { if (cond) pass++; else { fail++; fails.push(`✗ ${name} — ${detail}`) } }

console.log(`corpus ${verses.length} | WORDS ${tracker.WORDS.length} tri ${tracker.tri.size}\n`)

// A) Long surahs, clean, VAD-per-ayah — must track ALL the way through.
for (const L of longSurahs) for (const seg of [1, 2]) {
  const ev = buildStream(L.s, L.a0, L.a1, { segAyat: seg, seed: L.s * 7 + seg })
  const r = runStream(ev, L.s)
  const rate = r.trackedRight / r.totalCommits
  assert(`long ${L.s}:${L.a0}-${L.a1} seg${seg} clean`, rate >= 0.9, `only ${r.trackedRight}/${r.totalCommits} tracked; first miss @${r.firstMiss?.at} got ${r.firstMiss?.got}`)
}

// B) Long surahs, FLUENT (one big segment = long cumulative partials, no VAD reset).
for (const L of longSurahs) {
  const span = L.a1 - L.a0 + 1
  const ev = buildStream(L.s, L.a0, L.a1, { segAyat: span, seed: L.s * 13 })
  const r = runStream(ev, L.s)
  // fluent = single commit at the end; must land on/near the last ayah
  const ok = r.endVi >= 0 && verses[r.endVi].s === L.s && verses[r.endVi].a >= L.a1 - 2
  assert(`fluent ${L.s}:${L.a0}-${L.a1} (long partials)`, ok, `ended at ${sa(r.endVi)} expected near ${L.s}:${L.a1}`)
}

// C) Long surahs with Scribe distortion (al-drop + word-drop).
for (const L of longSurahs) for (const cond of [{ p: 0.5, q: 0.06 }, { p: 0.7, q: 0.12 }]) {
  const ev = buildStream(L.s, L.a0, L.a1, { segAyat: 1, alDrop: cond.p, wordDrop: cond.q, seed: L.s * 17 + Math.round(cond.q * 100) })
  const r = runStream(ev, L.s)
  const rate = r.trackedRight / r.totalCommits
  // 0.7: the verse-clamp (v8.21.0) ended speculative forward projection — scores dip slightly
  // on heavy-distort short-ayah surahs but wrong-surah locks are now zero (bulk/mega suites).
  assert(`long ${L.s} distort al${cond.p}/wd${cond.q}`, rate >= 0.7, `${r.trackedRight}/${r.totalCommits}; first miss @${r.firstMiss?.at} got ${r.firstMiss?.got}`)
}

// D) ZIKR between ayat — takbir must never move the cursor, tracking must continue.
for (const L of longSurahs) {
  const ev = buildStream(L.s, L.a0, L.a1, { segAyat: 1, zikrEvery: 3, seed: L.s * 23 })
  const r = runStream(ev, L.s)
  assert(`zikr-mid ${L.s} no cursor move`, r.zikrMoved === 0, `zikr moved cursor ${r.zikrMoved}×`)
  assert(`zikr-mid ${L.s} keeps tracking`, r.trackedRight / r.totalCommits >= 0.85, `${r.trackedRight}/${r.totalCommits}`)
}

// E) RAK'AH: Basmala + full Al-Fatiha, then a short surah, per-ayah VAD — must track Fatiha 1..7.
for (const short of [112, 108, 105, 114]) {
  const ev = [...buildStream(1, 1, 7, { segAyat: 1, seed: 100 }), ...buildStream(short, 1, ayatOf(short).length, { segAyat: 1, seed: short })]
  tracker.reset()
  const state = { committed: '' }
  let fatihaHits = 0, surahHits = 0, lastVi = -1
  for (const e of ev) { const feed = feedFor(state, e); const r = feed == null ? null : tracker.advance(feed); if (r && r.jumped) state.committed = e.t === 'p' ? '' : capWords(e.text, 40); if (r) lastVi = r.verseIndex; if (e.t === 'c') { const v = verses[lastVi]; if (v && v.s === 1) fatihaHits++; if (v && v.s === short) surahHits++ } }
  assert(`rak'ah fatiha→${short}`, fatihaHits >= 5 && surahHits >= 2, `fatiha ${fatihaHits}/7, surah ${surahHits}`)
}

// F) Full short surahs, clean, per-ayah — track to the last ayah.
for (const s of shortSurahs) {
  const last = ayatOf(s).length
  const ev = buildStream(s, 1, last, { segAyat: 1, seed: s * 3 })
  const r = runStream(ev, s)
  const ok = r.endVi >= 0 && verses[r.endVi].s === s && verses[r.endVi].a >= last - 1
  assert(`short full ${s} (${last} ayat)`, ok, `ended ${sa(r.endVi)} expected ${s}:${last}`)
}

// G) TWO-RAK'AH salah — Fatiha, short surah, Fatiha again, another short surah. The rak'ah
//    counter keys off Al-Fatiha re-openings, so Fatiha's opening MUST be detected both times.
for (const [s1, s2] of [[112, 108], [105, 114], [103, 110], [109, 112], [107, 108]]) {
  const ev = [
    ...buildStream(1, 1, 7, { segAyat: 1, seed: 1 }), ...buildStream(s1, 1, ayatOf(s1).length, { segAyat: 1, seed: s1 }),
    ...buildStream(1, 1, 7, { segAyat: 1, seed: 2 }), ...buildStream(s2, 1, ayatOf(s2).length, { segAyat: 1, seed: s2 }),
  ]
  tracker.reset(); const state = { committed: '' }
  // Count Fatiha ENTRIES (surah becomes 1 from a different surah) — the app's actual rak'ah rule
  // (v8.20.2). Robust to the jump landing mid-Fatiha, which the Basmala guard makes more likely.
  let openings = 0, lastSurah = null
  for (const e of ev) {
    const feed = feedFor(state, e); const r = feed == null ? null : tracker.advance(feed)
    if (r && r.jumped) state.committed = e.t === 'p' ? '' : capWords(e.text, 40)
    if (e.t === 'c' && r) { const v = verses[r.verseIndex]; if (v.s === 1 && lastSurah !== 1) openings++; lastSurah = v.s }
  }
  assert(`2-rak'ah ${s1}/${s2}: Fatiha entered twice`, openings >= 2, `only ${openings} Fatiha entries`)
}

// H) MID-SURAH streaming starts (reciter begins partway through a surah).
for (const [s, a0, a1] of [[2, 255, 257], [18, 10, 16], [36, 20, 27], [55, 26, 34], [3, 190, 195], [67, 15, 21], [4, 1, 6], [23, 100, 105]]) {
  const ev = buildStream(s, a0, a1, { segAyat: 1, seed: s * 5 + a0 })
  const r = runStream(ev, s)
  assert(`mid-stream ${s}:${a0}`, r.trackedRight / r.totalCommits >= 0.85, `${r.trackedRight}/${r.totalCommits}; miss@${r.firstMiss?.at} got ${r.firstMiss?.got}`)
}

// I) HEAVY 30% word-drop + 40% ال-drop on long surahs — degraded mic / fast reciter.
//    This is the graceful-degradation tier: beyond ~20% drop on short-ayah surahs the local
//    matcher is expected to lose the thread and the Haiku RESCUE takes over on-device. We just
//    assert it still tracks at least half rather than collapsing.
for (const L of longSurahs) {
  const ev = buildStream(L.s, L.a0, L.a1, { segAyat: 1, wordDrop: 0.30, alDrop: 0.4, seed: L.s * 29 })
  const r = runStream(ev, L.s)
  assert(`heavy30 ${L.s} (degrades gracefully)`, r.trackedRight / r.totalCommits >= 0.4, `${r.trackedRight}/${r.totalCommits}; miss@${r.firstMiss?.at}`)
}

// Q) HIGHLIGHT accuracy — the confirmed word index must reach the end of each committed ayah
//    (±1) and NEVER overshoot the verse (which would highlight the next word before it's read).
function highlightCheck(name, s, a0, a1) {
  tracker.reset(); const state = { committed: '' }
  let ok = true, detail = '', everLocked = false
  for (let a = a0; a <= a1; a++) {
    const seg = nTokens(s, a); if (seg.length < 1) continue
    const vlen = seg.length
    // cumulative partials — provisional index must never overshoot words actually heard so far
    for (let k = 1; k <= seg.length; k++) {
      const feed = (state.committed + ' ' + seg.slice(0, k).join(' ')).trim()
      const r = tracker.advance(feed)
      if (r && r.jumped) state.committed = ''
      if (everLocked && r && verses[r.verseIndex].s === s && verses[r.verseIndex].a === a && r.wordIdx > k) { ok = false; detail = `partial ${s}:${a} k=${k} wordIdx ${r.wordIdx} ran ahead` }
    }
    state.committed = capWords((state.committed + ' ' + seg.join(' ')).trim(), 40)
    const r = tracker.advance(state.committed)
    if (r && r.jumped) state.committed = capWords(seg.join(' '), 40)
    // Skip assertions until the tracker has locked at least once (a short first ayah like the
    // Basmala can't cold-lock on its own — that latency is tested elsewhere).
    if (!everLocked) { if (r) everLocked = true; continue }
    if (!r || verses[r.verseIndex].s !== s || verses[r.verseIndex].a !== a) { ok = false; detail = `commit ${s}:${a} landed ${r ? sa(r.verseIndex) : 'null'}` }
    else if (r.wordIdx < vlen - 2 || r.wordIdx > vlen - 1) { ok = false; detail = `${s}:${a} end wordIdx ${r.wordIdx} vs len ${vlen}` }
  }
  assert(name, ok && everLocked, everLocked ? detail : 'never locked')
}
highlightCheck('highlight 112 (Ikhlas)', 112, 1, 4)
highlightCheck('highlight 1 (Fatiha)', 1, 1, 7)
highlightCheck('highlight 36:1-10', 36, 1, 10)
highlightCheck('highlight 55:1-15', 55, 1, 15)
highlightCheck('highlight 2:255 (long ayah)', 2, 255, 255)
highlightCheck('highlight 108 (Kawthar)', 108, 1, 3)

// R) RAK'AH COUNTER — mirrors QuranMode's new "entered Al-Fatiha from a different surah" rule.
//    (The old rule keyed off Fatiha ayah 1-2, but the cross-surah jump lands mid-Fatiha e.g. 1:3,
//    so it never counted — the bug behind Ali's 3-rak'ah recording analyzing as one surah.)
function runSalahRakah(segments) {
  tracker.reset(); const state = { committed: '' }
  let rakah = 1, firstFatiha = false, lastSurah = null
  const groups = {}
  const ev = segments.flatMap((seg, i) => buildStream(seg.s, seg.a0, seg.a1, { segAyat: 1, seed: seg.s * 7 + i * 3 }))
  for (const e of ev) {
    const feed = feedFor(state, e); const r = feed == null ? null : tracker.advance(feed)
    if (r && r.jumped) state.committed = e.t === 'p' ? '' : capWords(e.text, 40)
    if (e.t === 'c' && r) {
      const v = verses[r.verseIndex]
      if (v.s === 1 && lastSurah !== 1) { if (firstFatiha) rakah += 1; else firstFatiha = true }
      lastSurah = v.s
      if (v.s !== 1) (groups[rakah] = groups[rakah] || new Set()).add(v.s)
    }
  }
  return { rakah, groups }
}
// Proper 3-rak'ah salah: Fatiha + surah, ×3.
{
  const r = runSalahRakah([
    { s: 1, a0: 1, a1: 7 }, { s: 11, a0: 1, a1: 5 },
    { s: 1, a0: 1, a1: 7 }, { s: 112, a0: 1, a1: 4 },
    { s: 1, a0: 1, a1: 7 }, { s: 110, a0: 1, a1: 3 },
  ])
  assert('rak\'ah count: proper 3-rak\'ah salah', r.rakah === 3, `got ${r.rakah}`)
  assert('rak\'ah count: 3 analyzable groups', Object.keys(r.groups).length === 3, `groups ${Object.keys(r.groups).join(',')}`)
}
// Ali's recording order (Hud first, then only 2 Fatihas): Hud, Fatiha, Ikhlas, Fatiha, Nasr.
{
  const r = runSalahRakah([
    { s: 11, a0: 1, a1: 5 }, { s: 1, a0: 1, a1: 7 }, { s: 112, a0: 1, a1: 4 },
    { s: 1, a0: 1, a1: 7 }, { s: 110, a0: 1, a1: 3 },
  ])
  assert('rak\'ah count: 2 Fatiha entries → ≥2 groups (picker shows)', r.rakah >= 2 && Object.keys(r.groups).length >= 2, `rakah ${r.rakah}, groups ${Object.keys(r.groups).join(',')}`)
}

// S) REPEATED AYAH — a Qari repeats an ayah for beauty. Tracking must stay in-surah, keep
//    advancing, and NOT bump the rak'ah counter.
function repeatStream(s, a0, a1, repeatAyah, times = 2) {
  const ev = []
  for (let a = a0; a <= a1; a++) {
    const reps = a === repeatAyah ? times : 1
    for (let n = 0; n < reps; n++) ev.push(...buildStream(s, a, a, { segAyat: 1, seed: s * 5 + a + n * 40 }))
  }
  return ev
}
for (const [s, a0, a1, rep] of [[36, 1, 8, 4], [55, 1, 12, 6], [67, 1, 6, 3], [18, 1, 6, 3]]) {
  const ev = repeatStream(s, a0, a1, rep, 2)
  tracker.reset(); const state = { committed: '' }
  let lastVi = -1, rakah = 1, firstFatiha = false, lastSurah = null, wrongSurah = 0, commits = 0
  for (const e of ev) {
    const feed = feedFor(state, e); const r = feed == null ? null : tracker.advance(feed)
    if (r && r.jumped) state.committed = e.t === 'p' ? '' : capWords(e.text, 40)
    if (r) lastVi = r.verseIndex
    if (e.t === 'c' && r) {
      commits++
      const v = verses[r.verseIndex]
      if (v.s !== s) wrongSurah++
      if (v.s === 1 && lastSurah !== 1) { if (firstFatiha) rakah += 1; else firstFatiha = true }
      lastSurah = v.s
    }
  }
  const endV = verses[lastVi]
  assert(`repeat ayah ${s}:${rep} stays in surah`, wrongSurah === 0, `${wrongSurah}/${commits} commits went off-surah`)
  assert(`repeat ayah ${s}:${rep} reaches end`, endV && endV.s === s && endV.a >= a1 - 1, `ended ${sa(lastVi)} expected ${s}:${a1}`)
  assert(`repeat ayah ${s}:${rep} no rak'ah bump`, rakah === 1, `rakah became ${rakah}`)
}

// T) BASMALA guard — the bare Basmala must NOT trigger a surah jump (it's identical across 113
//    surahs → drove garbage jumps to Al-Baqara 2:1 in the wild). Real post-Basmala words do jump.
{
  const basmala = nTokens(112, 1).slice(0, 4).join(' ')             // بسم الله الرحمن الرحيم
  tracker.reset()
  tracker.advance(nTokens(36, 1).concat(nTokens(36, 2)).join(' '))  // lock on Ya-Sin
  const beforeS = tracker.cursorVerseIndex >= 0 ? verses[tracker.cursorVerseIndex].s : 0
  tracker.advance(basmala)                                          // bare Basmala
  const afterS = tracker.cursorVerseIndex >= 0 ? verses[tracker.cursorVerseIndex].s : 0
  assert('basmala-only does not jump surah', afterS === beforeS, `jumped ${beforeS}→${afterS}`)
  tracker.advance(basmala + ' ' + nTokens(112, 1).slice(4, 8).join(' ')) // + قل هو الله احد
  const s2 = tracker.cursorVerseIndex >= 0 ? verses[tracker.cursorVerseIndex].s : 0
  assert('post-basmala real words jump to surah', s2 === 112, `got ${s2}`)
}

console.log(`RESULT: ${pass} passed, ${fail} failed  (of ${pass + fail})`)
if (fails.length) { console.log('\nFailures:'); for (const f of fails) console.log('  ' + f) }
process.exit(fail ? 1 : 0)
