// BULK real-life test suite (~2000+ cases) for the Quran tracker. Streaming model mirrors
// ElevenLabs (cumulative partials + VAD/watchdog commits + reset) and the QuranMode rolling
// buffer. All Arabic is READ FROM quran.json — never typed (RTL hazard). Run:
//   node scripts/test-bulk.mjs
// Output is summarized per category; only failures are listed (capped).

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
const surahList = [...new Set(verses.map(v => v.s))]
const lastAyah = {}; for (const v of verses) lastAyah[v.s] = Math.max(lastAyah[v.s] || 0, v.a)

const BASMALA = nTokens(112, 1).slice(0, 4).join(' ')            // بسم الله الرحمن الرحيم
// real (post-Basmala) tokens of surah s starting at ayah a0, up to `count` tokens
function realTokens(s, a0, count) {
  const out = []
  for (let a = a0; a <= lastAyah[s] && out.length < count; a++) {
    let t = nTokens(s, a)
    if (a === 1 && t.slice(0, 4).join(' ') === BASMALA) t = t.slice(4)  // strip embedded Basmala
    out.push(...t)
  }
  return out.slice(0, count)
}
const rng = seed => { let r = seed >>> 0 || 1; return () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff } }
const capWords = (str, n) => { const w = (str || '').split(/\s+/).filter(Boolean); return w.length > n ? w.slice(-n).join(' ') : w.join(' ') }
const ALc = norm('ال' + 'zz').slice(0, 2)
function scribey(arr, p, q, rnd) { const o = []; for (const w of arr) { if (rnd() < q) continue; if (w.startsWith(ALc) && w.length > ALc.length + 1 && rnd() < p) o.push(w.slice(ALc.length)); else o.push(w) } return o }

// Build an ElevenLabs-style event stream for surah s, ayat a0..a1.
function buildStream(s, a0, a1, { segAyat = 1, alDrop = 0, wordDrop = 0, partialStep = 3, seed = 1 } = {}) {
  const rnd = rng(seed); const ev = []
  for (let a = a0; a <= a1; a += segAyat) {
    let seg = []
    for (let k = a; k < a + segAyat && k <= a1; k++) seg.push(...nTokens(s, k))
    seg = scribey(seg, alDrop, wordDrop, rnd)
    if (!seg.length) continue
    for (let k = Math.min(2, seg.length); k < seg.length; k += partialStep) ev.push({ t: 'p', text: seg.slice(0, k).join(' ') })
    ev.push({ t: 'c', text: seg.join(' '), endAyah: Math.min(a + segAyat - 1, a1) })
  }
  return ev
}
const feedFor = (st, e) => { if (e.zikr) return null; if (e.t === 'p') return (st.committed + ' ' + e.text).trim(); st.committed = capWords((st.committed + ' ' + e.text).trim(), 40); return st.committed }
// Run a stream; report tracked-right ratio, end verse, and WRONG-surah locks (the real defect —
// a committed transcript that confidently landed on a different surah than the one being recited;
// deferrals/nulls are NOT wrong, they're the correct response to an ambiguous/short opening).
function runStream(ev, s) {
  tracker.reset(); const st = { committed: '' }; let right = 0, total = 0, wrong = 0, endVi = -1, lastVi = -1, firstMiss = null
  for (const e of ev) {
    const feed = feedFor(st, e); const r = feed == null ? null : tracker.advance(feed)
    if (r && r.jumped) st.committed = e.t === 'p' ? '' : capWords(e.text, 40)
    if (r) { endVi = r.verseIndex; lastVi = r.verseIndex }
    if (e.t === 'c') {
      total++
      const vi = r ? r.verseIndex : lastVi; const v = verses[vi]
      if (v && v.s === s && v.a >= e.endAyah - 1 && v.a <= e.endAyah + 1) right++
      else { if (r && v && v.s !== s) wrong++; if (!firstMiss) firstMiss = { at: e.endAyah, got: sa(vi) } }
    }
  }
  return { right, total, wrong, endVi, firstMiss }
}

// ── harness ──────────────────────────────────────────────────────────────────
const cats = {}
const fails = []
function assert(cat, cond, detail) {
  const c = cats[cat] || (cats[cat] = { pass: 0, fail: 0 })
  if (cond) c.pass++; else { c.fail++; if (fails.length < 60) fails.push(`[${cat}] ${detail}`) }
}
const VOL = Math.max(1, Number(process.env.VOL || 1))  // volume multiplier for randomized categories
const R = rng(Number(process.env.SEED || 20260704))  // master seed (override with SEED=)
const pick = arr => arr[Math.floor(R() * arr.length)]

console.log(`corpus ${verses.length} verses, ${surahList.length} surahs | WORDS ${tracker.WORDS.length} tri ${tracker.tri.size}\n`)

// 1) COLD LOCK — every surah, first ~9 real (post-Basmala) words. Must lock to that surah OR
//    defer (surahs sharing an opening — musabbihat سبح لله…, muqatta'at — correctly wait). It must
//    never lock to the WRONG surah.
for (const s of surahList) {
  const toks = realTokens(s, 1, 9)
  if (toks.length < 4) { assert('coldlock', true, ''); continue }  // ultra-short surah, skip strict
  tracker.reset()
  const r = tracker.advance(BASMALA + ' ' + toks.join(' '))
  const got = r ? verses[r.verseIndex].s : 0
  assert('coldlock', got === s || got === 0, `surah ${s} cold → WRONG ${got} (${sa(r ? r.verseIndex : -1)})`)
}

// 2) FULL TRACKING — every surah, first up to 12 ayat, clean. Primary invariant: NEVER lock the
//    wrong surah. Soft: track most ayat (shared-opening families defer their first 1-2 ayat).
for (const s of surahList) {
  const a1 = Math.min(lastAyah[s], 12)
  const r = runStream(buildStream(s, 1, a1, { seed: s * 7 }), s)
  assert('track-clean', r.wrong === 0 && (r.total === 0 || r.right / r.total >= 0.75), `surah ${s}: ${r.right}/${r.total} wrong ${r.wrong} miss@${r.firstMiss?.at} got ${r.firstMiss?.got}`)
}

// 3) PERTURBATION SWEEP — every surah × 3 noise levels. Under noise the tracker DEFERS (never
//    wrong surah); heavy drop on 3-4 word surahs is the graceful-degradation / rescue tier.
for (const s of surahList) for (const [al, wd, thr] of [[0.4, 0.05, 0.7], [0.6, 0.1, 0.55], [0.7, 0.18, 0.4]]) {
  const a1 = Math.min(lastAyah[s], 10)
  // Short-ayah surahs (avg <6 tokens/ayah — no room for trigrams once words drop) are the
  // graceful-degradation tier: the invariant is wrong===0 (defer, never mislock); progress
  // there is the Haiku rescue's job live.
  let tok = 0; for (let a = 1; a <= a1; a++) tok += nTokens(s, a).length
  const shortAyah = tok / a1 < 6
  const r = runStream(buildStream(s, 1, a1, { alDrop: al, wordDrop: wd, seed: s * 31 + Math.round(wd * 100) }), s)
  assert('track-noisy', r.wrong === 0 && (shortAyah || r.total < 5 || r.right / r.total >= thr), `surah ${s} al${al}/wd${wd}: ${r.right}/${r.total} wrong ${r.wrong}`)
}

// 4) MID-SURAH random starts (400) — begin partway through; must lock to the right surah.
for (let i = 0; i < 400 * VOL; i++) {
  const s = pick(surahList); const len = lastAyah[s]; if (len < 3) { assert('mid-start', true, ''); continue }
  const a0 = 1 + Math.floor(R() * (len - 2)); const a1 = Math.min(len, a0 + 2 + Math.floor(R() * 3))
  const r = runStream(buildStream(s, a0, a1, { seed: s * 100 + a0 }), s)
  // Cold mid-surah start: the first short ayah defers until ~5 words; allow ≤1 wrong-surah for
  // ayat that appear verbatim in two places (e.g. 66:9 == 9:73 — genuinely ambiguous cold).
  // Full deferral (never locked, endVi<0) is also correct on tiny ambiguous spans — live, the
  // Haiku rescue resolves those; a wrong lock is the only real defect.
  assert('mid-start', r.wrong <= 1 && (r.total === 0 || r.endVi < 0 || r.right / r.total >= 0.5 || (r.wrong === 0 && r.right >= 1)), `surah ${s}:${a0}-${a1}: ${r.right}/${r.total} wrong ${r.wrong} got ${r.firstMiss?.got}`)
}

// 5) SALAH RAK'AH random (300) — R rakats of (Fatiha + a random surah); counter must equal R.
const surahPool = surahList.filter(s => s !== 1 && realTokens(s, 1, 4).length >= 3)
for (let i = 0; i < 300 * VOL; i++) {
  const R_ = 2 + Math.floor(R() * 3)  // 2..4 rakats
  const segs = []
  for (let k = 0; k < R_; k++) { segs.push({ s: 1, a0: 1, a1: 7 }); const su = pick(surahPool); segs.push({ s: su, a0: 1, a1: Math.min(lastAyah[su], 4) }) }
  tracker.reset(); const st = { committed: '' }; let rakah = 1, firstFat = false, lastSurah = null
  const ev = segs.flatMap((sg, j) => buildStream(sg.s, sg.a0, sg.a1, { seed: sg.s * 13 + j * 5 + i }))
  for (const e of ev) {
    const feed = feedFor(st, e); const r = feed == null ? null : tracker.advance(feed)
    if (r && r.jumped) st.committed = e.t === 'p' ? '' : capWords(e.text, 40)
    if (e.t === 'c' && r) { const v = verses[r.verseIndex]; if (v.s === 1 && lastSurah !== 1) { if (firstFat) rakah += 1; else firstFat = true } lastSurah = v.s }
  }
  assert('rakah-count', rakah === R_, `expected ${R_} got ${rakah} (surahs ${segs.filter(x => x.s !== 1).map(x => x.s).join(',')})`)
}

// 6) HIGHLIGHT accuracy (300) — confirmed wordIdx reaches each committed ayah's end (±1), no overshoot.
for (let i = 0; i < 300 * VOL; i++) {
  const s = pick(surahList); const len = lastAyah[s]; const a0 = 1 + Math.floor(R() * Math.max(1, len - 3)); const a1 = Math.min(len, a0 + 3)
  tracker.reset(); const st = { committed: '' }; let ok = true, everLocked = false, detail = ''
  for (let a = a0; a <= a1; a++) {
    const seg = nTokens(s, a); if (!seg.length) continue; const vlen = seg.length
    for (let k = 1; k <= seg.length; k++) { const feed = (st.committed + ' ' + seg.slice(0, k).join(' ')).trim(); const r = tracker.advance(feed); if (r && r.jumped) st.committed = ''; if (everLocked && r && verses[r.verseIndex].s === s && verses[r.verseIndex].a === a && r.wordIdx > k) { ok = false; detail = `${s}:${a} ahead` } }
    st.committed = capWords((st.committed + ' ' + seg.join(' ')).trim(), 40)
    const r = tracker.advance(st.committed); if (r && r.jumped) st.committed = capWords(seg.join(' '), 40)
    if (!everLocked) { if (r) everLocked = true; continue }
    if (!r || verses[r.verseIndex].s !== s || verses[r.verseIndex].a !== a) { ok = false; detail = `commit ${s}:${a} → ${r ? sa(r.verseIndex) : 'null'}` }
    else if (r.wordIdx < vlen - 2 || r.wordIdx > vlen - 1) { ok = false; detail = `${s}:${a} wordIdx ${r.wordIdx}/${vlen}` }
  }
  // Never locking is acceptable for spans starting on a verbatim-duplicate ayah (23:5 == 70:29):
  // deferral is correct; the highlight invariants only apply once locked.
  assert('highlight', !everLocked || ok, detail)
}

// 7) CROSS-SURAH jump random (300) — surah A then surah B; must end on B.
for (let i = 0; i < 300 * VOL; i++) {
  const A = pick(surahPool), B = pick(surahPool); if (A === B) { assert('jump', true, ''); continue }
  const ev = [...buildStream(A, 1, Math.min(lastAyah[A], 4), { seed: A + i }), ...buildStream(B, 1, Math.min(lastAyah[B], 4), { seed: B + i * 3 })]
  tracker.reset(); const st = { committed: '' }; let lastVi = -1
  for (const e of ev) { const feed = feedFor(st, e); const r = feed == null ? null : tracker.advance(feed); if (r && r.jumped) st.committed = e.t === 'p' ? '' : capWords(e.text, 40); if (r) lastVi = r.verseIndex }
  assert('jump', lastVi >= 0 && verses[lastVi].s === B, `${A}→${B} ended ${sa(lastVi)}`)
}

// 8) REPEATED AYAH (all surahs) — a Qari repeats one ayah; must stay in-surah & reach the end.
for (const s of surahList) {
  const len = Math.min(lastAyah[s], 8); if (len < 3) { assert('repeat', true, ''); continue }
  const rep = 1 + Math.floor(len / 2); const ev = []
  for (let a = 1; a <= len; a++) { ev.push(...buildStream(s, a, a, { seed: s + a })); if (a === rep) ev.push(...buildStream(s, a, a, { seed: s + a + 500 })) }
  tracker.reset(); const st = { committed: '' }; let off = 0, commits = 0, lastVi = -1
  for (const e of ev) { const feed = feedFor(st, e); const r = feed == null ? null : tracker.advance(feed); if (r && r.jumped) st.committed = e.t === 'p' ? '' : capWords(e.text, 40); if (r) lastVi = r.verseIndex; if (e.t === 'c' && r) { commits++; if (verses[r.verseIndex].s !== s) off++ } }
  assert('repeat', off === 0 && verses[lastVi] && verses[lastVi].s === s && verses[lastVi].a >= len - 1, `surah ${s}: off ${off}/${commits}, ended ${sa(lastVi)}`)
}

// 9) NON-QURAN / DUA IGNORE (250) — random Arabic word-salad (Quran vocabulary, non-Quran order,
//    like a Witr Qunut dua / conversation) must NOT cold-lock the tracker.
const vocab = [...new Set(tracker.WORDS.map(w => w.w))].filter(w => w.length > 2)
for (let i = 0; i < 250 * VOL; i++) {
  const n = 6 + Math.floor(R() * 10)
  const salad = Array.from({ length: n }, () => vocab[Math.floor(R() * vocab.length)]).join(' ')
  tracker.reset()
  const r = tracker.advance(salad)
  assert('nonquran-ignore', !r, `salad locked → ${sa(r ? r.verseIndex : -1)} :: ${salad.slice(0, 40)}`)
}

// 10) DUA-HOLD (all surahs) — locked mid-surah, a non-Quran phrase arrives (Witr Qunut / chatter);
//     the cursor must NOT fling to a different surah.
for (const s of surahList) {
  const len = Math.min(lastAyah[s], 6); if (len < 3) { assert('dua-hold', true, ''); continue }
  tracker.reset(); const st = { committed: '' }
  for (const e of buildStream(s, 1, len, { seed: s * 3 })) { const feed = feedFor(st, e); const r = feed == null ? null : tracker.advance(feed); if (r && r.jumped) st.committed = e.t === 'p' ? '' : capWords(e.text, 40) }
  const before = tracker.cursorVerseIndex >= 0 ? verses[tracker.cursorVerseIndex].s : 0
  const salad = Array.from({ length: 8 }, () => vocab[Math.floor(R() * vocab.length)]).join(' ')
  tracker.advance((st.committed + ' ' + salad).trim())
  const after = tracker.cursorVerseIndex >= 0 ? verses[tracker.cursorVerseIndex].s : 0
  assert('dua-hold', after === before, `surah ${s} drifted ${before}→${after}`)
}

// ── report ───────────────────────────────────────────────────────────────────
let tp = 0, tf = 0
console.log('Category                 pass   fail')
console.log('─'.repeat(40))
for (const [k, v] of Object.entries(cats)) { tp += v.pass; tf += v.fail; console.log(k.padEnd(22), String(v.pass).padStart(6), String(v.fail).padStart(6)) }
console.log('─'.repeat(40))
console.log('TOTAL'.padEnd(22), String(tp).padStart(6), String(tf).padStart(6), `  (${tp + tf} cases)`)
if (fails.length) { console.log('\nFailures (first ' + fails.length + '):'); for (const f of fails) console.log('  ✗ ' + f) }
process.exit(tf ? 1 : 0)
