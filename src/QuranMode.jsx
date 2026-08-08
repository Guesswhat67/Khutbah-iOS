import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { SherpaSTT } from './plugins/SherpaSTT'
import { AppleSTT } from './plugins/AppleSTT'
import { Icons } from './utils/icons'
import { getQuranVerses, norm } from './utils/quranStore'
import { logQuran, logQuranLocal } from './utils/logger'
import { pulse } from './utils/haptics'
import { apiFetch, apiHeaders } from './utils/net'
import { renderAIContent } from './utils/renderAI'
import { recordVerses, getProgress, getReadSetToday } from './utils/streak'
import { refreshReminders } from './utils/notify'
import { showToast } from './utils/toast'
import { pushBackHandler } from './utils/backstack'
import { FRIDAY_GOAL, NIGHTLY_GOAL, resolveSectionKeys, requiredKeysOf, goalProgressIn } from './data/goals'
import { ScribeSession } from './utils/scribeSTT'
import { trimTranscript } from './utils/sttSanity'
import { primeTracker } from './utils/quranTracker'

// Temporary detection-debug overlay (flip to false to hide once testing is done).
const SHOW_DETECT_DEBUG = false

const ANALYZE_SIZES = { sm: '0.92rem', md: '1.18rem', lg: '1.5rem' }

const IS_NATIVE = Capacitor.isNativePlatform()
const IS_IOS = Capacitor.getPlatform() === 'ios'
const API_BASE = IS_NATIVE ? 'https://khutbah-v2.pages.dev' : ''
const NOTICE_KEY = 'quran-notice-accepted'
const BOOKMARK_KEY = 'quran-bookmarks'
const SESSION_KEY = 'quran-session-v1'   // localStorage: survives a process kill so a Salah log isn't lost if the OS closes the app
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000  // don't restore a session older than 6h (stale)
const BROWSE_POS_KEY = 'quran-browse-pos' // last reading position in Browse Quran
const MUSHAF_POS_KEY = 'quran-mushaf-pos' // last reading position in the Arabic-only Mushaf

const DEFAULT_BOOKMARKS = [
  { id: 'bm-kahf',  label: 'Friday — Surah Al-Kahf',        surahNum: 18, surahName: 'Al-Kahf',  ayahNum: 1, isDefault: true },
  { id: 'bm-mulk',  label: 'After Isha — Surah Al-Mulk',    surahNum: 67, surahName: 'Al-Mulk',  ayahNum: 1, isDefault: true },
]

// Reading-goal definitions are shared with the Home tile (src/data/goals.js).

function highlightText(verseArabic, matchWords) {
  if (!matchWords || matchWords.length === 0) return verseArabic
  const nWords = matchWords.map(w => norm(w))
  const tokens = verseArabic.split(/(\s+)/)
  const nTokens = norm(verseArabic).split(/(\s+)/)
  return tokens.map((token, i) => {
    if (!token.trim()) return token
    const nToken = nTokens[i]
    if (nToken && nWords.some(w => w === nToken)) {
      return <mark key={i} className="quran-highlight">{token}</mark>
    }
    return token
  })
}

// Compact daily-streak header shown atop the Quran Browse view. Fills as the
// reader scrolls through verses; flips to a "complete" state at the goal.
function StreakBanner({ streak, count, goal, completed, active, onToggle }) {
  const pct = Math.max(0, Math.min(100, Math.round((count / goal) * 100)))
  const cls = "streak-banner" + (completed ? " streak-banner-done" : active ? " streak-banner-active" : "")
  const btnCls = "streak-start-btn" + (active ? " streak-start-btn-pause" : "")
  const label = completed
    ? "✓ Today’s goal complete — barakAllahu feek!"
    : active
      ? count + " / " + goal + " verses — reading…"
      : count + " / " + goal + " verses today"
  return (
    <div className={cls}>
      <div className="streak-flame" title={streak + "-day streak"}>
        {"🔥"}<span className="streak-count">{streak}</span>
      </div>
      <div className="streak-progress">
        <div className="streak-progress-track">
          <div className="streak-progress-fill" style={{ width: pct + "%" }} />
        </div>
        <span className="streak-progress-label">{label}</span>
      </div>
      {!completed && (
        <button className={btnCls} onClick={onToggle}>
          {active ? "⏸" : "▶ Read"}
        </button>
      )}
    </div>
  )
}

function QuranNotice({ onAccept }) {
  return (
    <div className="quran-notice-overlay">
      <div className="quran-notice-card">
        <div className="quran-notice-icon">📖</div>
        <h3 className="quran-notice-title">Important Notice</h3>
        <div className="quran-notice-body">
          <p><strong>Do not use this feature during Fard (obligatory) prayers.</strong></p>
          <p>Using a phone during Salah is highly inappropriate and invalidates the prayer. Even in Nafl (voluntary) prayers, using this app is strongly discouraged.</p>
          <p>This feature is intended for <strong>after prayer</strong> — to review and reflect on the verses that were recited, and to use the AI analysis for deeper understanding.</p>
        </div>
        <button className="quran-notice-btn" onClick={onAccept}>I understand — continue</button>
      </div>
    </div>
  )
}


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

function findVerse(transcript, verses, wordIndex, currentVerse = null, surahLock = null) {
  const t = norm(transcript)
  if (t.length < 5) return null
  const words = t.split(' ').filter(w => w.length > 2)
  if (words.length < 2) return null

  const scoreVerse = (v) => {
    let hits = 0
    for (const w of words) if (v.n.includes(w)) hits++
    return hits / words.length
  }

  // Coverage: fraction of the VERSE's own words present in the transcript. This is the
  // metric that rescues long cloud-STT chunks — a full ayah buried in a 40-word partial
  // scores ~0 on scoreVerse (recall over transcript) but ~1.0 on coverage.
  const tSet = new Set(words)
  const coverVerse = (v) => {
    const vw = v._nw || (v._nw = v.n.split(' ').filter(w => w.length > 2))
    if (vw.length < 4) return { cov: 0, hits: 0 }   // too-short verses can't use coverage (false-match guard)
    let h = 0
    for (const w of vw) if (tSet.has(w)) h++
    return { cov: h / vw.length, hits: h }
  }

  if (currentVerse) {
    if (scoreVerse(currentVerse) >= 0.35) return currentVerse
    const nextAyah = verses.find(v => v.s === currentVerse.s && v.a === currentVerse.a + 1)
    if (nextAyah && scoreVerse(nextAyah) >= 0.35) return nextAyah
    const next2 = nextAyah ? verses.find(v => v.s === nextAyah.s && v.a === nextAyah.a + 1) : null
    if (next2 && scoreVerse(next2) >= 0.35) return next2
    if (nextAyah && nextAyah.s !== currentVerse.s) {
      const nextAfterBoundary = verses.find(v => v.s === nextAyah.s && v.a === nextAyah.a + 1)
      if (nextAfterBoundary && scoreVerse(nextAfterBoundary) >= 0.35) return nextAfterBoundary
    }
  }

  const candidateIndices = new Set()
  for (const w of words) {
    const indices = wordIndex.get(w)
    if (indices) for (const i of indices) candidateIndices.add(i)
  }
  if (candidateIndices.size === 0) return null

  const candidates = []
  for (const i of candidateIndices) candidates.push(verses[i])

  if (currentVerse) {
    const sameSurah = candidates.filter(v => v.s === currentVerse.s)
    let localBest = null, localBestScore = 0
    for (const v of sameSurah) {
      const dist = Math.abs(v.a - currentVerse.a)
      if (dist > 10) continue
      let score = scoreVerse(v)
      score += (10 - dist) * 0.03
      if (surahLock === currentVerse.s) score += 0.12
      if (score > localBestScore && score >= 0.35) { localBestScore = score; localBest = v }
    }
    if (localBest) return localBest

    for (const v of sameSurah) {
      let score = scoreVerse(v)
      if (surahLock === currentVerse.s) score += 0.12
      if (score > localBestScore && score >= 0.35) { localBestScore = score; localBest = v }
    }
    if (localBest) return localBest

    const adjThreshold = surahLock ? 0.65 : 0.55
    const adjacent = candidates.filter(v => v.s === currentVerse.s - 1 || v.s === currentVerse.s + 1)
    for (const v of adjacent) {
      const score = scoreVerse(v)
      if (score > localBestScore && score >= adjThreshold) { localBestScore = score; localBest = v }
    }
    if (localBest) return localBest
  }

  let best = null, bestScore = 0
  const globalThreshold = surahLock ? 0.60 : 0.50
  for (const v of candidates) {
    const st = scoreVerse(v)
    const { cov, hits } = coverVerse(v)
    // Long-transcript rescue: a verse with ≥4 of its own words and ≥80% coverage is a
    // strong match even when it's only a small slice of a big transcript blob.
    const eff = (hits >= 4 && cov >= 0.80) ? Math.max(st, cov) : st
    if (eff > bestScore && eff >= globalThreshold) { bestScore = eff; best = v }
  }
  return best
}

// Diagnostic only: the single best-scoring verse ignoring thresholds, so a miss can
// report how close it came (e.g. "best Hud 11:48 @ 0.42"). Same scan cost as findVerse.
function bestVerseGuess(transcript, verses, wordIndex) {
  const t = norm(transcript)
  const words = t.split(' ').filter(w => w.length > 2)
  if (words.length < 2) return null
  const tSet = new Set(words)
  const scoreVerse = (v) => {
    let hits = 0
    for (const w of words) if (v.n.includes(w)) hits++
    return hits / words.length
  }
  const coverVerse = (v) => {
    const vw = v._nw || (v._nw = v.n.split(' ').filter(w => w.length > 2))
    if (vw.length < 4) return 0
    let h = 0
    for (const w of vw) if (tSet.has(w)) h++
    return h / vw.length
  }
  const seen = new Set()
  let best = null, bestScore = 0, bestCov = 0
  for (const w of words) {
    const indices = wordIndex.get(w)
    if (!indices) continue
    for (const i of indices) {
      if (seen.has(i)) continue
      seen.add(i)
      const s = Math.max(scoreVerse(verses[i]), coverVerse(verses[i]))
      if (s > bestScore) { bestScore = s; best = verses[i]; bestCov = coverVerse(verses[i]) }
    }
  }
  return best ? { verse: best, score: bestScore, cov: bestCov } : null
}

// ── Tracking / stability tuning (A + B) ──────────────────────────────────────
const TRACK_KEEP   = 0.40   // keep tracking within window if best window score ≥ this
const MOVE_MARGIN  = 0.20   // a far/backward verse must beat current by this to switch
const MOVE_CONFIRM = 2      // consecutive confirmations needed for a far/backward jump
const WINDOW_BACK  = 1      // verses to look behind current (handles short repeats)
const WINDOW_FWD   = 3      // verses to look ahead (handles skips + surah boundaries)

// Fraction of transcript words found in a verse (0..1)
function wordScore(text, verse) {
  const words = norm(text).split(' ').filter(w => w.length > 2)
  if (!words.length) return 0
  let hits = 0
  for (const w of words) if (verse.n.includes(w)) hits++
  return hits / words.length
}

// Words that dominate the dhikr between recitations in Salah (ruku/sujud/takbir/standing).
// A chunk with fewer than 2 *non-filler* meaningful words is treated as a Quran-free gap.
//
// PLAN-024.1 (Bug #12): the list is deliberately conservative. Expanding it is
// a TRADE-OFF, not a pure win:
//   ✓ Adding e.g. 'اللهم', 'اهدنا', 'برحمتك' catches more dhikr in a longer
//     khutbah where the reciter drifts into dua territory mid-flow.
//   ✗ Each of those words also appears in actual Quranic verses — at minimum
//     'اهدنا' is verse 1:6 ("إهدنا الصراط المستقيم"), the central ayah of
//     Al-Fatiha. The conservative list keeps false-positive rate near zero at
//     the cost of mis-classifying some longer dua sequences as Quran (the
//     cursor drifts for a verse then snaps back).
//   ✗ Code-reviewer flagged the originally cited verse references as imprecise
//     (Al-Kahf 18:98 is Khidr's line to Musa, not Yunus عليه السلام's dua —
//     keep the fence-post narrow: if you want to add a new word, screenshot a
//     real Quranic verse that contains it before merging).
//
//    This is intentional. If a future user-reported regression demands better
//    dua detection, the fix is to require the new words to ALSO appear with
//    sequential context (e.g., 'اللهم' preceded by >5 s of silence) — not just
//    a flat in-line match.
const DHIKR_FILLER = new Set([
  'سبحان', 'العظيم', 'الاعلي', 'اكبر', 'سمع', 'حمده', 'وبحمده', 'ربنا', 'استغفر', 'ولك', 'لمن',
])
function isDhikrChunk(text) {
  const words = norm(text).split(' ').filter(w => w.length > 2)
  if (!words.length) return true
  return words.filter(w => !DHIKR_FILLER.has(w)).length < 2
}

// TRACK mode: only look at verses near the current position, with forward bias.
// Returns { verse, rel, score } or null when the reciter has clearly left the window.
function trackVerse(text, verses, vmap, current) {
  const t = norm(text)
  if (t.length < 4) return null
  const idx = vmap.get(`${current.s}:${current.a}`)
  if (idx == null) return null

  let best = null, bestBiased = 0, bestRel = 0
  for (let d = -WINDOW_BACK; d <= WINDOW_FWD; d++) {
    const v = verses[idx + d]
    if (!v) continue
    let s = wordScore(t, v)
    if (d === 0) s += 0.10            // stickiness to current verse
    else if (d === 1) s += 0.08       // next verse is the expected move
    else if (d === 2) s += 0.03
    else if (d < 0) s -= 0.10         // discourage going backward
    if (s > bestBiased) { bestBiased = s; best = v; bestRel = d }
  }
  if (best && bestBiased >= TRACK_KEEP) return { verse: best, rel: bestRel, score: wordScore(t, best) }
  return null
}

// How far into a verse the reciter has reached — furthest verse-word index seen in
// the transcript so far. Used for a stable karaoke-style highlight.
function computeProgress(verse, text, prev) {
  const vWords = verse.n.split(' ')
  const tWords = new Set(norm(text).split(' ').filter(w => w.length > 2))
  let furthest = prev
  for (let i = 0; i < vWords.length; i++) {
    if (vWords[i].length > 2 && tWords.has(vWords[i])) furthest = Math.max(furthest, i)
  }
  return furthest
}

// Highlight the first (count+1) words of the displayed text — progressive, not scattered
// Two-tone karaoke highlight: words up to `confirmed` (from a committed transcript) are solid
// green; words from there up to `provisional` (heard in a live partial, not yet committed) are
// a lighter pending shade. This stops the highlight from looking like it "runs ahead" of the
// recitation — provisional words settle to green the moment they commit.
function highlightProgressive(text, confirmed, provisional = confirmed) {
  if (!text || (confirmed < 0 && provisional < 0)) return text
  const tokens = text.split(/(\s+)/)
  let wordSeen = -1
  return tokens.map((tok, i) => {
    if (tok.trim()) {
      wordSeen++
      if (wordSeen <= confirmed) return <mark key={i} className="quran-highlight">{tok}</mark>
      if (wordSeen <= provisional) return <mark key={i} className="quran-highlight quran-highlight-pending">{tok}</mark>
    }
    return tok
  })
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
function toArabicDigits(n) { return String(n).split('').map(d => AR_DIGITS[+d] ?? d).join('') }

const INDOPAK_URL = '/quran-indopak.json'
let _indopakCache = null   // module-level: survives QuranMode unmounts

export default function QuranMode({ fontStyle, modelReady: modelReadyProp, targetVerse, openView, onOpenViewConsumed, sttMode = 'off', performanceMode = 'medium', quranStreams = 1, quranScript = 'uthmani', streakGoal = 10, streakReminders = true, debugMode = false, onNavigateToQuran, onSaveHistory, onModelReady }) {
  // Detection overlay: hard flag OR the user's Developer Options toggle (self-serve debugging).
  const showDetectDebug = SHOW_DETECT_DEBUG || debugMode
  const [isWide, setIsWide] = useState(() => window.innerWidth >= 600)
  const [noticeAccepted, setNoticeAccepted] = useState(() => !!localStorage.getItem(NOTICE_KEY))
  const [baseModelReady, setBaseModelReady] = useState(modelReadyProp)
  const [baseDlState, setBaseDlState]       = useState('idle')
  const [baseDlProgress, setBaseDlProgress] = useState(0)
  const [quranModelReady, setQuranModelReady] = useState(false)
  const [quranDlState, setQuranDlState]       = useState('idle')
  const [quranDlProgress, setQuranDlProgress] = useState(0)
  const [modelsChecked, setModelsChecked]     = useState(false) // true once the on-device model check resolves (avoids setup-screen flash)
  const [dataState, setDataState]   = useState('idle')
  const [debugLog, setDebugLog]     = useState([])   // recent detection events for the temp overlay
  const [debugCollapsed, setDebugCollapsed] = useState(false)
  const [verseModal, setVerseModal] = useState(null) // ayah opened from Browse (double-tap)
  const [phase, setPhase] = useState('idle')
  const [current, setCurrent]       = useState(null)
  const [sessionVerses, setSessionVerses] = useState([])
  const [analyze, setAnalyze]       = useState({ open: false, loading: false, result: null, error: null })
  const [analyzeTextSize, setAnalyzeTextSize] = useState(() => { try { return localStorage.getItem('analyze-text-size') || 'sm' } catch { return 'sm' } })
  const setAnalyzeTextSizePersist = useCallback((s) => { setAnalyzeTextSize(s); try { localStorage.setItem('analyze-text-size', s) } catch {} }, [])
  const [matchedProgress, setMatchedProgress] = useState(-1)       // confirmed (committed) word index → green
  const [provisionalProgress, setProvisionalProgress] = useState(-1) // heard-in-partial word index → pending shade
  const [rakahDisplay, setRakahDisplay] = useState(1)              // live rak'ah number for the on-screen badge
  const [analyzePicker, setAnalyzePicker] = useState(false)       // choose "Analyze all" vs a specific Rak'ah
  const [sttError, setSttError] = useState(null)
  const [batteryExempt, setBatteryExempt] = useState(true) // assume OK until checked (avoids banner flash)
  const [quranView, setQuranView] = useState('menu')   // menu | read | mushaf | goals | goalread | detect
  const [readSet, setReadSet] = useState(() => getReadSetToday()) // "s:a" keys read today (Goals completion)
  const [goalReader, setGoalReader] = useState(null)   // focused goal reader: { goal, sections, requiredTotal }
  const [goalReqDone, setGoalReqDone] = useState(0)     // required ayat read so far today (drives the top bar)
  const [goalCompleted, setGoalCompleted] = useState(false) // required portion fully read → auto-completed
  const [browseJump, setBrowseJump] = useState('')
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [browsePos, setBrowsePos] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(BROWSE_POS_KEY) || 'null'); if (s && s.surahNum) return s } catch {}
    return { surahNum: null, ayahNum: null }
  })
  const [streakInfo, setStreakInfo] = useState(() => getProgress(streakGoal)) // {count, goal, completed, streak}
  const [streakActive, setStreakActive] = useState(false) // true only when user has tapped ▶ Read
  const [indopakMap, setIndopakMap]         = useState(() => _indopakCache)
  const [indopakLoading, setIndopakLoading] = useState(false)
  const [indopakError, setIndopakError]     = useState(false)
  const [indopakRetry, setIndopakRetry]     = useState(0)
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const saved = localStorage.getItem(BOOKMARK_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return [...DEFAULT_BOOKMARKS]
  })

  const versesRef           = useRef(null)
  const wordIndexRef        = useRef(null)
  const verseIndexRef       = useRef(null)   // Map "s:a" → flat array index (for window tracking)
  const lastReadIdxRef      = useRef(null)   // furthest flat index counted toward today's streak
  const pendingMoveRef      = useRef(null)   // { key, count } — hysteresis for far/backward jumps
  const verseProgressRef    = useRef(-1)     // furthest word index reached in the current verse
  const wakeLockRef         = useRef(null)
  const currentVerseRef     = useRef(null)
  const lockedSurahsRef     = useRef(new Set())
  const pendingSurahRef     = useRef(null)
  const pendingSurahCount   = useRef(0)
  const calibratingRef      = useRef(false)
  const calibrationBuffer   = useRef([])     // verse matches collected during calibration
  const calibrationTimer    = useRef(null)
  const activeTimersRef     = useRef(new Set())   // PLAN-014: single-owner Set for all QuranMode timers
  const recentMatchesRef      = useRef([])
  const browseScrollRef       = useRef(null)
  const surahHeaderRefs       = useRef({})
  const mushafScrollRef       = useRef(null)
  const mushafHeaderRefs      = useRef({})
  const goalScrollRef         = useRef(null)   // scroll container of the focused goal reader
  const goalIdxRef            = useRef(null)   // { flatKeys, requiredEndIdx, lastIdx, completed } for scroll-recording
  const mushafPosRef          = useRef(null)   // last "s:a" saved for Mushaf resume (avoids re-render churn)
  const currentBrowseVerseRef = useRef(null)
  const sessionRestoredRef    = useRef(false)   // guards one-time restore from localStorage
  const rakahRef              = useRef(1)        // Salah: current rak'ah (incremented on each fresh Al-Fatiha opening)
  const fatihaOpenRef         = useRef(false)    // currently inside an already-counted Fatiha opening
  const firstFatihaRef        = useRef(false)    // have we registered the first Fatiha (rak'ah 1)?
  const lastCountedSurahRef   = useRef(null)     // surah of the last committed verse (rak'ah-boundary detection)
  const lastDbgRef            = useRef('')        // dedupe identical consecutive debug lines

  const CALIBRATION_MS  = 12000
  const TRACKER_CALIBRATION_MS = 4000   // cloud path: just a UI cap; locks the instant it's confident
  // Haiku rescue thresholds
  const COLD_ESCALATE_MS = 7000         // if still not locked this long after start → ask Haiku
  const ESCALATE_MIN_MS  = 8000         // min gap between rescue calls (rate-limit / cost)
  const LOST_MAX         = 3            // consecutive committed chunks w/ no anchor before rescue
  const RESCUE_MIN_CONF  = 0.35         // ignore Haiku answers below this confidence
  const VOTE_WINDOW     = quranStreams                              // how many recent results vote
  const VOTE_THRESHOLD  = Math.floor(quranStreams / 2) + 1         // simple majority

  useEffect(() => {
    const handler = () => setIsWide(window.innerWidth >= 600)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('quran-mic-state', { detail: { active: phase === 'listening' || phase === 'calibrating' } }))
  }, [phase])

  const listening = phase === 'listening'
  useEffect(() => { currentVerseRef.current = current }, [current])

  useEffect(() => {
    if (targetVerse && versesRef.current) {
      const { surah, ayah } = targetVerse
      const match = versesRef.current.find(v => v.s === surah && v.a === ayah)
      if (match) {
        // Open the referenced ayah in Browse and scroll to it (works from any tab's links).
        setCurrent(match)
        setQuranView('read')
      }
    }
  }, [targetVerse, dataState])

  const verseAreaRef = useRef(null)
  useEffect(() => {
    if (current && verseAreaRef.current) {
      const el = verseAreaRef.current.querySelector('.quran-verse-card-current')
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
    }
  }, [current])

  const scribeRef       = useRef(null)
  const trackerRef      = useRef(null)   // anchor-based tracker (cloud/ElevenLabs path)
  const trackerLockedRef = useRef(false)
  // PLAN-024 (Bug #4): surah-prompt re-init runs `SherpaSTT.initialize()` →
  // `addListener('result', handleResult)`. If the user navigates away during the
  // `await initialize(...)` resolves, the cleanup useEffect's removeAllListeners()
  // fires once on unmount — but the .then() runs anyway and re-attaches the listener
  // to a torn-down component. This ref flips to true on unmount; the .then() bails.
  const unmountingRef   = useRef(false)
  // ── Haiku rescue path (cloud tracker escalation) ──────────────────────────
  const committedTextRef = useRef('')    // rolling recent committed transcript (spans ayah boundaries)
  const escalationBufRef = useRef('')    // rolling recent transcript for the rescue payload
  const escalatingRef    = useRef(false)  // a rescue call is in flight
  const lastEscalateRef  = useRef(0)      // ts of last rescue (rate-limit)
  const lostCountRef      = useRef(0)     // consecutive committed chunks with no anchor
  const detectStartRef    = useRef(0)     // ts detection started (for cold-escalation delay)
  const surahLockRef    = useRef(null)  // the actively confirmed surah bias
  const CONFIRM_THRESHOLD = 5           // hits needed before a surah is trusted
  const acceptNotice = () => { localStorage.setItem(NOTICE_KEY, '1'); setNoticeAccepted(true) }

  // Keep local base model state in sync if parent updates (e.g. Khutbah tab downloaded it)
  useEffect(() => { if (modelReadyProp) setBaseModelReady(true) }, [modelReadyProp])

  // Check BOTH models on mount in one pass. Until this resolves we show a neutral
  // "Preparing…" spinner instead of the setup gate, so an already-set-up install
  // never flashes the "Set up" screen before the Quran loads.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      SherpaSTT.getModelStatus().catch(() => ({ downloaded: false })),
      SherpaSTT.getQuranModelStatus().catch(() => ({ downloaded: false })),
    ]).then(([base, quran]) => {
      if (cancelled) return
      if (base.downloaded) { setBaseModelReady(true); onModelReady?.() }
      if (quran.downloaded) setQuranModelReady(true)
      setModelsChecked(true)
    })
    return () => { cancelled = true }
  }, [])

  // One-tap setup: download the base speech model (0-50%) then the Quran
  // recitation model (50-100%) back to back, with a single combined progress bar.
  // Bug fix (PLAN-027): ref-based re-entry guard so a double-tap (or React 18
  // StrictMode re-fire) doesn't stack a second `addListener('downloadProgress')`
  // on top of the first. Without this the progress events multiplied per tick
  // and the bar reached 100% in half the real time. Try/finally ensures the
  // guard releases EVEN on the two Phase-1 / Phase-2 catch branches — without
  // finally, an error download would block every future retry (guard stays true).
  const setupInFlightRef = useRef(false)
  const setupModels = async () => {
    if (setupInFlightRef.current || quranDlState === 'downloading') return
    setupInFlightRef.current = true
    setQuranDlState('downloading'); setQuranDlProgress(0)
    try {
      // Phase 1 — base speech model
      if (!baseModelReady) {
        let baseListener
        try {
          // Wrap BOTH the listener registration AND the download in the same
          // try so an addListener rejection (rare — bridge missing on a target
          // platform) lands in the error branch instead of propagating up to
          // the outer finally with quranDlState still set to 'downloading' (the
          // user would see a stuck progress bar with no chance to retry).
          baseListener = await SherpaSTT.addListener('downloadProgress', ({ progress }) => { setQuranDlProgress(Math.round(progress / 2)) })
          await SherpaSTT.downloadModel()
          setBaseModelReady(true)
          onModelReady?.()
        } catch {
          try { baseListener?.remove() } catch {}
          setQuranDlState('error'); return
        }
        baseListener.remove()
      }
      setQuranDlProgress(50)

      // Phase 2 — Quran recitation model
      if (!quranModelReady) {
        let quranListener
        try {
          quranListener = await SherpaSTT.addListener('quranDownloadProgress', ({ progress }) => { setQuranDlProgress(50 + Math.round(progress / 2)) })
          await SherpaSTT.downloadQuranModel()
          setQuranModelReady(true)
        } catch {
          try { quranListener?.remove() } catch {}
          setQuranDlState('error'); return
        }
      }
      setQuranDlProgress(100)
      setQuranDlState('idle')
    } finally {
      setupInFlightRef.current = false
    }
  }

  useEffect(() => {
    if (!noticeAccepted) return
    fetchData()
    return () => {
      // Tear down every STT path so leaving Detect mid-session never leaves the
      // mic open (Apple native, Sherpa, or ElevenLabs WebSocket).
      AppleSTT.stopListening().catch(() => {})
      AppleSTT.removeAllListeners().catch(() => {})
      SherpaSTT.stopListening().catch(() => {})
      SherpaSTT.removeAllListeners().catch(() => {})
      if (scribeRef.current) {
        try { scribeRef.current.disconnect() } catch {}
        scribeRef.current = null
      }
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release() } catch {}
        wakeLockRef.current = null
      }
    }
  }, [noticeAccepted])

  useEffect(() => {
    if (quranScript !== 'indopak') return
    if (_indopakCache) { setIndopakMap(_indopakCache); return }
    // PLAN-016: cancellation guard — the fetch is async and can outlive a quick
    // view-switch (e.g. user taps Indo-Pak, then immediately taps Uthmani before
    // the JSON arrives). Without `cancelled`, setIndopakMap/Error fire on the
    // unmounted first-render instance and React logs the "Can't perform a React
    // state update on an unmounted component" warning. Same fix as HomePanel's
    // fetchCircle (PLAN-017).
    let cancelled = false
    setIndopakLoading(true); setIndopakError(false)
    fetch(INDOPAK_URL)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => { if (cancelled) return; _indopakCache = data; setIndopakMap(data) })
      .catch(() => { if (!cancelled) setIndopakError(true) })
      .finally(() => { if (!cancelled) setIndopakLoading(false) })
    return () => { cancelled = true }
  }, [quranScript, indopakRetry])

  const fetchData = async () => {
    setDataState('loading')
    try {
      const vv = await getQuranVerses()
      versesRef.current = vv
      // Build word index; if empty, reload fresh corpus and rebuild.
      let idx = buildWordIndex(vv)
      if (idx.size === 0) {
        console.warn('QuranMode: built empty word index, attempting fallback load')
        const raw = await (await fetch('/quran.json')).json()
        const processed = raw.map(v => ({
          ...v,
          n: norm(v.ar || ''),
          _lowerEn: v._lowerEn ?? (v.en || '').toLowerCase(),
        }))
        versesRef.current = processed
        idx = buildWordIndex(processed)
      }
      wordIndexRef.current = idx
      const vmap = new Map()
      versesRef.current.forEach((v, i) => vmap.set(`${v.s}:${v.a}`, i))
      verseIndexRef.current = vmap
      setDataState('ready')
    } catch (e) {
      console.error('fetchData error', e)
      setDataState('error')
    }
  }

  const [nextVerse, nextNextVerse] = useMemo(() => {
    if (!current || !versesRef.current) return [null, null]
    const vv = versesRef.current
    const next = vv.find(v => v.s === current.s && v.a === current.a + 1)
              || vv.find(v => v.s === current.s + 1 && v.a === 1) || null
    const next2 = next ? (vv.find(v => v.s === next.s && v.a === next.a + 1)
              || vv.find(v => v.s === next.s + 1 && v.a === 1) || null) : null
    return [next, next2]
  }, [current])

  // Group the reviewed session into rak'ahs (consecutive verses sharing a rakah tag).
  const sessionByRakah = useMemo(() => {
    const groups = []
    let g = null
    for (const v of sessionVerses) {
      const r = v.rakah || 1
      if (!g || g.rakah !== r) { g = { rakah: r, verses: [] }; groups.push(g) }
      g.verses.push(v)
    }
    return groups
  }, [sessionVerses])

  const surahGroups = useMemo(() => {
    if (!versesRef.current) return []
    const groups = []
    let g = null
    for (const v of versesRef.current) {
      if (!g || g.surahNum !== v.s) {
        g = { surahNum: v.s, name: v.sName, nameAr: v.sAr, verses: [] }
        groups.push(g)
      }
      g.verses.push(v)
    }
    return groups
  }, [dataState])

  useEffect(() => {
    try { localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks)) } catch {}
  }, [bookmarks])

  // ── Session persistence ────────────────────────────────────────────────────
  // Restore a saved session once on mount. Stored in localStorage so a Salah log
  // survives even if the OS kills the app mid-recitation (screen off). We ignore
  // sessions older than SESSION_MAX_AGE_MS so a stale one never resurfaces days later.
  useEffect(() => {
    if (dataState !== 'ready' || sessionRestoredRef.current) return
    sessionRestoredRef.current = true
    if (sessionVerses.length > 0) return   // already have an active session in memory
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
      const fresh = saved && (!saved.savedAt || Date.now() - saved.savedAt < SESSION_MAX_AGE_MS)
      if (fresh && Array.isArray(saved.sessionVerses) && saved.sessionVerses.length > 0) {
        lockedSurahsRef.current = new Set(saved.lockedSurahs || [])
        setSessionVerses(saved.sessionVerses)
        const restoredRakah = saved.sessionVerses.reduce((m, v) => Math.max(m, v.rakah || 1), 1)
        rakahRef.current = restoredRakah
        // PLAN-027 (Bug — rak'ah miscount on session restore): without restoring
        // `firstFatihaRef` / `fatihaOpenRef`, the FIRST Al-Fatiha (1:1–1:2) commit
        // after a session-resume would set `firstFatihaRef = true` & log "Rak'ah
        // 1 — Al-Fatiha", but a SAVED session that's already at rak'ah 3 would
        // actually be rakahRef.current = 4 after that single commit (the on-device
        // branch at handleResult L#899 increments when firstFatihaRef is already
        // true; the cloud branch at L#1132 even worse — fired every commit).
        firstFatihaRef.current = restoredRakah > 1
        fatihaOpenRef.current = !!(saved.current && saved.current.s === 1 && saved.current.a <= 2)
        // Reset transient rescue-cycle state on restore so a resumed session
        // doesn't immediately re-fire Haiku (Date.now() - detectStartRef > COLD_ESCALATE_MS)
        // or count itself as already-lost (`lostCount >= LOST_MAX`) on the very
        // first chunk after a 6-hour-old SESSION_KEY payload re-enters memory.
        lostCountRef.current = 0
        escalatingRef.current = false
        detectStartRef.current = Date.now()
        // PLAN-027 review pass: read trackerLocked straight from the persisted
        // boolean instead of inferring it from `lockedSurahsRef.size > 0`. A
        // session that ended mid-calibration (no surah lock yet) needs the
        // tracker to re-lock on resume; the size heuristic was coercing these
        // into a "locked" state and silently preventing re-calibration.
        trackerLockedRef.current = !!saved.trackerLocked
        if (saved.current) { setCurrent(saved.current); currentVerseRef.current = saved.current }
      } else if (saved) {
        try { localStorage.removeItem(SESSION_KEY) } catch {}
      }
    } catch {}
  }, [dataState, sessionVerses.length])

  // Persist (or clear) the session whenever it changes.
  useEffect(() => {
    try {
      if (sessionVerses.length > 0) {
        // PLAN-027: persist the rescue-cycle refs too so a session-restore (Bug Fix #1)
        // can re-arm them with the actual mid-escalation values, not just reset them.
        // Reading refs at-serialize-time picks up the LATEST values even though
        // they're not in the deps array — the next commit will overwrite stale.
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          sessionVerses, current,
          lockedSurahs: [...lockedSurahsRef.current], savedAt: Date.now(),
          lostCount:     lostCountRef.current,
          detectStart:   detectStartRef.current,
          escalating:    escalatingRef.current,
          trackerLocked: trackerLockedRef.current,
        }))
      } else if (sessionRestoredRef.current) {
        localStorage.removeItem(SESSION_KEY)
      }
    } catch {}
  }, [sessionVerses, current])

  const bookmarkedKeys = useMemo(() => new Set(bookmarks.map(b => `${b.surahNum}:${b.ayahNum}`)), [bookmarks])

  const currentSurahRef = useRef(null)

  // Push a detection-reasoning line to the overlay + DEBUG log (log is gated by debug setting).
  // PLAN-024 (Bug #1): declared ABOVE dbgRef so `useRef(dbg)` doesn't dereference a
  // Temporal Dead Zone `const`. The original PLAN-022 order (dbgRef first, dbg later)
  // would throw `ReferenceError: cannot access 'dbg' before initialization` on every
  // render of QuranMode — silently breaking the entire Quran tab on iOS.
  const dbg = useCallback((msg) => {
    if (lastDbgRef.current === msg) return   // skip identical consecutive lines (e.g. dhikr holds)
    lastDbgRef.current = msg
    if (showDetectDebug) {
      const t = new Date().toLocaleTimeString('en-GB')
      setDebugLog(prev => [...prev.slice(-11), { t, msg }])
    }
    // Local/overlay always; D1 remote write only when Developer Options (showDetectDebug) is on.
    if (showDetectDebug) logQuran('DEBUG', '[detect]', msg)
    else logQuranLocal('DEBUG', '[detect]', msg)
  }, [showDetectDebug])

  // PLAN-022 + PLAN-024: dbgRef keeps the latest `dbg` closure reachable from inside the
  // useCallback-stable handleResult. Without this, handleResult (deps `[]`) captured
  // dbg from the FIRST render — every subsequent render created a new dbg that
  // handleResult never picked up, so `if (showDetectDebug)` and the de-dupe via
  // `lastDbgRef.current` ran against STALE flags after a Settings toggle or HMR.
  // handleResult must stay `[]` so `SherpaSTT.addListener('result', handleResult)` /
  // `AppleSTT.addListener('result', handleResult)` don't accumulate differently-id'd
  // closures on each surah re-init (see Bug #3 from the audit).
  const dbgRef = useRef(dbg)
  useEffect(() => { dbgRef.current = dbg }, [dbg])

  // Two quick medium pulses ~150ms apart — signals a new rak'ah boundary.
  const doublePulse = useCallback(() => {
    pulse()
    setTimeout(pulse, 150)
  }, [])

  // PLAN-014: single-owner Set for all QuranMode timers. Routes through
  // scheduleActiveTimer + clearAllActiveTimers so the 6 hand-rolled
  // `if (calibrationTimer.current) { clearTimeout(...); current = null }` guards
  // collapse to a one-liner and an unmount useEffect catches any orphaned timer.
  // Set is component-scoped (useRef) — when the component unmounts the unmount
  // useEffect below drains the Set. StrictMode-safe: the cleanup runs on the
  // synthetic unmount between mount-1 and mount-2 so no timer from mount-1 can
  // leak into mount-2 (this is the same mount-cycle that broke PLAN-013's
  // module-scope `_killSwitchChecked` swap — different fix, same family of bug).
  const scheduleActiveTimer = useCallback((fn, ms) => {
    const id = setTimeout(() => {
      activeTimersRef.current.delete(id)
      try { fn() } catch (e) { console.error('[quran] active timer threw:', e) }
    }, ms)
    activeTimersRef.current.add(id)
    return id
  }, [])
  const clearAllActiveTimers = useCallback(() => {
    for (const id of activeTimersRef.current) clearTimeout(id)
    activeTimersRef.current.clear()
  }, [])

  // PLAN-014: unmount safety net — drain any leftover active timers so a
  // QuranMode unmount between calibration phase and lock-on can never leak a
  // callback that mutates refs (e.g. setPhase('listening') on a torn-down
  // component) into the next mount. The 6 in-line clearAllActiveTimers() calls
  // cover the normal pause/end/clearSession paths; this useEffect cleanup
  // covers React's synthetic unmount (StrictMode + tab switch + view tear-down).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => clearAllActiveTimers(), [])

  // PLAN-024 (Bug #4): flip unmountingRef on unmount so the surah-prompt re-init
  // .then(...) can bail before adding handleResult to a torn-down component.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { unmountingRef.current = true }, [])

  const endCalibration = useCallback(() => {
    calibratingRef.current = false
    const buffer = calibrationBuffer.current
    if (buffer.length > 0) {
      // Vote: which surah appeared most during calibration?
      const counts = {}
      for (const m of buffer) counts[m.s] = (counts[m.s] || 0) + 1
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
      const winningSurah = parseInt(sorted[0][0])
      surahLockRef.current = winningSurah
      lockedSurahsRef.current.add(winningSurah)
      pendingSurahRef.current = winningSurah
      pendingSurahCount.current = sorted[0][1]
      // Seed rolling window with calibration results
      recentMatchesRef.current = buffer.slice(-VOTE_WINDOW).map(m => m.s)
      // Pick the most recent verse from the winning surah as the starting point
      const winnerVerses = buffer.filter(m => m.s === winningSurah)
      const startVerse = winnerVerses[winnerVerses.length - 1]
      setCurrent(startVerse)
      currentVerseRef.current = startVerse
      pendingMoveRef.current = null
      verseProgressRef.current = -1
      setMatchedProgress(-1)
      rakahRef.current = 1; fatihaOpenRef.current = false; firstFatihaRef.current = false
      // Add unique winning-surah verses to session as confirmed
      const seen = new Set()
      const unique = winnerVerses.filter(v => {
        const k = `${v.s}:${v.a}`
        if (seen.has(k)) return false
        seen.add(k); return true
      })
      setSessionVerses(unique.map(v => ({ ...v, rakah: 1, confirmed: true })))
      // Seed rak'ah state from the calibrated start so the first surah/Fatiha isn't mis-counted.
      firstFatihaRef.current = true
      fatihaOpenRef.current = (winningSurah === 1 && (startVerse?.a ?? 99) <= 2)
      dbgRef.current(`🔒 Locked Surah ${winningSurah} (${startVerse?.sName}) — ${sorted[0][1]} calibration hits; start ${startVerse?.s}:${startVerse?.a} · Rak'ah 1`)
    } else {
      dbgRef.current('⚠ calibration ended with no confident matches')
    }
    setPhase('listening')
  }, [dbg])

  const handleResult = useCallback(async ({ text: rawText }) => {
    const text = trimTranscript(rawText)
    dbgRef.current(`🎧 STT (${(rawText || '').split(/\s+/).filter(Boolean).length}w): "${(rawText || '').slice(0, 140)}"`)
    if (!text) return
    const vv = versesRef.current
    if (!vv) { dbgRef.current('⚠ verses not loaded yet'); return }
    const vmap = verseIndexRef.current
    const previousCurrent = currentVerseRef.current
    const locked = surahLockRef.current != null

    // ── Salah gaps: ruku / sujud / takbir are dhikr, not Quran. Ignore them and
    //    hold the current position so the tracker doesn't drift during the silence. ──
    if (isDhikrChunk(text)) { dbgRef.current('🔇 dhikr / gap — holding position'); return }

    // ── Calibration phase: collect silently with global search, don't update UI ──
    if (calibratingRef.current) {
      const m = findVerse(text, vv, wordIndexRef.current, previousCurrent, surahLockRef.current)
      if (m) { calibrationBuffer.current.push(m); dbgRef.current(`📡 calibrating — heard ${m.sName} ${m.s}:${m.a}`) }
      else {
        const g = bestVerseGuess(text, vv, wordIndexRef.current)
        dbgRef.current(g ? `… no match — closest ${g.verse.sName} ${g.verse.s}:${g.verse.a} score ${g.score.toFixed(2)} cov ${g.cov.toFixed(2)}` : '… no match — no candidates')
      }
      return
    }

    // ── Pick a candidate: TRACK mode (constrained window) once locked, else LOCK mode ──
    let match = null
    let rel = null   // relationship to current: 0 same, +n forward, -n back, null = re-lock/global
    if (locked && previousCurrent && vmap) {
      const tracked = trackVerse(text, vv, vmap, previousCurrent)
      if (tracked) { match = tracked.verse; rel = tracked.rel }
      else {
        // Lost the thread inside the window — attempt a constrained re-lock
        match = findVerse(text, vv, wordIndexRef.current, previousCurrent, surahLockRef.current)
      }
    } else {
      match = findVerse(text, vv, wordIndexRef.current, previousCurrent, surahLockRef.current)
    }
    if (!match) return

    // ── Salah: returning to Al-Fatiha from another surah — lock onto it fast ──
    // (Bypass the backward-jump hysteresis; the rak'ah counter is handled after commit.)
    const fatihaJump = match.s === 1 && previousCurrent && previousCurrent.s !== 1 && wordScore(text, match) >= 0.40
    if (fatihaJump) {
      surahLockRef.current = 1
      lockedSurahsRef.current.add(1)
      pendingMoveRef.current = null
    }

    // ── Hysteresis: decide whether to actually MOVE the pointer ──────────────
    let commit = match
    if (previousCurrent && !fatihaJump) {
      const sameVerse = match.s === previousCurrent.s && match.a === previousCurrent.a
      if (sameVerse || rel === 1 || rel === 2) {
        // Staying put or advancing forward — expected, accept freely
        pendingMoveRef.current = null
      } else {
        // Backward / far / cross-surah — require repeated, decisive evidence
        const mKey = `${match.s}:${match.a}`
        if (pendingMoveRef.current && pendingMoveRef.current.key === mKey) pendingMoveRef.current.count++
        else pendingMoveRef.current = { key: mKey, count: 1 }
        const decisive = wordScore(text, match) >= wordScore(text, previousCurrent) + MOVE_MARGIN
        if (pendingMoveRef.current.count >= MOVE_CONFIRM && decisive) {
          pendingMoveRef.current = null    // confirmed jump
          dbgRef.current(`↪ confirmed jump → ${match.sName} ${match.s}:${match.a}`)
        } else {
          commit = previousCurrent          // ignore the blip, stay locked on current
          dbgRef.current(`⏸ blip → ${match.sName} ${match.s}:${match.a} ignored (${pendingMoveRef.current.count}/${MOVE_CONFIRM}); holding ${previousCurrent.s}:${previousCurrent.a}`)
        }
      }
    }

    const key = `${commit.s}:${commit.a}`
    const movedToNew = !previousCurrent || commit.s !== previousCurrent.s || commit.a !== previousCurrent.a
    dbgRef.current(`${movedToNew ? '▶' : '🔎'} ${commit.sName} ${commit.s}:${commit.a} · score ${wordScore(text, commit).toFixed(2)}`)

    // ── Positional highlight: progress within the committed verse ────────────
    if (movedToNew) verseProgressRef.current = -1
    verseProgressRef.current = computeProgress(commit, text, verseProgressRef.current)
    setMatchedProgress(verseProgressRef.current)

    setCurrent(commit)
    currentVerseRef.current = commit

    // ── Rak'ah counter ───────────────────────────────────────────────────────
    // A fresh opening of Al-Fatiha (ayah 1–2) starts a new rak'ah. We re-arm only once
    // recitation clearly moves past the opening (Fatiha ayah ≥4, or a different surah),
    // so it's robust even when the in-between surah is missed, and minor 1:2↔1:3 jitter
    // doesn't double-count.
    const isFatihaOpening = commit.s === 1 && commit.a <= 2
    const leftFatihaOpening = commit.s !== 1 || commit.a >= 4
    if (isFatihaOpening && !fatihaOpenRef.current) {
      fatihaOpenRef.current = true
      if (!firstFatihaRef.current) {
        firstFatihaRef.current = true
        dbgRef.current('🆕 Rak\'ah 1 — Al-Fatiha')
      } else {
        rakahRef.current += 1
        dbgRef.current(`🆕 Rak'ah ${rakahRef.current} — new Al-Fatiha detected`)
      }
      doublePulse()
    } else if (leftFatihaOpening) {
      fatihaOpenRef.current = false
      firstFatihaRef.current = true   // past the opening → rak'ah 1 is established
    }

    // ── Rolling vote window on the COMMITTED surah ───────────────────────────
    recentMatchesRef.current.push(commit.s)
    if (recentMatchesRef.current.length > VOTE_WINDOW) recentMatchesRef.current.shift()

    const voteCounts = {}
    for (const s of recentMatchesRef.current) voteCounts[s] = (voteCounts[s] || 0) + 1
    const voteWinner = Object.entries(voteCounts).sort((a, b) => b[1] - a[1])[0]
    if (voteWinner && parseInt(voteWinner[1]) >= VOTE_THRESHOLD) {
      const votedSurah = parseInt(voteWinner[0])
      if (!lockedSurahsRef.current.has(votedSurah) || surahLockRef.current !== votedSurah) {
        surahLockRef.current = votedSurah
        lockedSurahsRef.current.add(votedSurah)
        dbgRef.current(`🔒 surah lock → ${votedSurah} (${vv.find(v => v.s === votedSurah)?.sName || '?'})`)
      }
    }

    if (commit.s === pendingSurahRef.current) pendingSurahCount.current++
    else { pendingSurahRef.current = commit.s; pendingSurahCount.current = 1 }
    const rakah = rakahRef.current
    setSessionVerses(prev => {
      const exists = prev.find(v => `${v.s}:${v.a}` === key && v.rakah === rakah)
      if (exists) {
        if (lockedSurahsRef.current.has(commit.s) && !exists.confirmed) {
          return prev.map(v => (v.s === commit.s && v.rakah === rakah) ? { ...v, confirmed: true } : v)
        }
        return prev
      }
      const newVerse = { ...commit, rakah, confirmed: lockedSurahsRef.current.has(commit.s) }
      const newArr = [...prev, newVerse]
      if (lockedSurahsRef.current.has(commit.s)) {
        return newArr.map(v => (v.s === commit.s && v.rakah === rakah) ? { ...v, confirmed: true } : v)
      }
      return newArr
    })

    // Only re-initialise on-device Whisper with a surah prompt when the surah genuinely changes
    if (IS_NATIVE && !scribeRef.current && lockedSurahsRef.current.has(commit.s) && currentSurahRef.current !== commit.s) {
      currentSurahRef.current = commit.s
      const surahVerses = vv.filter(v => v.s === commit.s).slice(0, 5)
      if (surahVerses.length > 0) {
        const prompt = surahVerses.map(v => v.ar).join(' ')
        // PLAN-022: defensive listener reset BEFORE re-initializing on a surah change.
        // The plugin's `stopListening()` stops audio capture but CAN leave handlers
        // attached — without an explicit `removeAllListeners()` the next
        // `initialize()` + `addListener('result', handleResult)` would pile the same
        // callback on top of any existing handler. We already clear listeners in
        // the outer `start()*()` paths; this inner-path version is belt-and-suspenders
        // for the surah-prompt re-init flow (Bug #3 in the audit).
        try {
          await SherpaSTT.stopListening()
          await SherpaSTT.removeAllListeners?.()
        } catch {}
        SherpaSTT.initialize({ quranMode: true, initialPrompt: prompt, performanceMode }).then(() => {
          // PLAN-024 (Bug #4): bail if the component already unmounted while
          // `initialize` was awaiting. Without this, addListener() re-attaches
          // handleResult to a torn-down component and a future STT result updates
          // state on an unmounted node (React warning + memory leak).
          if (unmountingRef.current) return
          SherpaSTT.addListener('result', handleResult)
          SherpaSTT.addListener('error', ({ message }) => { setSttError(message) })
          SherpaSTT.startListening().catch(() => {})
        }).catch(() => {})
      }
    }
  }, [])

  const stopScribeDetect = async () => {
    if (scribeRef.current) {
      await scribeRef.current.disconnect()
      scribeRef.current = null
    }
  }

  // Tear down both on-device engines. Apple is the real iOS path; Sherpa is the
  // Android offline engine (stub on iOS). Callers used to only stop Sherpa, so a
  // Detect session on Apple left the native recognizer streaming after pause/end.
  const stopNativeDetect = async () => {
    try { await AppleSTT.stopListening() } catch {}
    try { await AppleSTT.removeAllListeners() } catch {}
    try { await SherpaSTT.stopListening() } catch {}
    try { await SherpaSTT.removeAllListeners() } catch {}
  }

  // ── Haiku RESCUE ─────────────────────────────────────────────────────────────
  // The anchor tracker handles the normal case. When it's lost — never locked after a grace
  // period, or drifted (LOST_MAX committed misses) — we ask Haiku ONLY "which surah?" from the
  // recent transcript, then snap to the exact position locally via tracker.lockToSurah(). We
  // never trust Haiku's exact ayah; the anchor index pins it. Rate-limited + single-flight.
  const escalateToHaiku = useCallback(async (reason) => {
    const tracker = trackerRef.current
    if (!tracker || escalatingRef.current) return
    const now = Date.now()
    if (now - lastEscalateRef.current < ESCALATE_MIN_MS) return
    const buf = (escalationBufRef.current || '').trim()
    if (buf.split(/\s+/).filter(Boolean).length < 6) return   // too little to identify
    escalatingRef.current = true
    lastEscalateRef.current = now
    dbgRef.current(`🤖 rescue → Haiku (${reason})…`)
    try {
      const res = await apiFetch(API_BASE + '/api/identify', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: buf }),
      }, { timeoutMs: 12000, retries: 1 })
      const j = await res.json().catch(() => ({}))
      if (!j || !j.surah || (j.confidence ?? 0) < RESCUE_MIN_CONF) {
        dbgRef.current(`🤖 rescue: no confident id (surah ${j?.surah || 0}, conf ${j?.confidence ?? 0})`)
        return
      }
      const r = tracker.lockToSurah(buf, j.surah, j.ayah || 1)
      if (!r) { dbgRef.current(`🤖 rescue: surah ${j.surah} out of range`); return }
      // Guard against hallucination: if NO transcript anchor landed inside Haiku's surah
      // (r.conf === 0, pure seed), only trust it when Haiku is very confident. Otherwise the
      // transcript doesn't actually belong to that surah — ignore and keep listening.
      if (r.conf === 0 && (j.confidence || 0) < 0.7) {
        dbgRef.current(`🤖 rescue: surah ${j.surah} has no matching anchor & conf ${j.confidence} — ignoring`)
        return
      }
      // Adopt the rescue lock.
      trackerLockedRef.current = true
      pulse()
      calibratingRef.current = false
      clearAllActiveTimers()
      lostCountRef.current = 0
      setPhase('listening')
      const verse = versesRef.current?.[r.verseIndex]
      if (verse) {
        setCurrent(verse); currentVerseRef.current = verse; setMatchedProgress(r.wordIdx); setProvisionalProgress(r.wordIdx)
        surahLockRef.current = verse.s; lockedSurahsRef.current.add(verse.s); setRakahDisplay(rakahRef.current)
        dbgRef.current(`🔒 rescue lock → ${verse.sName} ${verse.s}:${verse.a} (Haiku ${Math.round((j.confidence || 0) * 100)}%, ${r.conf ? 'snapped chain ' + r.conf : 'seeded'})`)
      }
    } catch (e) {
      dbgRef.current('🤖 rescue failed: ' + (e?.message || e))
    } finally {
      escalatingRef.current = false
    }
  }, [dbg])

  // ── Cloud (ElevenLabs) result handler — anchor-based tracker ─────────────────
  // Clean transcripts: locate the phrase in the linear Quran by trigram anchors and
  // advance a cursor. No calibration vote, no hysteresis — trust the input. Committed
  // transcripts drive the session + rak'ah counter; partials only move the highlight.
  const handleTrackerResult = useCallback((rawText, partial) => {
    const tracker = trackerRef.current
    const wc = (rawText || '').split(/\s+/).filter(Boolean).length
    dbgRef.current(`🎧 STT${partial ? '~' : ''} (${wc}w): "${(rawText || '').slice(0, 120)}"`)
    if (!tracker) { dbgRef.current('⚠ tracker not ready'); return }
    if (isDhikrChunk(rawText)) { dbgRef.current('🔇 gap — holding position'); return }

    // Feed a ROLLING window of recent transcript that spans ayah boundaries, so short ayat
    // (2-3 words, e.g. Ar-Rahman / Al-Fatiha) stay trackable — a single short committed ayah
    // can't form a trigram on its own. Committed segments accumulate (capped); partials append
    // live on top of that context. The tracker aligns the tail of this near the cursor.
    const capWords = (s, n) => { const w = (s || '').split(/\s+/).filter(Boolean); return w.length > n ? w.slice(-n).join(' ') : w.join(' ') }
    let feed
    if (partial) {
      feed = (committedTextRef.current + ' ' + (rawText || '')).trim()
    } else {
      committedTextRef.current = capWords((committedTextRef.current + ' ' + (rawText || '')).trim(), 40)
      feed = committedTextRef.current
    }
    escalationBufRef.current = feed.slice(-240)   // rescue payload for Haiku

    const r = tracker.advance(feed)   // auto-locks when unlocked; aligns the recent tail
    // On a surah jump, drop the stale previous-surah context so it can't drag the cursor back.
    if (r && r.jumped) committedTextRef.current = partial ? '' : capWords(rawText || '', 40)
    if (!r) {
      // No anchor this chunk. Cold → escalate to Haiku after a grace period; locked-but-lost →
      // escalate after LOST_MAX committed misses in a row. Partials never count as "lost".
      if (!trackerLockedRef.current) {
        dbgRef.current('… listening for a clear phrase to lock')
        if (Date.now() - detectStartRef.current > COLD_ESCALATE_MS) escalateToHaiku('cold')
      } else if (!partial) {
        lostCountRef.current += 1
        if (lostCountRef.current >= LOST_MAX) escalateToHaiku('lost')
      }
      return
    }
    lostCountRef.current = 0   // found anchors again

    if (!trackerLockedRef.current) {
      trackerLockedRef.current = true
      calibratingRef.current = false
      clearAllActiveTimers()
      setPhase('listening')
      pulse()
      dbgRef.current(`🔒 locked (anchor chain ${r.conf})`)
    }

    const verse = versesRef.current?.[r.verseIndex]
    if (!verse) return
    const previous = currentVerseRef.current
    const moved = !previous || previous.s !== verse.s || previous.a !== verse.a

    setCurrent(verse)
    currentVerseRef.current = verse
    // Two-tone highlight: partials paint the "pending" shade (heard, not confirmed); committed
    // transcripts lock those words to solid green. On a verse change, clear the confirmed mark.
    if (partial) {
      if (moved) setMatchedProgress(-1)
      setProvisionalProgress(r.wordIdx)
    } else {
      setMatchedProgress(r.wordIdx)
      setProvisionalProgress(r.wordIdx)
    }
    if (moved) dbgRef.current(`${r.jumped ? '↪ jump' : '▶'} ${verse.sName} ${verse.s}:${verse.a} · w${r.wordIdx}`)

    // Committed transcripts are trustworthy → record the verse + advance the rak'ah counter.
    // Partials only move the live highlight (no session writes).
    if (!partial) {
      lockedSurahsRef.current.add(verse.s)   // so analyzeVerses() will include it
      surahLockRef.current = verse.s

      // Rak'ah counter: each rak'ah in Salah opens with Al-Fatiha. Count every ENTRY into
      // Al-Fatiha from a different surah. This is robust to the opening ayah being skipped —
      // the cross-surah jump often lands mid-Fatiha (e.g. 1:3), so keying off ayah 1–2 (as the
      // old logic did) missed every rak'ah boundary. Entering surah 1 while the last confirmed
      // surah was NOT 1 is the reliable signal.
      if (verse.s === 1 && lastCountedSurahRef.current !== 1) {
        if (firstFatihaRef.current) { rakahRef.current += 1; dbgRef.current(`🆕 Rak'ah ${rakahRef.current} — Al-Fatiha`) }
        else { firstFatihaRef.current = true; dbgRef.current("🆕 Rak'ah 1 — Al-Fatiha") }
        doublePulse()
      }
      lastCountedSurahRef.current = verse.s

      const rakah = rakahRef.current
      setRakahDisplay(rakah)   // live badge on the current verse card
      const key = `${verse.s}:${verse.a}`
      setSessionVerses(sv => sv.find(v => `${v.s}:${v.a}` === key && v.rakah === rakah)
        ? sv : [...sv, { ...verse, rakah, confirmed: true }])
    }
  }, [dbg, escalateToHaiku])

  const beginCalibration = () => {
    calibratingRef.current = true
    setPhase('calibrating')
    dbgRef.current('🎙️ Listening — calibrating (~12s) to identify the opening surah')
    calibrationTimer.current = scheduleActiveTimer(endCalibration, CALIBRATION_MS)
  }

  // Cloud path: brief UI window; the tracker ends it the instant it locks. This only
  // stops the "Identifying Surah" screen from hanging if no clear phrase arrives fast.
  const beginTrackerCalibration = () => {
    calibratingRef.current = true
    trackerLockedRef.current = false
    detectStartRef.current = Date.now()
    escalatingRef.current = false; lostCountRef.current = 0
    escalationBufRef.current = ''; lastEscalateRef.current = 0
    committedTextRef.current = ''
    setPhase('calibrating')
    dbgRef.current('🎙️ Listening — identifying surah…')
    calibrationTimer.current = scheduleActiveTimer(() => {
      calibratingRef.current = false
      if (!trackerLockedRef.current) { setPhase('listening'); dbgRef.current('… listening (recite a few words to lock on)') }
    }, TRACKER_CALIBRATION_MS)
  }

  const startSherpaDetect = async () => {
    dbgRef.current('📴 Local engine — initializing recognizer…')
    try { await SherpaSTT.stopListening() } catch {}
    try { await SherpaSTT.removeAllListeners() } catch {}
    try { await SherpaSTT.setSttMode({ mode: 'off' }) } catch {}
    try {
      await SherpaSTT.initialize({ quranMode: true, performanceMode })
    } catch (e) {
      dbgRef.current('❌ local init failed: ' + (e?.message || e))
      setSttError('Speech engine failed: ' + (e?.message || e))
      return false
    }
    setSttError(null)
    await SherpaSTT.addListener('result', handleResult)
    await SherpaSTT.addListener('error', ({ message }) => { dbgRef.current('❌ local STT error: ' + message); setSttError(message) })
    try {
      await SherpaSTT.startListening()
    } catch (e) {
      dbgRef.current('❌ startListening failed: ' + (e?.message || e))
      setSttError('Could not start microphone: ' + (e?.message || e))
      return false
    }
    dbgRef.current('🎤 Local mic listening (native)')
    return true
  }

  // iOS Apple Native STT path. Returns 'apple' | 'scribe' | false.
  // `isFallback`: true when we already failed ElevenLabs — do not bounce back to Scribe
  // (prevents Apple ↔ Scribe ping-pong when the SpeechRecognition bridge is missing).
  const startAppleDetect = async (isFallback = false) => {
    dbgRef.current('🍎 Apple Native engine — initializing…')
    try { await AppleSTT.stopListening() } catch {}
    try { await AppleSTT.removeAllListeners() } catch {}
    try {
      await AppleSTT.initialize({ performanceMode })
    } catch (e) {
      dbgRef.current('⚠️ Apple init warning: ' + (e?.message || e))
      // Probe happens in startListening; keep going so AAPLESTT_UNAVAILABLE can trigger fallback.
    }
    setSttError(null)
    await AppleSTT.addListener('result', handleResult)
    await AppleSTT.addListener('error', ({ message }) => { dbgRef.current('❌ Apple STT error: ' + message); setSttError(message) })
    try {
      await AppleSTT.startListening({ language: 'ar-SA' })
    } catch (e) {
      const msg = (e?.message || String(e)).toLowerCase()
      try { await AppleSTT.stopListening() } catch {}
      try { await AppleSTT.removeAllListeners() } catch {}
      // Bridge/plugin missing on device (dual-target SPM) — same as Khutbah path in App.jsx.
      if (!isFallback && (msg.toLowerCase().includes('applestt_') || msg.toLowerCase().includes('aaplestt_'))) {
        dbgRef.current('⚠️ Apple STT unavailable → ElevenLabs fallback')
        logQuran('WARN', 'AppleSTT unavailable in Detect, falling back to ElevenLabs Scribe', e)
        showToast('Apple Native speech not available — using ElevenLabs cloud STT', 'warn', 4500)
        return await startScribeDetect(true /* isFallback: no ping-pong */)
      }
      dbgRef.current('❌ Apple startListening failed: ' + (e?.message || e))
      setSttError('Could not start microphone: ' + (e?.message || e))
      return false
    }
    dbgRef.current('🎤 Apple mic listening (native)')
    return 'apple'
  }

  // Returns 'scribe' (tracker path) on success, 'apple'/'local' if it fell back, or false.
  // `isFallback`: true when Apple already failed — skip bouncing back to Apple.
  const startScribeDetect = async (isFallback = false) => {
    dbgRef.current('☁️ ElevenLabs engine — connecting…')
    try {
      // Build the anchor tracker once from the loaded corpus, then reset for this session.
      if (!trackerRef.current && versesRef.current) {
        const t0 = performance.now()
        trackerRef.current = primeTracker(versesRef.current)
        dbgRef.current(`🧭 tracker index built in ${Math.round(performance.now() - t0)}ms`)
      }
      trackerRef.current?.reset()
      trackerLockedRef.current = false

      const session = new ScribeSession()
      scribeRef.current = session
      await session.connect({
        languageCode: 'ar',
        keyterms: [],
        filterResults: false,
        // Force a commit every ~1.5s even during fluent recitation. Without this, Scribe only
        // commits at VAD pauses (end of ayah / breath), so the CONFIRMED (green) highlight sits
        // far behind the live (amber) one on long ayat. Periodic commits keep green close.
        commitWatchdogMs: 1500,
        onPartial: (text) => handleTrackerResult(text, true),
        onCommitted: (text) => handleTrackerResult(text, false),
        onStatus: (s) => dbgRef.current('☁️ ' + s),
        onError: (err) => { dbgRef.current('❌ scribe error: ' + (err?.message || err)); setSttError(err?.message || String(err)) },
      })
      await session.startMicrophone()
      setSttError(null)
      return 'scribe'
    } catch (e) {
      await stopScribeDetect()
      dbgRef.current('❌ scribe failed → on-device fallback: ' + (e?.message || e))
      logQuran('WARN', 'Scribe detect failed, falling back to on-device', e)
      // Don't bounce back to Apple if we're already the Apple → Scribe fallback.
      if (isFallback) {
        setSttError('Both Apple Native and ElevenLabs speech failed. Check Settings / .env.local token.')
        return false
      }
      showToast('Cloud speech unavailable — using on-device detection', 'warn', 4500)
      // iOS: Sherpa is a stub that always throws — try Apple first.
      if (IS_IOS) {
        const appleMode = await startAppleDetect(true /* isFallback: no Scribe ping-pong */)
        return appleMode === 'apple' ? 'apple' : false
      }
      return (await startSherpaDetect()) ? 'local' : false
    }
  }

  // Keep the screen awake WHILE detecting so the user can read the live translation out of
  // Salah. It does NOT stop a manual power-off: the OS still turns the screen off on the power
  // button, and detection keeps running via the foreground mic service — we just re-acquire the
  // lock when the screen comes back on (see the visibilitychange effect).
  const acquireWakeLock = async () => {
    if (document.visibilityState !== 'visible') return
    // iOS WKWebView has no reliable navigator.wakeLock — use the native
    // KeepAwake plugin there; shim .release() so all release sites work as-is.
    if (IS_NATIVE) {
      try {
        await KeepAwake.keepAwake()
        wakeLockRef.current = {
          release: async () => { try { await KeepAwake.allowSleep() } catch {} },
          addEventListener: () => {},
        }
      } catch {}
      return
    }
    if (!('wakeLock' in navigator)) return
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen')
      wakeLockRef.current.addEventListener('release', () => { wakeLockRef.current = null })
    } catch {}
  }

  const start = async () => {
    window.dispatchEvent(new CustomEvent('app-pause-khutbah-stt'))
    await stopScribeDetect()
    await stopNativeDetect()
    currentSurahRef.current = null; surahLockRef.current = null
    pendingSurahRef.current = null; pendingSurahCount.current = 0
    recentMatchesRef.current = []; calibrationBuffer.current = []
    pendingMoveRef.current = null; verseProgressRef.current = -1; setMatchedProgress(-1); setProvisionalProgress(-1)
    rakahRef.current = 1; fatihaOpenRef.current = false; firstFatihaRef.current = false; lastCountedSurahRef.current = null; setRakahDisplay(1)
    trackerRef.current?.reset(); trackerLockedRef.current = false
    setDebugLog([]); lastDbgRef.current = ''
    clearAllActiveTimers()
    const engineLabel = sttMode === 'elevenlabs' ? 'ElevenLabs (cloud)'
      : sttMode === 'apple' ? 'Apple (native)'
      : 'Local (on-device)'
    dbgRef.current(`▶ Detect start — engine: ${engineLabel}`)
    // iOS: 'apple' must not fall through to Sherpa (stub always fails). Default
    // cloud path is ElevenLabs; Apple is the optional on-device choice with Scribe fallback.
    let mode = false
    if (sttMode === 'elevenlabs') mode = await startScribeDetect()
    else if (sttMode === 'apple') mode = await startAppleDetect()
    else mode = (await startSherpaDetect()) ? 'local' : false
    if (!mode) { dbgRef.current('⛔ engine failed to start'); return }
    acquireWakeLock()                                  // keep the screen awake while detecting
    if (mode === 'scribe') beginTrackerCalibration()   // cloud tracker — locks fast
    else beginCalibration()                            // local/Apple — 12s vote
  }

  const pause = async () => {
    if (scribeRef.current) await stopScribeDetect()
    else await stopNativeDetect()
    setSttError(null)
    try { await wakeLockRef.current?.release() } catch {}
    wakeLockRef.current = null; setPhase('paused')
    currentSurahRef.current = null; surahLockRef.current = null
    pendingSurahRef.current = null; pendingSurahCount.current = 0
    calibratingRef.current = false; calibrationBuffer.current = []; recentMatchesRef.current = []
    pendingMoveRef.current = null; verseProgressRef.current = -1; setMatchedProgress(-1); setProvisionalProgress(-1)
    rakahRef.current = 1; fatihaOpenRef.current = false; firstFatihaRef.current = false; lastCountedSurahRef.current = null; setRakahDisplay(1)
    clearAllActiveTimers()
  }

  const end = async () => {
    if (phase === 'listening' || phase === 'calibrating') {
      if (scribeRef.current) await stopScribeDetect()
      else await stopNativeDetect()
    }
    setSttError(null)
    try { await wakeLockRef.current?.release() } catch {}
    wakeLockRef.current = null; setPhase('idle')
    currentSurahRef.current = null; surahLockRef.current = null
    pendingSurahRef.current = null; pendingSurahCount.current = 0
    calibratingRef.current = false; calibrationBuffer.current = []; recentMatchesRef.current = []
    pendingMoveRef.current = null; verseProgressRef.current = -1; setMatchedProgress(-1); setProvisionalProgress(-1)
    rakahRef.current = 1; fatihaOpenRef.current = false; firstFatihaRef.current = false; lastCountedSurahRef.current = null; setRakahDisplay(1)
    clearAllActiveTimers()
  }

  // Re-acquire the screen wake lock when the app returns to the foreground while still detecting
  // (a manual power-off / app-switch releases it). Detection itself never stops here.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && (phase === 'listening' || phase === 'calibrating') && !wakeLockRef.current) acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [phase])

  // One-click Detect: auto-start listening the moment the Detect view opens (fresh, ready, and
  // set up) so the user doesn't have to tap the mic too. Re-arms only on a fresh entry.
  //
  // PLAN-024.1 (Bug #15): the original audit flagged this as "never reset across views"
  // — actually NOT a bug. The useEffect below resets `autoStartedRef.current = false`
  // whenever `quranView !== 'detect'`, so leaving Detect and re-entering clears the
  // guard. The code-reviewer APPROVED this as-is. The only latent edge case is
  // "Detect → in-listening → leave view → re-enter Detect WITH empty sessionVerses" —
  // covered by the early-return on `phase !== 'idle'` (it wasn't returned idle) so
  // autoStart correctly skips. No-op for the bug-fix diff.
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (quranView !== 'detect') { autoStartedRef.current = false; return }
    if (autoStartedRef.current || phase !== 'idle') return
    if (dataState !== 'ready' || !noticeAccepted || sessionVerses.length > 0) return
    // Local Sherpa needs its model; ElevenLabs + Apple do not.
    if (sttMode !== 'elevenlabs' && sttMode !== 'apple' && !baseModelReady) return
    autoStartedRef.current = true
    start()
  }, [quranView, phase, dataState, noticeAccepted, sttMode, baseModelReady, sessionVerses.length])

  const clearSession = () => {
    setCurrent(null); setSessionVerses([]); setAnalyze({ open: false, loading: false, result: null, error: null })
    surahLockRef.current = null; lockedSurahsRef.current.clear()
    pendingSurahRef.current = null; pendingSurahCount.current = 0
    calibratingRef.current = false; calibrationBuffer.current = []; recentMatchesRef.current = []
    pendingMoveRef.current = null; verseProgressRef.current = -1; setMatchedProgress(-1); setProvisionalProgress(-1)
    rakahRef.current = 1; fatihaOpenRef.current = false; firstFatihaRef.current = false; lastCountedSurahRef.current = null; setRakahDisplay(1)
    setDebugLog([]); lastDbgRef.current = ''
    clearAllActiveTimers()
    try { localStorage.removeItem(SESSION_KEY) } catch {}
  }

  const jumpToSurah = useCallback((num) => {
    const el = surahHeaderRefs.current[num]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Manually re-anchor tracking onto a chosen verse (fixes a mis-lock).
  const reanchor = useCallback((verse) => {
    if (!verse) return
    dbgRef.current(`📍 manually re-anchored → ${verse.sName} ${verse.s}:${verse.a}`)
    setCurrent(verse)
    currentVerseRef.current = verse
    surahLockRef.current = verse.s
    lockedSurahsRef.current.add(verse.s)
    pendingSurahRef.current = verse.s
    pendingSurahCount.current = CONFIRM_THRESHOLD
    recentMatchesRef.current = Array(Math.max(1, VOTE_WINDOW)).fill(verse.s)
    pendingMoveRef.current = null
    verseProgressRef.current = -1
    setMatchedProgress(-1)
    const rakah = rakahRef.current
    setSessionVerses(prev => {
      const key = `${verse.s}:${verse.a}`
      if (prev.find(v => `${v.s}:${v.a}` === key && v.rakah === rakah)) {
        return prev.map(v => (v.s === verse.s && v.rakah === rakah) ? { ...v, confirmed: true } : v)
      }
      return [...prev, { ...verse, rakah, confirmed: true }]
    })
  }, [VOTE_WINDOW])

  // Nudge the anchor to the adjacent ayah (flat index handles surah boundaries).
  const stepVerse = useCallback((dir) => {
    const vv = versesRef.current
    const cur = currentVerseRef.current
    if (!vv || !cur || !verseIndexRef.current) return
    const idx = verseIndexRef.current.get(`${cur.s}:${cur.a}`)
    if (idx == null) return
    const target = vv[idx + dir]
    if (target) reanchor(target)
  }, [reanchor])

  const handleBrowseScroll = useCallback(() => {
    const container = browseScrollRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    // Sample a point ~90px below top of container (past the sticky surah header)
    const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 90)
    const verseEl = el?.closest('[data-verse]')
    if (verseEl) {
      const [s, a] = verseEl.dataset.verse.split(':').map(Number)
      setBrowsePos(prev => (prev.surahNum === s && prev.ayahNum === a) ? prev : { surahNum: s, ayahNum: a })
    }
  }, [])

  const addBookmark = useCallback((verse) => {
    const id = `bm-custom-${verse.s}-${verse.a}-${Date.now()}`
    setBookmarks(prev => [...prev, {
      id, label: `${verse.sName} ${verse.s}:${verse.a}`,
      surahNum: verse.s, surahName: verse.sName, ayahNum: verse.a, isDefault: false
    }])
  }, [])

  const removeBookmark = useCallback((id) => {
    setBookmarks(prev => prev.filter(b => b.id !== id))
  }, [])

  const navigateToBookmark = useCallback((bm) => {
    setShowBookmarks(false)
    setTimeout(() => {
      const el = browseScrollRef.current?.querySelector(`[data-verse="${bm.surahNum}:${bm.ayahNum}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      else {
        const header = surahHeaderRefs.current[bm.surahNum]
        if (header) header.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 60)
  }, [])

  // Persist the reading position so Browse resumes where the user left off.
  useEffect(() => {
    if (browsePos.surahNum) {
      try { localStorage.setItem(BROWSE_POS_KEY, JSON.stringify(browsePos)) } catch {}
    }
  }, [browsePos])

  // ── Goals ──────────────────────────────────────────────────────────────────
  // Goals are ordered SECTIONS (src/data/goals.js). The focused reader records ayat
  // as they scroll past — so partial reads (e.g. Surah al-Kahf in chunks through the
  // day) RESUME where you left off — and AUTO-completes when the reader reaches the
  // end of the required sections. Optional sections (Surah al-Mulk in the nightly
  // goal) sit after the finish point and never block completion. Arabic-only.

  // Open a goal in the focused reader, resuming at the first unread required ayah.
  const startGoal = useCallback((goal) => {
    const vv = versesRef.current
    if (!vv) return
    const byKey = new Map(vv.map(v => [`${v.s}:${v.a}`, v]))
    const sections = goal.sections.map(sec => {
      const keys = resolveSectionKeys(sec)
      return { ...sec, keys, verses: keys.map(k => byKey.get(k)).filter(Boolean) }
    })
    const flatKeys = sections.flatMap(s => s.keys)
    const requiredKeys = requiredKeysOf(goal)
    const requiredEndIdx = flatKeys.indexOf(requiredKeys[requiredKeys.length - 1])
    const rs = getReadSetToday()
    const prog = goalProgressIn(goal, rs)
    const resumeKey = requiredKeys.find(k => !rs.has(k)) || null
    const resumeIdx = resumeKey ? flatKeys.indexOf(resumeKey) : -1

    goalIdxRef.current = {
      flatKeys, requiredEndIdx,
      // Start recording from the resume point; the auto-scroll jump itself records nothing.
      lastIdx: resumeIdx > 0 ? resumeIdx - 1 : -1,
      completed: prog.pct === 100,
    }
    setGoalReader({ goal, sections, requiredTotal: prog.total })
    setGoalReqDone(prog.done)
    setGoalCompleted(prog.pct === 100)
    setQuranView('goalread')
    if (resumeIdx > 0) {
      setTimeout(() => {
        goalScrollRef.current?.querySelector(`[data-verse="${resumeKey}"]`)?.scrollIntoView({ block: 'center' })
      }, 120)
    }
  }, [])

  // Record scrolled-past ayat; auto-complete at the end of the required sections.
  const handleGoalScroll = useCallback(() => {
    const el = goalScrollRef.current
    const info = goalIdxRef.current
    if (!el || !goalReader || !info) return

    const rect = el.getBoundingClientRect()
    const probe = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(140, rect.height * 0.4))
    const verseEl = probe && probe.closest ? probe.closest('[data-verse]') : null
    let idx = verseEl ? info.flatKeys.indexOf(verseEl.dataset.verse) : -1
    // At the physical bottom, count everything (fast flings can outrun the sampling).
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) idx = info.flatKeys.length - 1
    if (idx < 0 || idx <= info.lastIdx) return

    const newKeys = info.flatKeys.slice(info.lastIdx + 1, idx + 1)
    info.lastIdx = idx
    recordVerses(newKeys, streakGoal)
    const rs = getReadSetToday()
    setReadSet(rs)
    const prog = goalProgressIn(goalReader.goal, rs)
    setGoalReqDone(prog.done)

    if (!info.completed && (prog.pct === 100 || idx >= info.requiredEndIdx)) {
      info.completed = true
      // Fast scrolls can skip sampled rows — make sure every required ayah is recorded.
      recordVerses(requiredKeysOf(goalReader.goal), streakGoal)
      setReadSet(getReadSetToday())
      setStreakInfo(getProgress(streakGoal))
      setGoalReqDone(prog.total)
      setGoalCompleted(true)
      showToast(`✓ ${goalReader.goal.label} complete`, 'success', 3000)
    }
  }, [goalReader, streakGoal])

  // Safety net: a goal short enough to fit without scrolling completes on open.
  useEffect(() => {
    if (quranView !== 'goalread' || !goalReader) return
    const el = goalScrollRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      if (el.scrollHeight <= el.clientHeight + 4) handleGoalScroll()
    })
    return () => cancelAnimationFrame(id)
  }, [quranView, goalReader, handleGoalScroll])

  // ── Mushaf resume ───────────────────────────────────────────────────────────
  // Track the ayah under the top of the Mushaf viewport and persist it, so the
  // Arabic-only reader resumes where you left off (independent of the translation view).
  const handleMushafScroll = useCallback(() => {
    const el = mushafScrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const probe = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 100)
    const ayahEl = probe && probe.closest ? probe.closest('[data-verse]') : null
    if (!ayahEl) return
    const key = ayahEl.dataset.verse
    if (key && key !== mushafPosRef.current) {
      mushafPosRef.current = key
      try { localStorage.setItem(MUSHAF_POS_KEY, key) } catch {}
    }
  }, [])

  // Restore the saved Mushaf position when the view opens.
  useEffect(() => {
    if (quranView !== 'mushaf' || dataState !== 'ready') return
    let saved = null
    try { saved = localStorage.getItem(MUSHAF_POS_KEY) } catch {}
    if (!saved) return
    let tries = 0
    const go = () => {
      const el = mushafScrollRef.current?.querySelector(`[data-verse="${saved}"]`)
      if (el) { el.scrollIntoView({ block: 'center' }); return }
      if (tries++ < 25) setTimeout(go, 100)
    }
    const t = setTimeout(go, 80)
    return () => clearTimeout(t)
  }, [quranView, dataState])

  // Exit the reader (recording already happened while scrolling).
  const finishGoal = useCallback(() => {
    setGoalReader(null)
    setQuranView('goals')
  }, [])

  // Keep goal completion + the menu streak strip fresh when returning to those views.
  useEffect(() => {
    if (quranView === 'goals' || quranView === 'menu') {
      setReadSet(getReadSetToday())
      setStreakInfo(getProgress(streakGoal))
    }
  }, [quranView, streakGoal])

  // On the Detect view, verify the app is exempt from battery optimisation — without
  // it Samsung/One UI kills the listening service when the screen is off during Salah.
  const checkBatteryExempt = useCallback(() => {
    if (!IS_NATIVE || !SherpaSTT.isIgnoringBatteryOptimizations) return
    SherpaSTT.isIgnoringBatteryOptimizations()
      .then(r => setBatteryExempt(r?.ignoring !== false))
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (quranView !== 'detect') return
    checkBatteryExempt()
    // Re-check when the user comes back (e.g. from the system settings dialog).
    const onVis = () => { if (document.visibilityState === 'visible') checkBatteryExempt() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [quranView, checkBatteryExempt])

  const requestBatteryExempt = useCallback(async () => {
    try { await SherpaSTT.requestIgnoreBatteryOptimizations?.() } catch {}
    setTimeout(checkBatteryExempt, 800)
  }, [checkBatteryExempt])

  // Keep the banner's target in sync if the user changes the goal in Settings.
  useEffect(() => { setStreakInfo(getProgress(streakGoal)) }, [streakGoal])

  // Count verses read in Browse toward today's streak goal — only when the user
  // has explicitly tapped ▶ Read (streakActive). Small forward scrolls fill the
  // gap; large jumps (Jump-to-Surah) only count the landing verse.
  useEffect(() => {
    if (quranView !== 'read' || !streakActive || !browsePos.surahNum || !verseIndexRef.current) return
    const key = `${browsePos.surahNum}:${browsePos.ayahNum}`
    const idx = verseIndexRef.current.get(key)
    if (idx == null) return
    const keys = []
    const prev = lastReadIdxRef.current
    if (prev != null && idx > prev && idx - prev <= 50) {
      for (let i = prev + 1; i <= idx; i++) {
        const v = versesRef.current?.[i]
        if (v) keys.push(`${v.s}:${v.a}`)
      }
    } else {
      keys.push(key)
    }
    lastReadIdxRef.current = idx
    const res = recordVerses(keys, streakGoal)
    if (res.changed) {
      setStreakInfo({ count: res.count, goal: streakGoal, completed: res.completed, streak: res.streak })
      if (res.justCompleted) {
        showToast(`🔥 Daily goal complete — ${res.streak}-day streak!`, 'success', 4200)
        setStreakActive(false) // auto-pause once done
        refreshReminders({ enabled: streakReminders, goal: streakGoal })
      }
    }
  }, [browsePos, quranView, streakActive, streakGoal, streakReminders])

  // Restore the reading position when Browse becomes visible. We retry because on a cold
  // start the model "gate" can render briefly before the verse list is in the DOM, and the
  // 6000+ verses take a moment to paint. Re-runs when the gates clear (model-ready deps).
  useEffect(() => {
    if (quranView !== 'read' || dataState !== 'ready') return
    const target = browsePos.surahNum ? `${browsePos.surahNum}:${browsePos.ayahNum}` : null
    let cancelled = false
    let tries = 0
    const run = () => {
      if (cancelled) return
      // Prefer the live detection verse if one exists.
      if (currentBrowseVerseRef.current) {
        currentBrowseVerseRef.current.scrollIntoView({ block: 'center' })
        return
      }
      if (!target) return   // first-time user: stay at the beginning of the Quran
      const container = browseScrollRef.current
      const el = container?.querySelector(`[data-verse="${target}"]`)
      if (el) { el.scrollIntoView({ block: 'center' }); return }
      const header = surahHeaderRefs.current[browsePos.surahNum]
      if (header) { header.scrollIntoView({ block: 'start' }); return }
      if (tries++ < 40) setTimeout(run, 100)   // keep trying for up to ~4s while DOM/gates settle
    }
    const t = setTimeout(run, 50)
    return () => { cancelled = true; clearTimeout(t) }
  }, [quranView, dataState, baseModelReady, quranModelReady])

  // Analyze a given set of verses. Safety net: only include verses from surahs that
  // reached confirmation threshold; unconfirmed verses (and Fatiha) are excluded so a
  // wrong early detection can't pollute the analysis.
  const analyzeVerses = async (verses, emptyMsg) => {
    const confirmedSurahs = lockedSurahsRef.current
    const validVerses = verses.filter(v => v.confirmed && v.s !== 1 && confirmedSurahs.has(v.s))
    if (!validVerses.length) {
      setAnalyze({ open: true, loading: false, result: null, error: emptyMsg })
      return
    }
    const text = validVerses.map(v => `${v.sName} ${v.s}:${v.a} ✦ ${v.en}`).join('\n\n')
    // Stable cache key: sorted verse refs so the same set of ayat always hits the D1 cache
    const cacheKey = validVerses
      .map(v => `${v.s}:${v.a}`)
      .sort((a, b) => {
        const [sa, aa] = a.split(':').map(Number)
        const [sb, ab] = b.split(':').map(Number)
        return sa - sb || aa - ab
      })
      .join('|')
    setAnalyze({ open: true, loading: true, result: null, error: null })
    try {
      const res = await apiFetch(API_BASE + '/api/analyze', { method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ text, type: 'quran', cacheKey }) }, { timeoutMs: 30000, retries: 1 })
      const data = await res.json(); setAnalyze(prev => ({ ...prev, loading: false, result: data.analysis || 'No analysis returned.', cached: data.cached }))
    } catch (e) { setAnalyze(prev => ({ ...prev, loading: false, error: e.message })) }
  }

  const runAnalysis = () => analyzeVerses(sessionVerses, 'No confirmed verses (excluding Fatiha) to analyze. Try reciting a bit more.')
  const analyzeRakah = (group) => analyzeVerses(group.verses, `Rak'ah ${group.rakah} has no surah verses to analyze (Fatiha is excluded).`)

  // Analyze a single ayah directly (used by the Browse double-tap modal — no session filter).
  const analyzeSingleVerse = async (verse) => {
    setVerseModal(null)
    setAnalyze({ open: true, loading: true, result: null, error: null })
    try {
      const res = await apiFetch(API_BASE + '/api/analyze', { method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ text: `${verse.sName} ${verse.s}:${verse.a} ✦ ${verse.en}`, type: 'quran', cacheKey: `${verse.s}:${verse.a}` }) }, { timeoutMs: 30000, retries: 1 })
      const data = await res.json(); setAnalyze(prev => ({ ...prev, loading: false, result: data.analysis || 'No analysis returned.', cached: data.cached }))
    } catch (e) { setAnalyze(prev => ({ ...prev, loading: false, error: e.message })) }
  }

  // Analyze a whole surah (thematic overview), opened from the green surah banner.
  const analyzeSurah = async (g) => {
    setVerseModal(null)
    setAnalyze({ open: true, loading: true, result: null, error: null })
    try {
      const res = await apiFetch(API_BASE + '/api/analyze', { method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ text: `Surah ${g.surahNum}: ${g.name} (${g.verses.length} ayat)`, type: 'quran-surah', cacheKey: `surah:${g.surahNum}` }) }, { timeoutMs: 30000, retries: 1 })
      const data = await res.json(); setAnalyze(prev => ({ ...prev, loading: false, result: data.analysis || 'No analysis returned.', cached: data.cached }))
    } catch (e) { setAnalyze(prev => ({ ...prev, loading: false, error: e.message })) }
  }

  // Open a referenced ayah (from an AI deep link) in Browse and scroll to it.
  const navigateToVerse = useCallback((surah, ayah) => {
    setAnalyze(prev => ({ ...prev, open: false }))
    setVerseModal(null)
    setQuranView('read')
    let tries = 0
    const go = () => {
      const el = browseScrollRef.current?.querySelector(`[data-verse="${surah}:${ayah}"]`)
      if (el) { el.scrollIntoView({ block: 'center' }); return }
      const h = surahHeaderRefs.current[surah]
      if (h) { h.scrollIntoView({ block: 'start' }); return }
      if (tries++ < 25) setTimeout(go, 80)
    }
    setTimeout(go, 100)
  }, [])

  useEffect(() => {
    const handleClear = () => { clearSession() }
    window.addEventListener('app-clear-session', handleClear)
    return () => window.removeEventListener('app-clear-session', handleClear)
  }, [])

  // Apply a one-shot view intent from Home (e.g. "Read Quran" / "Goals"), then clear it.
  useEffect(() => {
    if (openView) { setQuranView(openView); onOpenViewConsumed?.() }
  }, [openView])

  // Hardware back: pop the deepest open thing inside the Quran tab before the app
  // falls back to Home (see utils/backstack + App's backButton handler).
  useEffect(() => {
    return pushBackHandler(() => {
      if (analyzePicker) { setAnalyzePicker(false); return true }
      if (analyze.open) { setAnalyze(prev => ({ ...prev, open: false })); return true }
      if (verseModal) { setVerseModal(null); return true }
      if (showBookmarks) { setShowBookmarks(false); return true }
      if (quranView === 'goalread') { setGoalReader(null); setQuranView('goals'); return true }
      if (quranView !== 'menu') {
        if (quranView === 'detect' && phase !== 'idle') end()
        setQuranView('menu')
        return true
      }
      return false
    })
  }, [analyzePicker, analyze.open, verseModal, showBookmarks, quranView, phase])

  const shareAnalysis = async () => { if (!analyze.result) return; try { await Share.share({ title: 'Quran Recitation Analysis', text: analyze.result, dialogTitle: 'Share via' }) } catch {} }

  // PLAN-024 (Bug #5): dedup indopak missing-verse warnings. `getAr` is called
  // for every rendered verse on every render; without a Set we'd flood the
  // console on a partial download (every Browse scroll = thousands of warnings).
  const warnedIndopakRef = useRef(new Set())
  const getAr = (v) => {
    if (quranScript !== 'indopak' || !indopakMap) return v.ar
    const entry = indopakMap[v.s]?.[v.a]
    if (!entry) {
      const key = `${v.s}:${v.a}`
      if (!warnedIndopakRef.current.has(key)) {
        warnedIndopakRef.current.add(key)
        console.warn(`[quran] indopak verse missing for ${key} — falling back to Uthmani`)
      }
      return v.ar
    }
    return entry
  }
  const arFont = quranScript === 'indopak' ? { fontFamily: "'Scheherazade New', serif" } : {}

  // ── Bismillah handling ───────────────────────────────────────────────────────
  // The Uthmani dataset EMBEDS Bismillah inside ayah 1 of every surah (except 9);
  // the IndoPak dataset doesn't include it at all. For a consistent presentation we
  // strip any embedded Bismillah from ayah-1 display text and render ONE standalone
  // Bismillah line before every surah except Al-Fatiha (where it IS verse 1) and
  // At-Tawbah (which has none). Display-only: v.n / detection matching is untouched,
  // so the Detect view's karaoke highlight still aligns (it keeps using getAr).
  const BISMILLAH = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'
  const stripBismillah = (text) => {
    const tokens = (text || '').replace(/^﻿/, '').split(/\s+/)
    // Compare via norm(BISMILLAH) rather than a hand-typed normalized literal — RTL
    // text pasted into source is easily reordered/corrupted invisibly.
    if (tokens.length > 4 && norm(tokens.slice(0, 4).join(' ')) === norm(BISMILLAH)) {
      return tokens.slice(4).join(' ')
    }
    return text
  }
  const displayAr = (v) => (v.a === 1 && v.s !== 1) ? stripBismillah(getAr(v)) : getAr(v)
  const showBasmala = (s) => s !== 1 && s !== 9

  // Browse/reading font: the user's font-size slider, scaled up on the unfolded
  // (wide) screen so it's bigger there while the slider still controls it.
  const browseScale = isWide ? 1.45 : 1
  const browseAr = `${(parseFloat(fontStyle?.arabic || '1') * browseScale).toFixed(2)}rem`
  const browseEn = `${(parseFloat(fontStyle?.english || '0.8') * browseScale).toFixed(2)}rem`

  const isFriday = new Date().getDay() === 5
  const renderGoalRow = (g, highlight) => {
    const prog = goalProgressIn(g, readSet)
    const done = prog.pct === 100
    return (
      <button key={g.id} className={`goal-row${done ? ' goal-done' : ''}${highlight ? ' goal-highlight' : ''}`} onClick={() => startGoal(g)}>
        <span className="goal-check">{done ? '✓' : prog.pct > 0 ? `${prog.pct}%` : '○'}</span>
        <span className="goal-info">
          <span className="goal-label">{g.label}</span>
          <span className="goal-ref">{g.ref}</span>
        </span>
        <span className="goal-cta">{done ? 'Read again' : prog.pct > 0 ? 'Continue ›' : 'Read ›'}</span>
      </button>
    )
  }

  if (!noticeAccepted) return <QuranNotice onAccept={acceptNotice} />
  // Combined one-tap model setup. While the on-device check is still running we show
  // a neutral spinner so an already-set-up install never flashes the setup screen.
  if (!baseModelReady || !quranModelReady) {
    if (!modelsChecked && quranDlState === 'idle') return (
      <div className="quran-gate">
        <div className="quran-gate-icon quran-spin">☪</div>
        <p className="quran-gate-msg">Preparing Quran…</p>
      </div>
    )
    return (
      <div className="quran-gate">
        <div className="quran-gate-icon">☪</div>
        <p className="quran-gate-msg"><strong>One-time setup</strong></p>
        <p className="quran-gate-sub">Noor needs to download its Quran recitation models. This happens once — about a few minutes on Wi-Fi. After that everything works offline.</p>
        {quranDlState === 'idle' && <button className="quran-dl-btn" onClick={setupModels}>Set up Noor</button>}
        {quranDlState === 'downloading' && <div className="quran-dl-progress-wrap"><div className="quran-dl-bar-track"><div className="quran-dl-bar-fill" style={{ width: `${quranDlProgress}%` }} /></div><p className="quran-dl-pct">{quranDlProgress}%</p></div>}
        {quranDlState === 'error' && <><p className="quran-gate-sub" style={{ color: '#f87171' }}>Setup failed — please try again.</p><button className="quran-dl-btn" onClick={setupModels}>Retry</button></>}
      </div>
    )
  }
  if (quranScript === 'indopak' && indopakLoading) return (
    <div className="quran-gate">
      <div className="quran-gate-icon quran-spin">☪</div>
      <p className="quran-gate-msg">Downloading Indo-Pak script…</p>
      <p className="quran-gate-sub">One-time download, ~2 MB</p>
    </div>
  )
  if (quranScript === 'indopak' && indopakError) return (
    <div className="quran-gate">
      <div className="quran-gate-icon">⚠</div>
      <p className="quran-gate-msg">Failed to download Indo-Pak text.</p>
      <button className="quran-retry-btn" onClick={() => { setIndopakError(false); setIndopakRetry(r => r + 1) }}>Retry</button>
    </div>
  )

  if (dataState === 'loading') return <div className="quran-gate"><div className="quran-gate-icon quran-spin">☪</div><p className="quran-gate-msg">Loading Quran data…</p><p className="quran-gate-sub">One moment please</p></div>
  if (dataState === 'error') return <div className="quran-gate"><div className="quran-gate-icon">⚠</div><p className="quran-gate-msg">Could not load Quran data.</p><button className="quran-retry-btn" onClick={fetchData}>Retry</button></div>
  
  return (
    <div className={`quran-mode${isWide ? ' quran-mode-wide' : ''}`}>
      {showDetectDebug && quranView === 'detect' && debugLog.length > 0 && (
        <div className={`detect-debug${debugCollapsed ? ' detect-debug-collapsed' : ''}`}>
          <div className="detect-debug-bar" onClick={() => setDebugCollapsed(c => !c)}>
            <span className="detect-debug-title">🧠 detection {phase === 'calibrating' ? '· calibrating' : phase === 'listening' ? '· live' : ''}</span>
            <span className="detect-debug-toggle">{debugCollapsed ? '▴ show' : '▾ hide'}</span>
          </div>
          {!debugCollapsed && (
            <div className="detect-debug-lines">
              {debugLog.map((e, i) => (
                <div key={i} className="detect-debug-line"><span className="detect-debug-time">{e.t}</span> {e.msg}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {quranView === 'menu' && (
        <div className="quran-menu">
          <div className="quran-menu-streak">🔥 {streakInfo.streak}-day streak · {streakInfo.count}/{streakInfo.goal} today</div>
          <div className="quran-menu-grid">
            <button className="quran-menu-card" onClick={() => setQuranView('read')}>
              <span className="qmc-icon">📖</span>
              <span className="qmc-title">Read with Translation</span>
              <span className="qmc-sub">Arabic + English, verse by verse</span>
            </button>
            <button className="quran-menu-card" onClick={() => setQuranView('mushaf')}>
              <span className="qmc-icon">🕋</span>
              <span className="qmc-title">Mushaf</span>
              <span className="qmc-sub">{(() => {
                try {
                  const p = localStorage.getItem(MUSHAF_POS_KEY)
                  if (p) { const [s, a] = p.split(':'); return `Continue · Surah ${s} : Ayah ${a}` }
                } catch {}
                return 'Arabic only, flowing page'
              })()}</span>
            </button>
            <button className="quran-menu-card" onClick={() => setQuranView('goals')}>
              <span className="qmc-icon">🎯</span>
              <span className="qmc-title">Goals</span>
              <span className="qmc-sub">Daily reading & sunnah goals</span>
            </button>
            <button className="quran-menu-card" onClick={() => setQuranView('detect')}>
              <span className="qmc-icon">🎙️</span>
              <span className="qmc-title">Detect my recitation</span>
              <span className="qmc-sub">Follow along as you recite</span>
            </button>
          </div>
        </div>
      )}

      {quranView === 'mushaf' && (
        <div className="quran-browse-overlay">
          <div className="quran-browse-header">
            <button className="quran-browse-back" onClick={() => setQuranView('menu')}>← Menu</button>
            <span className="quran-browse-title">Mushaf</span>
            <select
              className="quran-browse-jump"
              value={browseJump}
              onChange={e => { setBrowseJump(e.target.value); mushafHeaderRefs.current[parseInt(e.target.value)]?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
            >
              <option value="">Jump to Surah</option>
              {surahGroups.map(g => (<option key={g.surahNum} value={g.surahNum}>{g.surahNum}. {g.name}</option>))}
            </select>
          </div>
          <div className="browse-body">
            <div className="mushaf-scroll" ref={mushafScrollRef} onScroll={handleMushafScroll}>
              {surahGroups.map(g => (
                <div key={g.surahNum} className="mushaf-surah">
                  <div className="mushaf-surah-header" ref={el => { mushafHeaderRefs.current[g.surahNum] = el }}>
                    <span className="mushaf-surah-name">{g.surahNum}. {g.name}</span>
                    <span className="mushaf-surah-ar">{g.nameAr}</span>
                  </div>
                  {showBasmala(g.surahNum) && (
                    <p className="mushaf-bismillah" style={{ ...arFont }}>{BISMILLAH}</p>
                  )}
                  <p className="mushaf-text" dir="rtl" style={{ fontSize: browseAr, ...arFont }}>
                    {g.verses.map(v => (
                      <span key={`${v.s}:${v.a}`} data-verse={`${v.s}:${v.a}`} className="mushaf-ayah" onClick={() => setVerseModal(v)}>
                        {displayAr(v)}<span className="mushaf-ayah-num">۝{toArabicDigits(v.a)}</span>{' '}
                      </span>
                    ))}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {quranView === 'goals' && (
        <div className="quran-browse-overlay">
          <div className="quran-browse-header">
            <button className="quran-browse-back" onClick={() => setQuranView('menu')}>← Menu</button>
            <span className="quran-browse-title">Goals</span>
            <span className="quran-browse-back" style={{ visibility: 'hidden' }}>←</span>
          </div>
          <div className="browse-body">
            <div className="goals-scroll">
              <div className="goals-section">
                <h3 className="goals-section-title">Daily reading</h3>
                <div className={`goal-card goal-daily${streakInfo.completed ? ' goal-done' : ''}`}>
                  <div className="goal-daily-top">
                    <span className="goal-daily-count">{streakInfo.count} / {streakInfo.goal} verses today</span>
                    <span className="goal-flame">🔥 {streakInfo.streak}</span>
                  </div>
                  <div className="goal-daily-track"><div className="goal-daily-fill" style={{ width: `${Math.min(100, Math.round(streakInfo.count / streakInfo.goal * 100))}%` }} /></div>
                  <button className="goal-start-btn" onClick={() => { setStreakActive(true); lastReadIdxRef.current = null; setQuranView('read') }}>
                    {streakInfo.completed ? '✓ Goal complete — keep reading' : '▶ Start reading (resume)'}
                  </button>
                </div>
              </div>
              <div className="goals-section">
                <h3 className="goals-section-title">Friday{isFriday ? ' — today' : ''}</h3>
                {renderGoalRow(FRIDAY_GOAL, isFriday)}
              </div>
              <div className="goals-section">
                <h3 className="goals-section-title">Nightly (after Isha)</h3>
                {renderGoalRow(NIGHTLY_GOAL, false)}
              </div>
            </div>
          </div>
        </div>
      )}

      {quranView === 'goalread' && goalReader && (
        <div className="quran-browse-overlay">
          <div className="quran-browse-header">
            <button className="quran-browse-back" onClick={() => { setGoalReader(null); setQuranView('goals') }}>← Goals</button>
            <span className="quran-browse-title">{goalReader.goal.label}</span>
            <span className="quran-browse-back" style={{ visibility: 'hidden' }}>←</span>
          </div>
          <div className="goalread-progress-row">
            <div className="goalread-progress-track">
              <div
                className={`goalread-progress-fill${goalCompleted ? ' goalread-progress-done' : ''}`}
                style={{ width: `${Math.round((goalReqDone / Math.max(1, goalReader.requiredTotal)) * 100)}%` }}
              />
            </div>
            <span className="goalread-progress-label">
              {goalCompleted ? '✓ Complete' : `${goalReqDone} / ${goalReader.requiredTotal}`}
            </span>
          </div>
          <div className="browse-body">
            <div className="goalread-scroll" ref={goalScrollRef} onScroll={handleGoalScroll}>
              {(() => {
                const firstOptional = goalReader.sections.findIndex(s => s.optional)
                const finishPanel = (
                  <div className="goalread-finish-wrap" key="finish">
                    <button className="goalread-finish-btn" disabled={!goalCompleted} onClick={finishGoal}>
                      {goalCompleted ? '✓ Done — back to Goals' : 'Read to the end — completes automatically'}
                    </button>
                    {firstOptional !== -1 && (
                      <p className="goalread-optional-hint">Want more reward? Surah Al-Mulk continues below — optional.</p>
                    )}
                  </div>
                )
                const out = goalReader.sections.map((sec, i) => (
                  <div key={sec.label} className="goalread-section">
                    {i === firstOptional && finishPanel}
                    <div className="goalread-sec-header">
                      {sec.label}{sec.optional ? <span className="goal-optional"> · optional</span> : null}
                    </div>
                    {sec.verses[0]?.a === 1 && showBasmala(sec.verses[0].s) && (
                      <p className="mushaf-bismillah" style={{ fontSize: browseAr, ...arFont }}>{BISMILLAH}</p>
                    )}
                    {sec.verses.map(v => (
                      <div key={`${v.s}:${v.a}`} data-verse={`${v.s}:${v.a}`} className="browse-verse">
                        <div className="browse-ayah-col"><span className="browse-ayah-num">{v.a}</span></div>
                        <div className="browse-verse-body">
                          <p className="browse-verse-ar" dir="rtl" style={{ fontSize: browseAr, ...arFont }}>{displayAr(v)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
                if (firstOptional === -1) out.push(finishPanel)
                return out
              })()}
            </div>
          </div>
        </div>
      )}

      {quranView === 'read' && (
        <div className="quran-browse-overlay">
          <div className="quran-browse-header">
            <button className="quran-browse-back" onClick={() => setQuranView('menu')}>← Menu</button>
            <span className="quran-browse-title">Quran</span>
            <button
              className="quran-browse-bm-btn"
              onClick={() => setShowBookmarks(true)}
              title="Bookmarks"
            ><Icons.Bookmark /> <span className="quran-browse-bm-count">{bookmarks.length}</span></button>
            <select
              className="quran-browse-jump"
              value={browseJump}
              onChange={e => { setBrowseJump(e.target.value); jumpToSurah(parseInt(e.target.value)) }}
            >
              <option value="">Jump to Surah</option>
              {surahGroups.map(g => (
                <option key={g.surahNum} value={g.surahNum}>{g.surahNum}. {g.name}</option>
              ))}
            </select>
          </div>

          <StreakBanner streak={streakInfo.streak} count={streakInfo.count} goal={streakInfo.goal} completed={streakInfo.completed} active={streakActive} onToggle={() => { setStreakActive(a => !a); lastReadIdxRef.current = null }} />

          {showBookmarks && (
            <div className="quran-bm-panel">
              <div className="quran-bm-panel-header">
                <button className="quran-bm-back" onClick={() => setShowBookmarks(false)}>← Back</button>
                <span className="quran-bm-title">Bookmarks</span>
              </div>
              <div className="quran-bm-list">
                {bookmarks.map(bm => (
                  <div key={bm.id} className="quran-bm-item" onClick={() => navigateToBookmark(bm)}>
                    <span className="quran-bm-icon">{bm.isDefault ? '📌' : <Icons.Bookmark />}</span>
                    <div className="quran-bm-info">
                      <div className="quran-bm-label">{bm.label}</div>
                      <div className="quran-bm-ref">{bm.surahName} {bm.surahNum}:{bm.ayahNum}</div>
                    </div>
                    {!bm.isDefault && (
                      <button
                        className="quran-bm-del"
                        onClick={e => { e.stopPropagation(); removeBookmark(bm.id) }}
                        title="Remove bookmark"
                      >✕</button>
                    )}
                  </div>
                ))}
                {bookmarks.length === 0 && (
                  <p className="quran-bm-empty">No bookmarks yet — tap <Icons.Bookmark /> on any verse while browsing.</p>
                )}
                <p className="quran-bm-hint">Tap <Icons.Bookmark /> on any verse to add a custom bookmark</p>
              </div>
            </div>
          )}

          <div className="browse-body">
          <div className="quran-browse-scroll" ref={browseScrollRef} onScroll={handleBrowseScroll}>
            {surahGroups.map(g => {
              const isActive = browsePos.surahNum === g.surahNum
              return (
              <div key={g.surahNum} className="browse-surah-group">
                <div
                  className="browse-surah-header"
                  ref={el => { surahHeaderRefs.current[g.surahNum] = el }}
                >
                  <div className="browse-surah-top-row">
                    <span className="browse-surah-name">{g.surahNum}. {g.name}</span>
                    <div className="browse-surah-top-right">
                      <button
                        className="browse-surah-analyze"
                        onClick={e => { e.stopPropagation(); analyzeSurah(g) }}
                        title={`Analyze Surah ${g.name}`}
                        aria-label={`Analyze Surah ${g.name}`}
                      ><Icons.Analyze /> <span>Surah</span></button>
                      <span className="browse-surah-ar">{g.nameAr}</span>
                    </div>
                  </div>
                  {isActive && (
                    <div className="browse-surah-progress-row">
                      <div className="browse-surah-progress-track">
                        <div className="browse-surah-progress-fill" style={{ width: `${(browsePos.ayahNum / g.verses.length) * 100}%` }} />
                        <span className="browse-surah-progress-label">{browsePos.ayahNum} / {g.verses.length}</span>
                      </div>
                    </div>
                  )}
                </div>
                {showBasmala(g.surahNum) && (
                  <p className="mushaf-bismillah" style={{ fontSize: browseAr, ...arFont }}>{BISMILLAH}</p>
                )}
                {g.verses.map(v => {
                  const isCurrent = current && current.s === v.s && current.a === v.a
                  const bmed = bookmarkedKeys.has(`${v.s}:${v.a}`)
                  return (
                    <div
                      key={`${v.s}:${v.a}`}
                      data-verse={`${v.s}:${v.a}`}
                      className={`browse-verse${isCurrent ? ' browse-verse-current' : ''}`}
                      ref={isCurrent ? el => { currentBrowseVerseRef.current = el } : null}
                    >
                      <div className="browse-ayah-col">
                        <span className="browse-ayah-num">{v.a}</span>
                        <button
                          className="browse-ayah-analyze"
                          onClick={e => { e.stopPropagation(); setVerseModal(v) }}
                          title="Analyze this ayah"
                          aria-label="Analyze this ayah"
                        ><Icons.Analyze /></button>
                      </div>
                      <div className="browse-verse-body">
                        <p className="browse-verse-ar" dir="rtl" style={{ fontSize: browseAr, ...arFont }}>{displayAr(v)}</p>
                        <p className="browse-verse-en" style={{ fontSize: browseEn }}>{v.en}</p>
                      </div>
                      <div className="browse-verse-actions">
                        <button
                          className={`browse-bm-btn${bmed ? ' browse-bm-btn-active' : ''}`}
                          onClick={e => {
                            e.stopPropagation()
                            if (bmed) {
                              const found = bookmarks.find(b => b.surahNum === v.s && b.ayahNum === v.a)
                              if (found && !found.isDefault) removeBookmark(found.id)
                            } else {
                              addBookmark(v)
                            }
                          }}
                          title={bmed ? 'Bookmarked' : 'Add bookmark'}
                        ><Icons.Bookmark /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )})}
          </div>
          </div>
        </div>
      )}
      {verseModal && (
        <div className="modal-overlay" onClick={() => setVerseModal(null)}>
          <div className="modal analyze-modal" onClick={e => e.stopPropagation()} style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="quran-analyze-header">
              <button className="quran-analyze-back" onClick={() => setVerseModal(null)}>← Back</button>
              <span className="quran-analyze-title">{verseModal.sName} · {verseModal.s}:{verseModal.a}</span>
              <span style={{ width: 40 }} />
            </div>
            <div style={{ overflowY: 'auto', padding: '18px 16px' }}>
              {verseModal.a === 1 && showBasmala(verseModal.s) && (
                <p className="mushaf-bismillah" style={{ fontSize: browseAr, ...arFont, marginTop: 0 }}>{BISMILLAH}</p>
              )}
              <p className="quran-arabic" dir="rtl" style={{ fontSize: browseAr, ...arFont, marginTop: 0 }}>{displayAr(verseModal)}</p>
              <div className="quran-divider" />
              <p className="quran-english" style={{ fontSize: browseEn }}>{verseModal.en}</p>
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border, rgba(255,255,255,0.1))', display: 'flex', gap: '10px' }}>
              <button className="quran-detect-btn" onClick={() => analyzeSingleVerse(verseModal)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Icons.Analyze /> Analyze this Ayah
              </button>
              {(() => {
                const bmed = bookmarkedKeys.has(`${verseModal.s}:${verseModal.a}`)
                return (
                  <button
                    className="quran-detect-btn verse-modal-bm"
                    onClick={() => {
                      if (bmed) {
                        const found = bookmarks.find(b => b.surahNum === verseModal.s && b.ayahNum === verseModal.a)
                        if (found && !found.isDefault) removeBookmark(found.id)
                      } else {
                        addBookmark(verseModal)
                        showToast('Bookmarked', 'success', 1600)
                      }
                    }}
                    style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  ><Icons.Bookmark /> {bmed ? 'Saved' : 'Bookmark'}</button>
                )
              })()}
            </div>
          </div>
        </div>
      )}
      {analyzePicker && (
        <div className="modal-overlay" onClick={() => setAnalyzePicker(false)}>
          <div className="modal quran-analyze-picker" onClick={e => e.stopPropagation()}>
            <h3 className="quran-picker-title">What would you like to analyze?</h3>
            <button className="quran-picker-btn quran-picker-all" onClick={() => { setAnalyzePicker(false); runAnalysis() }}>
              <Icons.Analyze /> Analyze all rak'ahs
            </button>
            {sessionByRakah.filter(g => g.verses.some(v => v.s !== 1)).map(g => {
              const n = g.verses.filter(v => v.s !== 1).length
              return (
                <button key={`pick-${g.rakah}`} className="quran-picker-btn" onClick={() => { setAnalyzePicker(false); analyzeRakah(g) }}>
                  <span>Rak'ah {g.rakah}</span>
                  <span className="quran-picker-count">{n} {n === 1 ? 'surah verse' : 'surah verses'}</span>
                </button>
              )
            })}
            <button className="quran-picker-cancel" onClick={() => setAnalyzePicker(false)}>Cancel</button>
          </div>
        </div>
      )}

      {analyze.open && (
        <div className="modal-overlay" onClick={() => setAnalyze(prev => ({ ...prev, open: false }))}>
          <div className="modal analyze-modal" onClick={e => e.stopPropagation()} style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="quran-analyze-header">
              <button className="quran-analyze-back" onClick={() => setAnalyze(prev => ({ ...prev, open: false }))}>← Back</button>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span className="quran-analyze-title">AI Analysis</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI-generated — may err. Verify with a scholar.</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {analyze.result && onSaveHistory && (
                  <button className="quran-analyze-share" onClick={() => onSaveHistory({ duration: 0, sentenceCount: sessionVerses.length, analysis: analyze.result })} title="Save to History">
                    <Icons.Save />
                  </button>
                )}
                {analyze.result && (
                  <button className="quran-analyze-share" onClick={shareAnalysis} title="Share">
                    <Icons.Share />
                  </button>
                )}
              </div>
            </div>
            <div className="analyze-size-bar">
              {[['sm','A'],['md','AA'],['lg','AAA']].map(([s, label]) => (
                <button key={s} className={`analyze-size-btn${analyzeTextSize === s ? ' analyze-size-active' : ''}`} onClick={() => setAnalyzeTextSizePersist(s)}>{label}</button>
              ))}
            </div>
            <div className="quran-analyze-body" style={{ overflowY: 'auto', padding: '16px' }}>
              {analyze.loading && (
                <p className="quran-analyze-loading">Analyzing…</p>
              )}
              {analyze.error && <p className="quran-analyze-error">⚠ {analyze.error}</p>}
              {analyze.result && analyze.cached && (
                <p style={{ fontSize: '0.78rem', color: 'var(--green-light, #10804b)', margin: '0 0 10px', fontWeight: 600 }}>⚡ Instant — retrieved from cache</p>
              )}
              {analyze.result && (
                <div className="quran-analyze-result" style={{ fontSize: ANALYZE_SIZES[analyzeTextSize] }}>{renderAIContent(analyze.result, navigateToVerse)}</div>
              )}
            </div>
          </div>
        </div>
      )}
      {quranView === 'detect' && (<>
        <div className="quran-browse-header quran-detect-header">
          <button className="quran-browse-back" onClick={() => { if (phase !== 'idle') end(); setQuranView('menu') }}>← Menu</button>
          <span className="quran-browse-title">Detect Recitation</span>
          <span className="quran-browse-back" style={{ visibility: 'hidden' }}>←</span>
        </div>
        {!batteryExempt && (
          <div className="battery-warn">
            <div className="battery-warn-text">
              <strong>Keep tracking alive with the screen off</strong>
              <span>Allow Noor to run in the background, or your phone may stop tracking mid-Salah.</span>
            </div>
            <button className="battery-warn-btn" onClick={requestBatteryExempt}>Allow</button>
          </div>
        )}
      <div className="quran-verse-area" ref={verseAreaRef}>
        {phase === 'calibrating' ? (
          <div className="quran-calibrating">
            <div className="calibrating-ring">
              <span className="calibrating-mic">🎙️</span>
            </div>
            <p className="calibrating-title">Identifying Surah</p>
            <p className="calibrating-sub">Listening for a moment before showing results…</p>
            {sttError && <p className="quran-analyze-error" style={{ marginTop: 10 }}>⚠ {sttError}</p>}
            <div className="calibrating-dots">
              <span /><span /><span />
            </div>
          </div>
        ) : current ? (
          <div className="quran-cards">
            <div className={`quran-verse-card quran-verse-card-current ${targetVerse && current.s === targetVerse.surah && current.a === targetVerse.ayah ? 'target-pulse' : ''}`}>
              <div className="quran-ref-row"><span className="quran-surah-ar">{current.sAr}</span><span className="quran-surah-ref">{current.sName} · {current.s}:{current.a}</span><span className="quran-rakah-badge">Rak'ah {rakahDisplay}</span></div>
              <div className="quran-arabic" dir="rtl" style={{ fontSize: fontStyle?.arabic, ...arFont }}>{highlightProgressive(getAr(current), matchedProgress, provisionalProgress)}</div>
              <div className="quran-divider" /><div className="quran-english" style={{ fontSize: fontStyle?.english }}>{current.en}</div>
              <div className="quran-reanchor-row">
                <span className="quran-reanchor-label">Wrong verse?</span>
                <button className="quran-reanchor-btn" onClick={() => stepVerse(-1)} title="Move to previous ayah">◀ Prev</button>
                <button className="quran-reanchor-btn" onClick={() => stepVerse(1)} title="Move to next ayah">Next ▶</button>
              </div>
            </div>
            {nextVerse && <div className="quran-verse-card quran-verse-card-next"><div className="quran-ref-row"><span className="quran-up-next-badge">Up next</span><span className="quran-surah-ar">{nextVerse.sAr}</span><span className="quran-surah-ref">{nextVerse.sName} · {nextVerse.s}:{nextVerse.a}</span></div><div className="quran-arabic" dir="rtl" style={{ fontSize: fontStyle?.arabic, ...arFont }}>{getAr(nextVerse)}</div><div className="quran-divider" /><div className="quran-english" style={{ fontSize: fontStyle?.english }}>{nextVerse.en}</div></div>}
            {nextNextVerse && <div className="quran-verse-card quran-verse-card-next"><div className="quran-ref-row"><span className="quran-surah-ar">{nextNextVerse.sAr}</span><span className="quran-surah-ref">{nextNextVerse.sName} · {nextNextVerse.s}:{nextNextVerse.a}</span></div><div className="quran-arabic" dir="rtl" style={{ fontSize: fontStyle?.arabic, ...arFont }}>{getAr(nextNextVerse)}</div><div className="quran-divider" /><div className="quran-english" style={{ fontSize: fontStyle?.english }}>{nextNextVerse.en}</div></div>}
          </div>
        ) : <div className="quran-idle-msg"><p className="quran-idle-prompt">{listening ? 'Listening for recitation…' : 'Tap the mic to begin'}</p>{sttError && <p className="quran-detect-error">⚠ {sttError}</p>}</div>}
        <div className="quran-session-list">
          {sessionByRakah.map(group => (
            <div key={`rakah-${group.rakah}`} className="quran-rakah-group">
              <div className="quran-rakah-header">
                <span>Rak'ah {group.rakah}</span>
                {group.verses.some(v => v.s !== 1) && (
                  <button className="quran-rakah-analyze" onClick={() => analyzeRakah(group)} title={`Analyze Rak'ah ${group.rakah}`}>
                    <Icons.Analyze /> Analyze
                  </button>
                )}
              </div>
              {group.verses.map(v => (
                <div key={`${group.rakah}:${v.s}:${v.a}`} className="quran-verse-card">
                  <div className="quran-sura-badge">
                    <span className="quran-sura-name">{v.sName} {v.s}:{v.a}</span>
                    {!v.confirmed && <span style={{ fontSize: '0.8rem', color: '#ff9800', marginLeft: '8px', opacity: 0.8 }}>[Unconfirmed]</span>}
                  </div>
                  <div className="quran-verse-ar" dir="rtl" style={{ fontSize: fontStyle?.arabic, ...arFont }}>{getAr(v)}</div>
                  <div className="quran-verse-en" style={{ fontSize: fontStyle?.english }}>{v.en}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="unified-controls">

        {phase === 'idle' && (
          <>
            {sessionVerses.length === 0 ? (
              <>
                <button className="ctrl-btn ctrl-mic" onClick={start}>
                  <Icons.Mic />
                </button>
                <button className="ctrl-btn ctrl-stop" disabled>
                  <Icons.Stop />
                </button>
              </>
            ) : (
              <>
                <button className="ctrl-btn ctrl-analyze" onClick={() => {
                  // If the session spans more than one analyzable rak'ah, let the user pick which
                  // (or all); otherwise just analyze straight away.
                  const groups = sessionByRakah.filter(g => g.verses.some(v => v.s !== 1))
                  if (groups.length > 1) setAnalyzePicker(true)
                  else runAnalysis()
                }}>
                  <Icons.Analyze /> Analyze
                </button>
                <button className="ctrl-btn ctrl-share" onClick={shareAnalysis} disabled={!analyze.result}>
                  <Icons.Share /> Share
                </button>
              </>
            )}
          </>
        )}

        {(phase === 'listening' || phase === 'paused' || phase === 'calibrating') && (
          <>
            {phase === 'listening' ? (
              <button className="ctrl-btn ctrl-pause" onClick={pause}>
                <Icons.Pause />
              </button>
            ) : (
              <button className="ctrl-btn ctrl-mic ctrl-resume" onClick={start}>
                <Icons.Mic />
              </button>
            )}
            <button className="ctrl-btn ctrl-stop" onClick={end}>
              <Icons.Stop />
            </button>
          </>
        )}
      </div>
      </>)}
    </div>
  )
}

