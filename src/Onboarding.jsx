import { useState } from 'react'
import { Icons } from './utils/icons'

// First-run walkthrough. Shown once (App.jsx gates on a localStorage flag), and the
// same content is reachable any time from Settings → Help via <HelpContent/>.
//
// Icons are inline SVG (from src/utils/icons.jsx). We do NOT use emoji here — iOS
// WKWebView's system-font fallback renders some emoji as a missing-glyph placeholder.

const SLIDES = [
  {
    icon: <Icons.Welcome />,
    title: 'Welcome to Noor',
    body: 'Your offline companion for Quran, Hadith, khutbahs and daily worship — most of it works with no internet at all.',
  },
  {
    icon: <Icons.Quran />,
    title: 'The Quran tab',
    body: 'Open it for four things: Read with translation, a full Arabic-only Mushaf, daily & sunnah Goals, and Detect — which follows your recitation live.',
  },
  {
    icon: <Icons.Detect />,
    title: 'Detect during Salah',
    body: 'Tap Detect, start reciting, and Noor tracks the verses and rak\'ahs. On Samsung phones, tap “Allow” on the background banner the first time — otherwise the phone stops tracking when the screen is off.',
  },
  {
    icon: <Icons.Maktaba />,
    title: 'Maktaba library',
    body: 'Search the Quran & authentic hadith, or browse whole books hadith-by-hadith. Turn on ✨ Smart to search meanings and name variants (Satan → Shaitan, Iblis…).',
  },
  {
    icon: <Icons.Mosque />,
    title: 'Prayer times & Home',
    body: 'Set your city in Settings to get prayer times, reminders and the qibla. Your Home screen brings today together — next prayer, your reading streak (miss a day and it survives; two days in a row resets it), and where you left off.',
  },
]

export default function Onboarding({ onDone }) {
  const [i, setI] = useState(0)
  const last = i === SLIDES.length - 1
  const s = SLIDES[i]
  return (
    <div className="onboard-overlay">
      <div className="onboard-card">
        <button className="onboard-skip" onClick={onDone}>Skip</button>
        <div className="onboard-icon">{s.icon}</div>
        <h2 className="onboard-title">{s.title}</h2>
        <p className="onboard-body">{s.body}</p>
        <div className="onboard-dots">
          {SLIDES.map((_, k) => <span key={k} className={`onboard-dot${k === i ? ' onboard-dot-on' : ''}`} />)}
        </div>
        <div className="onboard-actions">
          {i > 0 && <button className="onboard-back" onClick={() => setI(i - 1)}>Back</button>}
          <button className="onboard-next" onClick={() => last ? onDone() : setI(i + 1)}>
            {last ? 'Get started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

const FAQ = [
  {
    q: 'Detection stops when my screen is off during Salah',
    a: 'Open Detect and tap “Allow” on the amber banner to exempt Noor from battery optimisation. On Samsung: Settings → Battery → Background usage limits → make sure Noor is NOT in “Sleeping/Deep sleeping apps”.',
  },
  {
    q: 'How do I get prayer times?',
    a: 'Settings → Prayer Times → choose your city (or enter coordinates). Times are calculated on-device and work offline. Pick your calculation method and Asr (Hanafi/Shafi) there too.',
  },
  {
    q: 'Are the hadith authentic?',
    a: 'Maktaba shows the collection and authenticity grade (Sahih/Hasan/etc.) for each hadith. AI analysis is a study aid, not a fatwa — it can make mistakes, so verify anything important with a scholar.',
  },
  {
    q: 'Does it work without internet?',
    a: 'Reading, search, prayer times, qibla and recitation detection are all offline. Only AI analysis and live khutbah translation need a connection.',
  },
  {
    q: 'How do the Goals turn green?',
    a: 'Open a goal (e.g. Surah Al-Kahf), read through to its last ayah, and tap Finish — it turns green for the day. The daily verse goal fills as you read in the Quran tab. Your streak is lenient: miss one day and it survives; two days in a row resets it.',
  },
]

export function HelpContent() {
  const [open, setOpen] = useState(-1)
  return (
    <div className="help-content">
      {FAQ.map((f, i) => (
        <div key={i} className={`help-item${open === i ? ' help-open' : ''}`}>
          <button className="help-q" onClick={() => setOpen(open === i ? -1 : i)}>
            <span>{f.q}</span>
            <span className="help-chevron">{open === i ? '−' : '+'}</span>
          </button>
          {open === i && <p className="help-a">{f.a}</p>}
        </div>
      ))}
    </div>
  )
}
