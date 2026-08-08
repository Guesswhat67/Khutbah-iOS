// Daily Quran-reading streak — offline-first, per-device.
//
// All day-to-day state lives in localStorage so the streak and the reminder
// decisions work with no network. We best-effort mirror completed days to D1
// (functions/api/streak.js) so a future friends/dashboard feature (Phase 2) can
// attach to an email without re-architecting. Quote rotation for the reminder
// notifications also lives here, reading the bundled src/data/quotes.json.
//
// Kept independent of App.jsx (own API base + token) to avoid a circular import.

import { Capacitor } from '@capacitor/core'
import { getDeviceId } from './device'
import quotesData from '../data/quotes.json'
import { apiFetch, apiHeaders } from './net'

const IS_NATIVE = Capacitor.isNativePlatform()
const API_BASE = IS_NATIVE ? 'https://khutbah-v2.pages.dev' : ''
// Shared header factory (token + x-device-id) so /api/streak matches every other endpoint.
const jsonHeaders = () => apiHeaders({ 'Content-Type': 'application/json' })

export const QUOTES = Array.isArray(quotesData?.quotes) ? quotesData.quotes : []

const TODAY_KEY = 'streak-today'        // { day, read: ["s:a",...], completed }
const STATE_KEY = 'streak-state'        // { current, longest, lastCompletedDay }
const SHOWN_KEY = 'streak-quotes-shown' // [quoteId,...] rotation tracker
const DAYS_KEY  = 'streak-days'         // ["YYYY-MM-DD",...] days the goal was met (for the week strip)
const STATS_KEY = 'streak-detailed-stats' // { "YYYY-MM-DD": { hasanat, verses, surahs: [...] } }

const get = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb } catch { return fb } }
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

// ── Local date helpers (streaks are reckoned by the device's local day) ──
function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
export function todayStr() { return ymd(new Date()) }
function yesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d) }

// ── Persistence ──
function loadToday() {
  const t = get(TODAY_KEY, null)
  if (t && t.day === todayStr()) {
    return { day: t.day, read: Array.isArray(t.read) ? t.read : [], completed: !!t.completed }
  }
  return { day: todayStr(), read: [], completed: false } // new day → reset
}
function saveToday(t) { set(TODAY_KEY, t) }

function loadState() {
  const s = get(STATE_KEY, null)
  return (s && typeof s.current === 'number')
    ? s : { current: 0, longest: 0, lastCompletedDay: null }
}
function saveState(s) { set(STATE_KEY, s) }

// The streak number to SHOW. Lenient by ONE day only: the chain stays alive as long
// as the last completion was today or yesterday — so missing a single day doesn't
// break it. Two consecutive missed days breaks it (0) until completed again.
// (The earlier implementation also let the day-before-yesterday survive, which was
// effectively two days of grace and contradicted the documented "one-day leniency".)
export function getDisplayStreak() {
  const s = loadState()
  const last = s.lastCompletedDay
  if (last === todayStr() || last === yesterdayStr()) return s.current || 0
  return 0
}

export function getStreakState() { return loadState() }

export function getProgress(goal) {
  const t = loadToday()
  const count = t.read.length
  return { count, goal, completed: t.completed || count >= goal, streak: getDisplayStreak() }
}

// The set of "s:a" verse keys already read today. Goals use this to decide whether
// a fixed passage (e.g. Surah al-Ikhlas, Ayat al-Kursi) is complete.
export function getReadSetToday() {
  return new Set(loadToday().read)
}

// Record one or more "s:a" verse keys as read today. Returns the new progress and
// whether the daily goal was just met for the first time.
export function recordVerses(keys, goal, quranData = null) {
  if (!keys || keys.length === 0) {
    return { changed: false, justCompleted: false, ...getProgress(goal) }
  }
  const t = loadToday()
  const before = t.read.length
  const seen = new Set(t.read)
  
  // For detailed stats tracking
  const newKeys = []
  
  for (const k of keys) {
    if (k && !seen.has(k)) {
      seen.add(k)
      newKeys.push(k)
    }
  }
  t.read = Array.from(seen)
  const count = t.read.length

  let justCompleted = false
  if (!t.completed && count >= goal) {
    t.completed = true
    justCompleted = true
    markDayComplete(goal, count)
  }
  saveToday(t)
  
  if (newKeys.length > 0 && quranData) {
    updateDetailedStats(newKeys, quranData)
  }

  return {
    changed: count !== before || justCompleted,
    justCompleted,
    count,
    goal,
    completed: t.completed,
    streak: getDisplayStreak(),
  }
}

function markDayComplete(goal, count) {
  const s = loadState()
  const today = todayStr()
  if (s.lastCompletedDay === today) return // already counted today
  // One-day grace: continue the chain only if the last completion was yesterday;
  // a 2+ day gap restarts at 1. (Earlier code also accepted the day-before-yesterday,
  // which contradicted the documented one-day leniency and threw ReferenceError when
  // the `dayBeforeYesterdayStr()` helper was never defined — fixed in PLAN-022.)
  const cont = s.lastCompletedDay === yesterdayStr()
  s.current = cont ? (s.current || 0) + 1 : 1
  s.longest = Math.max(s.longest || 0, s.current)
  s.lastCompletedDay = today
  saveState(s)
  recordCompletedDay(today)
  syncToday(goal, count, true) // best-effort cloud mirror
}

// ── Detailed Stats Tracking (Quranly Style) ──
const SURAH_BONUSES = {
  112: 1066700, // Al-Ikhlas: 1/3 of Quran
  109: 800000,  // Al-Kafirun: 1/4 of Quran
  99: 1600000,  // Al-Zalzalah: 1/2 of Quran
}

// Fix #17 (corrected): match only actual Arabic LETTERS for the Tirmidhi-2910
// "10 rewards per Arabic letter" rule. The previous regex [\u0600-\u06FF] also
// matched harakat/diacritics (U+064B–U+065F), tatweel (U+0640), Arabic-Indic
// digits (U+0660–U+0669), and punctuation — inflating hasanat by ~40%.
// Correct ranges:
//   U+0621–U+063A  base Arabic letters (hamza through ghayn)
//   U+0641–U+064A  base Arabic letters (fa through ya)
//   U+0671–U+06D3  extended Arabic letters (Indo-Pak / South-Asian scripts)
const ARABIC_LETTERS_RE = /[\u0621-\u063A\u0641-\u064A\u0671-\u06D3]/g

// Memoize the "s:a" → verseObj index per quranData array reference. The QuranMode
// passes the SAME preloaded corpus on every scroll tick — QuranStore holds the
// verses as a module-scope immutable `_verses` array that's never garbage-
// collected for the session's lifetime — so the cache lifetime is effectively
// "process", and a strong Map is faster + simpler than a WeakMap.
//
// PLAN-024.1 (Bug #11): the original WeakMap was deliberate GC-tracking for the
// case where the corpus could change references (multiple QuranData clones per
// session) — but QuranStore never replaces `_verses` in this codebase. Each
// `getVerseIndex(quranData)` lookup pays WeakMap's object-identity + GC-list
// overhead without ever benefiting from the reaping. Plain Map is a few ns
// faster per `get()` / `set()` and lets us reason about the cache as
// "grows forever in this session" without weird GC semantics.
const _verseIndexCache = new Map()
function getVerseIndex(quranData) {
  if (!quranData) return null
  let m = _verseIndexCache.get(quranData)
  if (m) return m
  m = new Map()
  for (const v of quranData) m.set(`${v.s}:${v.a}`, v)
  _verseIndexCache.set(quranData, m)
  return m
}

// Bound STATS_KEY growth: kept yesterday + today forever, plus the trailing 90 days.
// Long-term users otherwise accumulate thousands of date keys, slowing every refresh
// of the home tile / streak chip / week strip.
const STATS_RETENTION_DAYS = 90
function trimStats(stats) {
  const keys = Object.keys(stats)
  if (keys.length <= STATS_RETENTION_DAYS + 5) return stats   // plenty of headroom
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - STATS_RETENTION_DAYS)
  const cutoffKey = ymd(cutoff)
  const today = todayStr()
  const next = {}
  const yesterday = yesterdayStr()
  for (const k of keys) {
    if (k === today || k === yesterday || k >= cutoffKey) next[k] = stats[k]
  }
  return next
}

function updateDetailedStats(newKeys, quranData) {
  const statsRaw = get(STATS_KEY, {})
  const stats = trimStats(statsRaw)
  const today = todayStr()
  if (!stats[today]) stats[today] = { hasanat: 0, verses: 0, surahs: [] }

  let newHasanat = 0
  const surahsTouched = new Set(stats[today].surahs || [])

  const idx = getVerseIndex(quranData)
  for (const k of newKeys) {
    const [sStr, aStr] = k.split(':')
    const s = parseInt(sStr)
    const a = parseInt(aStr)
    surahsTouched.add(s)

    // O(1) verse lookup via the cached index — replaces the previous O(6236)
    // `quranData.find()` per key, which on every scroll tick did tens of thousands
    // of deep comparisons. New keys MUST come from the QuranStore pipeline (which
    // produces the same verses as `quranData`), so a miss here means caller bug —
    // we log once and skip rather than silently re-implementing the O(n) fallback.
    const verseObj = idx ? idx.get(k) : null
    if (verseObj && verseObj.ar) {
      // Count actual Arabic letters only (no harakat, tatweel, digits, or punctuation).
      // Tirmidhi 2910: 10 rewards per Arabic letter.
      const letterCount = (verseObj.ar.match(ARABIC_LETTERS_RE) || []).length
      newHasanat += letterCount * 10
    } else if (!idx && quranData) {
      // Caller didn't pass a corpus at all — the legacy shape that worked before
      // getVerseIndex existed. Fall through to a direct lookup for backwards compat.
      const legacy = quranData.find(v => v.s === s && v.a === a)
      if (legacy && legacy.ar) {
        const letterCount = (legacy.ar.match(ARABIC_LETTERS_RE) || []).length
        newHasanat += letterCount * 10
      }
    }

    // Last-ayah bonus: O(1) via index when possible (was O(6236) `quranData.some()`).
    if (SURAH_BONUSES[s]) {
      const hasNext = idx ? idx.has(`${s}:${a + 1}`) : quranData && quranData.some(v => v.s === s && v.a === a + 1)
      if (!hasNext) newHasanat += SURAH_BONUSES[s]
    }
  }

  stats[today].hasanat += newHasanat
  stats[today].verses += newKeys.length
  stats[today].surahs = Array.from(surahsTouched)

  set(STATS_KEY, stats)
}

export function getStatsSummary() {
  const stats = get(STATS_KEY, {})
  const today = todayStr()
  
  // Aggregate functions
  const sum = (days) => days.reduce((acc, d) => {
    acc.hasanat += (stats[d]?.hasanat || 0)
    acc.verses += (stats[d]?.verses || 0)
    acc.surahs = new Set([...acc.surahs, ...(stats[d]?.surahs || [])])
    return acc
  }, { hasanat: 0, verses: 0, surahs: new Set() })

  // Find days for this week (Sun-Sat)
  const td = new Date()
  const weekDays = []
  for (let i = 0; i <= td.getDay(); i++) {
    const d = new Date(td)
    d.setDate(td.getDate() - i)
    weekDays.push(ymd(d))
  }
  
  // Find days for this month
  const monthDays = Object.keys(stats).filter(d => d.startsWith(today.slice(0, 7)))
  
  const todayStats = sum([today])
  const weekStats = sum(weekDays)
  const monthStats = sum(monthDays)
  const allTimeStats = sum(Object.keys(stats))
  
  return {
    today: { hasanat: todayStats.hasanat, verses: todayStats.verses, surahs: todayStats.surahs.size },
    week: { hasanat: weekStats.hasanat, verses: weekStats.verses, surahs: weekStats.surahs.size },
    month: { hasanat: monthStats.hasanat, verses: monthStats.verses, surahs: monthStats.surahs.size },
    allTime: { hasanat: allTimeStats.hasanat, verses: allTimeStats.verses, surahs: allTimeStats.surahs.size }
  }
}

// ── Completed-days log (for the Home week calendar) ──
function recordCompletedDay(day) {
  const days = get(DAYS_KEY, [])
  if (!Array.isArray(days)) return set(DAYS_KEY, [day])
  if (!days.includes(day)) {
    days.push(day)
    // Keep it bounded — only recent history matters for the strip.
    set(DAYS_KEY, days.slice(-40))
  }
}

// The current Sun→Sat week with a completion flag per day, for the Home strip.
export function getWeekStatus() {
  const days = new Set(get(DAYS_KEY, []))
  // Existing installs won't have a back-filled log; make sure the latest completion shows.
  const st = loadState()
  if (st.lastCompletedDay) days.add(st.lastCompletedDay)
  if (loadToday().completed) days.add(todayStr())
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - today.getDay()) // back to Sunday
  const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const todayY = todayStr()
  const out = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const y = ymd(d)
    out.push({
      ymd: y,
      dow: i,
      label: labels[i],
      dayNum: d.getDate(),
      completed: days.has(y),
      isToday: y === todayY,
      isFuture: d > today && y !== todayY,
    })
  }
  return out
}

// ── Quote rotation ──
// Returns n quotes, avoiding any already shown until the whole pool is exhausted,
// then reshuffles. Also avoids repeats within the same batch (the 3 daily slots).
// PLAN-022: `shown` is bounded at SHOWN_MAX so users who keep the app installed for
// years don't accumulate an unbounded quoteId list (it was previously only reset
// when the whole pool was exhausted — so a 100-quote pool would grow `shown` to ~100
// entries per cycle but never shrink if the user ran out of `n` flows first).
const SHOWN_MAX = 60   // well above the largest single scheduling burst (3⋅7 = 21 max, even with fasting nudges)
export function nextQuotes(n) {
  let shown = get(SHOWN_KEY, [])
  if (!Array.isArray(shown)) shown = []
  const out = []
  for (let i = 0; i < n; i++) {
    let pool = QUOTES.filter(q => !shown.includes(q.id) && !out.some(o => o.id === q.id))
    if (pool.length === 0) { shown = []; pool = QUOTES.filter(q => !out.some(o => o.id === q.id)) }
    if (pool.length === 0) pool = QUOTES.slice()
    const pick = pool[Math.floor(Math.random() * pool.length)]
    out.push(pick)
    shown.push(pick.id)
  }
  // FIFO trim: keep MOST recent SHOWN_MAX ids, drop the oldest. Done AFTER the
  // batch is built so today's picks are preserved even if we overflow this run.
  if (shown.length > SHOWN_MAX) shown = shown.slice(-SHOWN_MAX)
  set(SHOWN_KEY, shown)
  return out
}

// ── Best-effort D1 sync (never blocks the UI; failures are silently ignored) ──
// Uses apiFetch so a hung /api/streak endpoint (flaky masjid Wi-Fi) can't
// stall the syncToday() Promise and — because recordVerses() awaits it
// before returning in some call paths — can't slow down verse-recording.
// 8s timeout matches logger.js /api/log budget; 1 retry on 5xx gives a
// single edge-node hiccup one chance to recover before we give up.
export async function syncToday(goal, count, completed) {
  try {
    await apiFetch(`${API_BASE}/api/streak`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        device_id: getDeviceId(),
        day: todayStr(),
        verses_read: count,
        goal,
        completed: completed ? 1 : 0,
        state: loadState(), // client is authoritative for its own streak counters
      }),
    }, { timeoutMs: 8000, retries: 1 })
  } catch {}
}

// Push the current (possibly partial) day — call on app open.
export function syncProgress(goal) {
  const t = loadToday()
  return syncToday(goal, t.read.length, t.completed)
}
