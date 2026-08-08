import { useState, useEffect, useMemo } from 'react'
import { Capacitor } from '@capacitor/core'
import { Icons } from './utils/icons'
import { getProgress, getReadSetToday, getWeekStatus, todayStr } from './utils/streak'
import {
  getPrayerTimes, getPrayerWindow, getCurrentPrayer,
  PRAYER_ORDER, PRAYER_LABELS, fmtTime, fmtDuration, getHijriDate, getWidgetPayload,
} from './utils/prayer'
import { surahName } from './data/surahs'
import { FRIDAY_GOAL, NIGHTLY_GOAL, goalProgressIn, isFridayNow, isNightlyNow } from './data/goals'
import { loadBook } from './utils/maktabaData'
import { NoorWidget } from './plugins/NoorWidget'
import { adhkarProgress } from './AdhkarPanel'
import { getNextFast, isRamadan } from './utils/fasting'
import { getCachedCircle, getCachedMembers, fetchCircle, displayStreakOf } from './utils/circle'

const IS_NATIVE = Capacitor.isNativePlatform()

const BROWSE_POS_KEY = 'quran-browse-pos'

function readContinuePos() {
  try {
    const p = JSON.parse(localStorage.getItem(BROWSE_POS_KEY) || 'null')
    return (p && p.surahNum) ? p : null
  } catch { return null }
}

export default function HomePanel({ settings, streakGoal, onGoto }) {
  const location = settings.location || null
  const method = settings.prayerMethod || 'NorthAmerica'
  const madhab = settings.prayerMadhab || 'shafi'

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const times = useMemo(() => getPrayerTimes(location, method, madhab, now), [location, method, madhab, now])
  const win = useMemo(() => getPrayerWindow(location, method, madhab, now), [location, method, madhab, now])
  const current = useMemo(() => getCurrentPrayer(location, method, madhab, now), [location, method, madhab, now])
  const hijri = useMemo(() => getHijriDate(now), [now])
  const urgent = win && win.next.inMs <= 15 * 60 * 1000

  // Push fresh prayer data to the native home-screen widget. Keyed on the calendar day
  // (not the 30s-ticking `now`) so this fires once a day / on settings change, not every tick —
  // the widget itself does the live countdown math against whatever was last pushed here.
  // Also carries lat/lng/tempUnit so the widget's own background job can fetch weather
  // independently, without the app needing to be open.
  useEffect(() => {
    if (!IS_NATIVE || !location) return
    const payload = getWidgetPayload(location, method, madhab, new Date(), settings.tempUnit)
    if (payload) NoorWidget.updateData(payload).catch(() => {})
  }, [location, method, madhab, settings.tempUnit, todayStr()])

  const progress = getProgress(streakGoal)
  const readSet = getReadSetToday()
  const week = getWeekStatus()
  const cont = readContinuePos()

  // Hadith of the Day (best effort — only if the library is downloaded).
  // Re-runs at local midnight (todayStr() dep flips) so the day's hadith refreshes
  // automatically rather than showing yesterday's until remount.
  const [hod, setHod] = useState(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Books ship bundled now; loadBook returns null on the (very unlikely)
      // cold-cache miss, so the explicit "have they downloaded" check is gone.
      const book = await loadBook('bukhari', 'eng')
      if (cancelled || !book?.hadiths?.length) return
      // PLAN-024 (Bug #9): use Date.now() for the day index instead of
      // `new Date(todayStr()).getTime()`. The old form parsed YYYY-MM-DD as UTC
      // midnight — users east of UTC saw the day's HOD rotate at local 7-8 AM
      // rather than at their local midnight. Date.now() is unambiguous wall time
      // from the device, divided by 86400000 to a UTC day count.
      const dayIdx = Math.floor(Date.now() / 86400000)
      const h = book.hadiths[dayIdx % book.hadiths.length]
      setHod({ text: h.text || '', number: h.hadithnumber, book: book.metadata?.name || 'Sahih Bukhari' })
    })()
    return () => { cancelled = true }
  }, [todayStr()])

  const greeting = (() => {
    const h = now.getHours()
    if (h < 5) return 'Peaceful night'
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  // Which special goals to surface right now.
  const activeGoals = []
  if (isFridayNow(now)) activeGoals.push(FRIDAY_GOAL)
  if (isNightlyNow(now)) activeGoals.push(NIGHTLY_GOAL)

  // Adhkar tile window: morning Fajr→Dhuhr, evening Asr→Isha (hour fallback without location).
  const h = now.getHours()
  const adhkarPeriod =
    times ? (now >= times.fajr && now < times.dhuhr ? 'morning' : now >= times.asr && now < times.isha ? 'evening' : null)
          : (h >= 5 && h < 12 ? 'morning' : h >= 16 && h < 22 ? 'evening' : null)
  const adhkarProg = adhkarPeriod ? adhkarProgress(adhkarPeriod) : null

  // Next sunnah fasting day + Ramadan suhoor/iftar line.
  // Compute from todayStr() (stable within a day, flips at midnight) instead of `now`
  // — `now` ticks every 30s but fasting days are date-bounded, so useMemo on todayStr()
  // gives the correct value without re-running on every time tick.
  const nextFast = useMemo(() => getNextFast(new Date(todayStr())), [todayStr()])
  const ramadan = isRamadan(now)
  const ramadanLine = ramadan && times
    ? (now < times.fajr
        ? `🌙 Suhoor ends ${fmtTime(times.fajr)} (${fmtDuration(times.fajr - now)})`
        : now < times.maghrib
          ? `🌙 Iftar ${fmtTime(times.maghrib)} (${fmtDuration(times.maghrib - now)})`
          : null)
    : null

  // Family circle members (best-effort refresh; cached list renders offline).
  const circle = getCachedCircle()
  const [members, setMembers] = useState(() => getCachedMembers())
  // PLAN-022 + PLAN-024 (Bug #3): event-driven refresh — when the user joins /
  // creates / leaves / renames a circle in FamilySettings, circle.js dispatches
  // `app-circle-changed`; we re-fetch here so the Family tile + names refresh
  // without a full app restart. Deps stay `[]` because `getCachedCircle()` calls
  // JSON.parse on every render (fresh object reference each render) — a dep of
  // [circle] would re-fire the effect on every render and waste a fetchCircle
  // RPC per render. The mount-time fetch + app-circle-changed bus handles all
  // updates correctly.
  useEffect(() => {
    if (!circle) return
    let cancelled = false
    const fetchNow = () => {
      fetchCircle().then(m => { if (!cancelled) setMembers(m) }).catch(() => {}) // keep cache on failure
    }
    fetchNow()
    const onCircleChange = () => { if (!cancelled) fetchNow() }
    window.addEventListener('app-circle-changed', onCircleChange)
    return () => {
      cancelled = true
      window.removeEventListener('app-circle-changed', onCircleChange)
    }
  }, [])

  return (
    <div className="home-panel">
      <div className="home-header">
        <span className="home-greeting">{greeting}</span>
        <span className="home-streak-chip">🔥 {progress.streak}</span>
      </div>

      {/* Week calendar */}
      <div className="home-week">
        {week.map(d => (
          <div key={d.ymd} className={`home-week-day${d.isToday ? ' home-week-today' : ''}${d.completed ? ' home-week-done' : ''}${d.isFuture ? ' home-week-future' : ''}`}>
            <span className="home-week-label">{d.label}</span>
            <span className="home-week-mark">{d.completed ? '✓' : d.dayNum}</span>
          </div>
        ))}
      </div>

      {/* Next prayer */}
      {location ? (
        <div className="home-prayer-card">
          {win && (
            <div className="prayer-window">
              <div className="prayer-window-row">
                <div className="pw-side pw-prev">
                  <span className="pw-name">{win.prev.label}</span>
                  <span className="pw-time">{fmtTime(win.prev.time)}</span>
                </div>
                <div className="pw-center">
                  <span className={`pw-countdown${urgent ? ' pw-countdown-urgent' : ''}`}>{fmtDuration(win.next.inMs)}</span>
                  <span className="pw-countdown-label">until {win.next.label}</span>
                </div>
                <div className="pw-side pw-next">
                  <span className="pw-name">{win.next.label}</span>
                  <span className="pw-time">{fmtTime(win.next.time)}</span>
                </div>
              </div>
              <div className="prayer-window-track">
                <div className={`prayer-window-fill${urgent ? ' prayer-window-urgent' : ''}`} style={{ width: `${Math.round(win.frac * 100)}%` }} />
              </div>
              {hijri && <div className="prayer-window-date">{hijri}</div>}
            </div>
          )}
          <div className="home-prayer-row">
            {PRAYER_ORDER.map(k => {
              const isNext = win && win.next.name === k
              const isNow = current && current.name === k
              return (
                <div key={k} className={`home-prayer-pill${isNext ? ' home-prayer-next' : ''}${isNow ? ' home-prayer-current' : ''}`}>
                  <span className="hpp-name">{PRAYER_LABELS[k]}</span>
                  <span className="hpp-time">{times ? fmtTime(times[k]) : '--'}</span>
                </div>
              )
            })}
          </div>
          {ramadanLine && <div className="home-ramadan-line">{ramadanLine}</div>}
          {location.city && <div className="home-prayer-city">📍 {location.city}</div>}
        </div>
      ) : (
        <button className="home-prayer-card home-prayer-empty" onClick={() => onGoto('settings')}>
          <span className="home-tile-icon"><Icons.Mosque /></span>
          <div className="home-tile-body">
            <span className="home-tile-title">Set your location</span>
            <span className="home-tile-sub">Get prayer times & qibla — tap to choose your city</span>
          </div>
          <span className="home-tile-cta">Set up ›</span>
        </button>
      )}

      <div className="home-section-label">Today</div>

      {/* Read Quran (continue inside) */}
      <button className="home-tile home-read" onClick={() => onGoto('quran')}>
        <span className="home-tile-icon"><Icons.Quran /></span>
        <div className="home-tile-body">
          <span className="home-tile-title">Read Quran</span>
          <span className="home-tile-sub">
            {cont ? `Continue · ${surahName(cont.surahNum)} : Ayah ${cont.ayahNum}` : 'Start from the beginning'}
          </span>
        </div>
        <span className="home-tile-cta">{cont ? 'Resume ›' : 'Open ›'}</span>
      </button>

      {/* Hadith of the Day — directly under Read Quran */}
      {hod && (
        <button className="home-tile home-hod" onClick={() => onGoto('maktaba')}>
          <span className="home-tile-icon">📚</span>
          <div className="home-tile-body">
            <span className="home-tile-title">Hadith of the Day</span>
            <span className="home-tile-sub home-hod-text">
              {hod.text.slice(0, 120)}{hod.text.length > 120 ? '…' : ''}
            </span>
            <span className="home-hod-src">{hod.book} · #{hod.number}</span>
          </div>
        </button>
      )}

      {/* Goals with active sub-goals */}
      <button className="home-goals-tile" onClick={() => onGoto('goals')}>
        <div className="home-goals-head">
          <span className="home-tile-icon"><Icons.Target /></span>
          <span className="home-tile-title">Goals</span>
          <span className="home-tile-cta">Open ›</span>
        </div>
        <div className="home-goals-list">
          <div className={`home-goal-row${progress.completed ? ' home-goal-done' : ''}`}>
            <span className="home-goal-check">{progress.completed ? '✓' : '○'}</span>
            <span className="home-goal-name">Daily reading</span>
            <span className="home-goal-status">{progress.completed ? 'complete' : `${progress.count}/${progress.goal} verses`}</span>
          </div>
          {activeGoals.map(g => {
            const prog = goalProgressIn(g, readSet)
            const done = prog.pct === 100
            return (
              <div key={g.id} className={`home-goal-row${done ? ' home-goal-done' : ''}`}>
                <span className="home-goal-check">{done ? '✓' : '○'}</span>
                <span className="home-goal-name">{g.label}</span>
                <span className="home-goal-status">{done ? 'done' : prog.pct > 0 ? `${prog.pct}% done` : g.ref}</span>
              </div>
            )
          })}
        </div>
      </button>

      {/* Morning / evening adhkar (only during its window) */}
      {adhkarProg && (
        <button className={`home-tile${adhkarProg.done === adhkarProg.total ? ' home-nudge-done' : ''}`} onClick={() => onGoto('adhkar')}>
          <span className="home-tile-icon">{adhkarPeriod === 'morning' ? '🌅' : '🌆'}</span>
          <div className="home-tile-body">
            <span className="home-tile-title">{adhkarPeriod === 'morning' ? 'Morning adhkar' : 'Evening adhkar'}</span>
            <span className="home-tile-sub">
              {adhkarProg.done === adhkarProg.total ? 'All done for today ✓' : `${adhkarProg.done}/${adhkarProg.total} completed`}
            </span>
          </div>
          <span className="home-tile-cta">Open ›</span>
        </button>
      )}

      {/* Next sunnah fasting day */}
      {nextFast && (
        <div className="home-fast-chip">
          🌙 Next sunnah fast: <strong>{nextFast.label}</strong> — {nextFast.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
          {nextFast.inDays === 1 ? ' (tomorrow)' : ` (in ${nextFast.inDays} days)`}
        </div>
      )}

      {/* Family streaks (only when in a circle) */}
      {circle && members.length > 0 && (
        <div className="home-goals-tile home-family-tile">
          <div className="home-goals-head">
            <span className="home-tile-icon">👨‍👩‍👧</span>
            <span className="home-tile-title">Family{circle.circleName ? ` · ${circle.circleName}` : ''}</span>
          </div>
          <div className="home-goals-list">
            {members.map((m, i) => {
              const streak = displayStreakOf(m)
              const doneToday = !!m.completed
              return (
                <div key={i} className={`home-goal-row${doneToday ? ' home-goal-done' : ''}${m.isYou ? ' home-family-you' : ''}`}>
                  <span className="home-goal-check">{doneToday ? '✓' : '○'}</span>
                  <span className="home-goal-name">{m.display_name}{m.isYou ? ' (you)' : ''}</span>
                  <span className="home-goal-status">🔥 {streak}{doneToday ? '' : m.verses_read ? ` · ${m.verses_read}/${m.goal || 10}` : ''}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Qibla */}
      <button className="home-tile" onClick={() => onGoto('qibla')} disabled={!location}>
        <span className="home-tile-icon">🧭</span>
        <div className="home-tile-body">
          <span className="home-tile-title">Qibla</span>
          <span className="home-tile-sub">{location ? 'Find the direction of prayer' : 'Set your location first'}</span>
        </div>
        <span className="home-tile-cta">{location ? 'Open ›' : ''}</span>
      </button>
    </div>
  )
}
