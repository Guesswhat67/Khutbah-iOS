// Automated test for the Quran Surah-tracking engine (src/utils/quranTracker.js).
//
// Run:  node scripts/test-tracker.mjs
//
// All Arabic test material is READ FROM public/quran.json — never typed in source (RTL
// byte-scrambling hazard, see NOOR_HANDOFF §6 v8.18.1). Transcripts are built by
// concatenating real verses (optionally lightly perturbed to mimic ElevenLabs word drops),
// which normalize to the same tokens the corpus does, so this exercises the shipping matcher.

import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { primeTracker } from '../src/utils/quranTracker.js'
import { norm } from '../src/utils/quranStore.js'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const QURAN = path.join(__dir, '..', 'public', 'quran.json')

const verses = JSON.parse(fs.readFileSync(QURAN, 'utf8').replace(/^﻿/, ''))
  .map(v => ({ ...v, n: v.ar ? norm(v.ar) : '' }))

// (s,a) -> verse ; and verseIndex -> {s,a}
const byKey = new Map()
verses.forEach((v, i) => { v._i = i; byKey.set(`${v.s}:${v.a}`, v) })
const ar = (s, a) => { const v = byKey.get(`${s}:${a}`); return v ? v.ar : null }
const sa = i => (i >= 0 && verses[i]) ? `${verses[i].s}:${verses[i].a}` : '—'

// Join a range of ayat [a0..a1] of surah s into one "transcript" string.
function span(s, a0, a1) {
  const out = []
  for (let a = a0; a <= a1; a++) { const t = ar(s, a); if (t) out.push(t) }
  return out.join(' . ')
}

// Light STT-style perturbation: drop ~pct of whole words (simulates missed words).
function perturb(text, pct, seed = 1) {
  let r = seed
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff }
  return text.split(/\s+/).filter(w => w && rnd() > pct).join(' ')
}

const tracker = primeTracker(verses)

let pass = 0, fail = 0
const fails = []
function check(name, cond, detail) {
  if (cond) { pass++; /* console.log('  ✓', name) */ }
  else { fail++; fails.push(`✗ ${name} — ${detail}`); }
}

// Run a scenario: reset, feed each chunk to advance(), return the step results.
function run(chunks) {
  tracker.reset()
  const steps = []
  for (const c of chunks) steps.push({ text: c, r: tracker.advance(c) })
  return steps
}
const lastVerse = steps => { for (let i = steps.length - 1; i >= 0; i--) if (steps[i].r) return steps[i].r.verseIndex; return -1 }
const anyLock = steps => steps.some(s => s.r)

// ── Test catalogue ───────────────────────────────────────────────────────────
// Each: { name, chunks:[text...], expect:'s:a' (final cursor verse) | {noLock:true} | {surah:n} }
const T = []
const add = (name, chunks, expect) => T.push({ name, chunks, expect })

// A) COLD LOCK from surah start — should identify the opening region.
const coldStarts = [
  [1, 1, 4, '1:'], [112, 1, 4, '112:'], [114, 1, 3, '114:'], [113, 1, 3, '113:'],
  [109, 1, 4, '109:'], [108, 1, 3, '108:'], [105, 1, 3, '105:'], [110, 1, 3, '110:'],
  [36, 1, 4, '36:'], [67, 1, 3, '67:'], [55, 1, 6, '55:'], [78, 1, 6, '78:'],
  [2, 1, 3, '2:'], [18, 1, 3, '18:'], [3, 1, 4, '3:'], [56, 1, 6, '56:'],
]
for (const [s, a0, a1, pre] of coldStarts) add(`cold ${s}:${a0}-${a1}`, [span(s, a0, a1)], { surahPrefix: pre })

// B) MID-SURAH start — must lock to the actual ayah, not the surah opening.
const mids = [[2, 30, 32], [2, 255, 255], [18, 10, 12], [36, 20, 23], [55, 26, 30], [3, 190, 194], [67, 15, 17]]
for (const [s, a0, a1] of mids) add(`mid ${s}:${a0}`, [span(s, a0, a1)], { nearAyah: [s, a0, a1] })

// C) SEQUENTIAL advance across ayat (three separate commits).
add('seq 2:1→2:5', [span(2, 1, 2), span(2, 3, 4), span(2, 5, 5)], { nearAyah: [2, 4, 6] })
add('seq 36:1→36:6', [span(36, 1, 2), span(36, 3, 4), span(36, 5, 6)], { nearAyah: [36, 5, 7] })
add('seq 18:1→18:5', [span(18, 1, 2), span(18, 3, 3), span(18, 4, 5)], { nearAyah: [18, 4, 6] })

// D) FAR JUMPS between surahs within the session.
add('jump 112→18', [span(112, 1, 4), span(18, 1, 3)], { surahPrefix: '18:' })
add('jump 2:255→114', [span(2, 255, 255), span(114, 1, 3)], { surahPrefix: '114:' })
add('jump 1→108→1', [span(1, 1, 4), span(108, 1, 3), span(1, 1, 4)], { surahPrefix: '1:' })
add('jump 36→67', [span(36, 1, 4), span(67, 1, 3)], { surahPrefix: '67:' })

// E) SALAH rak'ah shape: Fatiha → short surah → Fatiha → short surah.
add('salah rak1', [span(1, 1, 7), span(112, 1, 4)], { surahPrefix: '112:' })
add('salah rak2 (2nd fatiha)', [span(1, 1, 7), span(108, 1, 3), span(1, 1, 7), span(105, 1, 5)], { surahPrefix: '105:' })

// F) AMBIGUOUS / short phrases — should NOT confidently lock (guard against false locks).
//    Single very-common words / 2-word fragments.
add('ambiguous "الله"', [norm(ar(1, 1) || '').split(' ').filter(Boolean).slice(1, 3).join(' ')], { noLock: true })

// G) REPEATED-phrase surahs — Ar-Rahman refrain; must not regress or mislock.
add('rahman refrain 55:12-16', [span(55, 12, 16)], { nearAyah: [55, 12, 16] })
add('rahman seq w/ refrain', [span(55, 1, 8), span(55, 9, 16)], { nearAyah: [55, 13, 17] })

// H) PERTURBED (dropped words) robustness.
add('perturb 2:255 (10%)', [perturb(span(2, 255, 255), 0.10, 7)], { surahPrefix: '2:' })
add('perturb 36:1-5 (12%)', [perturb(span(36, 1, 5), 0.12, 11)], { surahPrefix: '36:' })
add('perturb 18:1-4 (10%)', [perturb(span(18, 1, 4), 0.10, 3)], { surahPrefix: '18:' })
add('perturb 1:1-7 (8%)', [perturb(span(1, 1, 7), 0.08, 5)], { surahPrefix: '1:' })

// ── HARD batch: realistic ElevenLabs imperfections ───────────────────────────
// Work on normalized tokens so we can drop the "ال" prefix the way Scribe often does
// (log #1757 gave "الله رحمن الرحيم" — dropped ال from الرحمن).
const AL = norm('ال' + 'x').slice(0, 2)  // the normalized "ال" prefix, derived not typed
function toks(s, a0, a1) { const o = []; for (let a = a0; a <= a1; a++) { const t = ar(s, a); if (t) o.push(...norm(t).split(' ').filter(w => w.length > 1)) } return o }
function rng(seed) { let r = seed; return () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff } }
// drop the ال prefix from ~p of eligible words, and drop ~q whole words
function scribey(tokenArr, p, q, seed) {
  const rnd = rng(seed); const out = []
  for (const w of tokenArr) {
    if (rnd() < q) continue
    if (w.startsWith(AL) && w.length > AL.length + 1 && rnd() < p) out.push(w.slice(AL.length))
    else out.push(w)
  }
  return out.join(' ')
}

// I) ال-prefix dropping (Scribe's most common distortion)
add('al-drop 1:1-4', [scribey(toks(1, 1, 4), 0.6, 0, 21)], { surahPrefix: '1:' })
add('al-drop 112:1-4', [scribey(toks(112, 1, 4), 0.7, 0, 22)], { surahPrefix: '112:' })
add('al-drop 2:255', [scribey(toks(2, 255, 255), 0.5, 0.05, 23)], { surahPrefix: '2:' })
add('al-drop+wordDrop 36:1-5', [scribey(toks(36, 1, 5), 0.5, 0.12, 24)], { surahPrefix: '36:' })

// J) HEAVY perturbation (fast reciter, poor mic)
add('heavy 20% 18:1-5', [perturb(span(18, 1, 5), 0.20, 31)], { surahPrefix: '18:' })
add('heavy 25% 55:1-10', [perturb(span(55, 1, 10), 0.25, 32)], { surahPrefix: '55:' })
add('heavy 25% 2:1-6', [perturb(span(2, 1, 6), 0.25, 33)], { surahPrefix: '2:' })

// K) MID-AYAH resume (reciter resumes from the middle of a long ayah)
{ const t = toks(2, 255, 255); add('mid-ayah 2:255 tail', [t.slice(Math.floor(t.length / 2)).join(' ')], { surahPrefix: '2:' }) }
{ const t = toks(2, 282, 282); if (t.length > 20) add('mid-ayah 2:282 tail', [t.slice(30).join(' ')], { surahPrefix: '2:' }) }

// L) SHARED-OPENING surahs — must not mislock across surahs that share an opening phrase.
// "الم" openers: 2,3,29,30,31,32.  "الحمد لله" openers: 1,6,18,34,35.
add('share الحمد→6', [span(6, 1, 3)], { surahPrefix: '6:' })
add('share الحمد→18', [span(18, 1, 3)], { surahPrefix: '18:' })
add('share الم→3', [span(3, 1, 5)], { surahPrefix: '3:' })
add('share الم→29', [span(29, 1, 4)], { surahPrefix: '29:' })

// M) BACKWARD re-read (reciter repeats the previous ayah) — should stay in-surah, not fling away.
add('reread 36:1→36:3→36:2', [span(36, 1, 2), span(36, 3, 3), span(36, 2, 2)], { surahPrefix: '36:' })

// N) NON-QURAN / dhikr text between ayat — advance() should hold (return null), not jump.
{ // takbir/tasbih are not verses; expect the phrase alone produces no lock from cold
  const dhikr = norm('الله اكبر الله اكبر سبحان ربي العظيم')
  add('dhikr-only no-lock', [dhikr], { noLock: true })
}

// O) SHORT cold openings — latency: how few words until it locks?
// NOTE: verse a=1 of every surah has the Basmala embedded in its text (بسم الله الرحمن الرحيم …),
// and the Basmala alone is ambiguous across 114 surahs — it correctly should NOT lock. So skip
// the 4-token Basmala prefix and measure locking on the first real, distinctive surah words.
// 112:1 and 105:1 embed the 4-token Basmala prefix; skip it to test the real surah words.
// Distinctive openings lock fast (Ikhlas "قل هو الله" is a unique trigram → 3 words).
add('short 3w 112 (real words)', [toks(112, 1, 1).slice(4, 7).join(' ')], { anyLockOK: true })
// Al-Fil's "ألم تر كيف فعل ربك" is SHARED with 89:6 — 4 words is genuinely ambiguous and must
// NOT lock; it needs "بأصحاب" (6 words) to disambiguate. Both facts are asserted:
add('105 first-4w is ambiguous (no lock)', [toks(105, 1, 1).slice(4, 8).join(' ')], { noLock: true })
add('short 6w 105 disambiguates', [toks(105, 1, 1).slice(4, 10).join(' ')], { surahPrefix: '105:' })
add('basmala-only must NOT lock', [toks(112, 1, 1).slice(0, 4).join(' ')], { noLock: true })

// ── P) HAIKU RESCUE — lockToSurah() snap (the deterministic half of the rescue path) ─────
// Simulates: tracker was lost, Haiku returned a surah, we snap to the exact position locally.
function rescueCheck(name, surah, ayahHint, text, expect) {
  tracker.reset()
  const r = tracker.lockToSurah(text, surah, ayahHint)
  if (expect.null) { check(name, r === null, `expected null got ${r && sa(r.verseIndex)}`); return }
  if (!r) { check(name, false, 'got null'); return }
  const got = sa(r.verseIndex)
  if (expect.surahPrefix) check(name, got.startsWith(expect.surahPrefix) && (expect.minConf === undefined || r.conf >= expect.minConf), `got ${got} conf ${r.conf}`)
  else if (expect.exact) check(name, got === expect.exact, `expected ${expect.exact} got ${got}`)
}
// clean text → snaps to exact ayah via anchors (conf>0)
rescueCheck('rescue snap 36:20 (clean)', 36, 1, span(36, 20, 22), { surahPrefix: '36:', minConf: 1 })
rescueCheck('rescue snap 2:255 (clean)', 2, 1, span(2, 255, 255), { surahPrefix: '2:', minConf: 1 })
// heavily perturbed text that plain advance() would miss → still snaps within the right surah
rescueCheck('rescue snap 18 (25% drop)', 18, 1, perturb(span(18, 1, 6), 0.25, 41), { surahPrefix: '18:', minConf: 1 })
rescueCheck('rescue snap 55 (al-drop)', 55, 1, scribey(toks(55, 1, 10), 0.6, 0.1, 42), { surahPrefix: '55:', minConf: 1 })
// anchor-less seed: text has NO trigram in the named surah → seeds at the hinted ayah (conf 0)
rescueCheck('rescue seed 67:5 (no anchor)', 67, 5, span(112, 1, 3), { surahPrefix: '67:' })
// bad surah number → null (client keeps listening)
rescueCheck('rescue bad surah 200', 200, 1, span(1, 1, 4), { null: true })

// ── Evaluate ─────────────────────────────────────────────────────────────────
console.log(`corpus: ${verses.length} verses | tracker WORDS=${tracker.WORDS.length} tri=${tracker.tri.size}\n`)
for (const tc of T) {
  const steps = run(tc.chunks)
  const vi = lastVerse(steps)
  const got = sa(vi)
  const e = tc.expect
  if (e.noLock) {
    check(tc.name, !anyLock(steps), `expected NO lock but locked to ${got}`)
  } else if (e.anyLockOK) {
    check(tc.name, anyLock(steps), `expected a lock but never locked`)
  } else if (e.surahPrefix) {
    check(tc.name, got.startsWith(e.surahPrefix), `expected ${e.surahPrefix}* got ${got}`)
  } else if (e.nearAyah) {
    const [s, lo, hi] = e.nearAyah
    const ok = verses[vi] && verses[vi].s === s && verses[vi].a >= lo && verses[vi].a <= hi
    check(tc.name, ok, `expected ${s}:${lo}-${hi} got ${got}`)
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed  (of ${pass + fail})`)
if (fails.length) { console.log('\nFailures:'); for (const f of fails) console.log('  ' + f) }
process.exit(fail ? 1 : 0)
