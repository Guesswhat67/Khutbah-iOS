import { useState, useEffect, useMemo } from 'react'
import { ADHKAR } from './data/adhkar'
import { getPrayerTimes } from './utils/prayer'
import { todayStr } from './utils/streak'
import { tick, success } from './utils/haptics'

const STORE_KEY = 'adhkar-today' // { day, morning: {id: count}, evening: {id: count} }

function loadToday() {
  try {
    const t = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
    if (t && t.day === todayStr()) {
      return { day: t.day, morning: t.morning || {}, evening: t.evening || {} }
    }
  } catch {}
  return { day: todayStr(), morning: {}, evening: {} } // new day → fresh counts
}

// Which list to open with: morning until Dhuhr, evening after — prayer-time aware
// when a location is set, otherwise a simple clock fallback.
function defaultPeriod(settings) {
  const now = new Date()
  const times = getPrayerTimes(settings?.location, settings?.prayerMethod, settings?.prayerMadhab, now)
  if (times?.dhuhr) return now < times.dhuhr ? 'morning' : 'evening'
  return now.getHours() < 12 ? 'morning' : 'evening'
}

// Completion helper shared with the Home tile (import { adhkarProgress }).
export function adhkarProgress(period) {
  const t = loadToday()
  const list = ADHKAR.filter(d => d[period])
  const done = list.reduce((n, d) => n + ((t[period][d.id] || 0) >= d.count ? 1 : 0), 0)
  return { done, total: list.length }
}

export default function AdhkarPanel({ settings, fontStyle, onBack }) {
  const [period, setPeriod] = useState(() => defaultPeriod(settings))
  const [today, setToday] = useState(loadToday)

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(today)) } catch {}
  }, [today])

  const list = useMemo(() => ADHKAR.filter(d => d[period]), [period])
  const counts = today[period]
  const doneCount = list.reduce((n, d) => n + ((counts[d.id] || 0) >= d.count ? 1 : 0), 0)

  const tap = (d) => {
    setToday(prev => {
      const cur = prev[period][d.id] || 0
      if (cur >= d.count) return prev // already complete — no-op (long-press row to reset)
      const next = cur + 1
      // Haptics: light tick per tap; strong success buzz when the goal is reached.
      if (next >= d.count) success()
      else tick()
      return { ...prev, [period]: { ...prev[period], [d.id]: next } }
    })
  }

  const resetOne = (d) => {
    setToday(prev => ({ ...prev, [period]: { ...prev[period], [d.id]: 0 } }))
  }

  return (
    <div className="adhkar-view">
      <div className="quran-browse-header">
        <button className="quran-browse-back" onClick={onBack}>← Back</button>
        <span className="quran-browse-title">Adhkar</span>
        <span className="quran-browse-back" style={{ visibility: 'hidden' }}>←</span>
      </div>

      <div className="adhkar-toggle">
        {[['morning', '🌅 Morning'], ['evening', '🌆 Evening']].map(([p, label]) => (
          <button key={p} className={`seg-btn ${period === p ? 'seg-active' : ''}`} onClick={() => setPeriod(p)}>
            {label}
          </button>
        ))}
      </div>

      <div className="adhkar-progress-row">
        <div className="goalread-progress-track">
          <div
            className={`goalread-progress-fill${doneCount === list.length ? ' goalread-progress-done' : ''}`}
            style={{ width: `${Math.round((doneCount / Math.max(1, list.length)) * 100)}%` }}
          />
        </div>
        <span className="goalread-progress-label">
          {doneCount === list.length ? '✓ Complete' : `${doneCount} / ${list.length}`}
        </span>
      </div>

      <div className="adhkar-scroll">
        {list.map(d => {
          const cur = counts[d.id] || 0
          const done = cur >= d.count
          return (
            <div key={d.id} className={`adhkar-card${done ? ' adhkar-done' : ''}`} onClick={() => tap(d)}>
              <div className="adhkar-head">
                <span className="adhkar-title">{d.title}</span>
                <button
                  className={`adhkar-count${done ? ' adhkar-count-done' : ''}`}
                  onClick={e => { e.stopPropagation(); done ? resetOne(d) : tap(d) }}
                  title={done ? 'Tap to reset' : 'Tap to count'}
                >{done ? '✓' : `${cur} / ${d.count}`}</button>
              </div>
              <p className="adhkar-ar" dir="rtl" style={{ fontSize: fontStyle?.arabic }}>{d.arabic}</p>
              <p className="adhkar-en" style={{ fontSize: fontStyle?.english }}>{d.translation}</p>
              <p className="adhkar-src">{d.source}{d.count > 1 ? ` · ×${d.count}` : ''}</p>
            </div>
          )
        })}
        <p className="adhkar-hint">Tap a card (or its counter) each time you recite. Counts reset each day.</p>
      </div>
    </div>
  )
}
