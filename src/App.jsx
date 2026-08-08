import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ErrorBoundary from './ErrorBoundary'
import './App.css'
import './App-ipad.css'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { SherpaSTT } from './plugins/SherpaSTT'
import { AppleSTT } from './plugins/AppleSTT'
import HomePanel from './HomePanel'
import AdhkarPanel from './AdhkarPanel'
import FamilySettings from './FamilySettings'
import Onboarding, { HelpContent } from './Onboarding'
// Heavy tabs are React.lazy so they ship as separate chunks and don't inflate
// the initial bundle — ReferenceMode + QuranMode + QiblaCompass together were
// the lion's share of the initial JS pause on iPad.
const QuranMode     = lazy(() => import('./QuranMode'))
const ReferenceMode = lazy(() => import('./ReferenceMode'))
const QiblaCompass  = lazy(() => import('./QiblaCompass'))
import PrayerLocationSettings from './PrayerLocationSettings'
import { getLocalLogUri, clearLocalLogs, logKhutbah, logApp } from './utils/logger'
import { Icons } from './utils/icons'
import { getDeviceId } from './utils/device'
import { apiFetch } from './utils/net'
import { showToast, showConfirm } from './utils/toast'
import { refreshReminders, refreshPrayerReminders, refreshFastingReminders } from './utils/notify'
import { syncProgress } from './utils/streak'
import { runBackHandlers } from './utils/backstack'
import { App as CapApp } from '@capacitor/app'
import { ScribeSession } from './utils/scribeSTT'
import { filterTranscript } from './utils/sttSanity'
import { matchQuranQuote, primeQuranMatchCache } from './utils/quranMatch'
import { getQuranVerses } from './utils/quranStore'
import { checkDuaTransition, isCurrentlyDua, resetDuaState } from './utils/duaDetector'
import { apiHeaders, getApiBase } from './utils/net'
import DeviceConfirmModal from './components/DeviceConfirmModal'
import {
  detectDevice,
  loadConfirmedDevice,
  saveConfirmedDevice,
  clearConfirmedDevice,
  getDeviceById,
  applyTierClass,
} from './utils/deviceDetect'

const IS_NATIVE = Capacitor.isNativePlatform()
const IS_IOS    = Capacitor.getPlatform() === 'ios'
const API_BASE = getApiBase()
// apiHeaders is now imported from utils/net — breaks the prior circular import
// of the same name from App.jsx into lazy-loaded App children (ReferenceMode).

// PLAN-013.1: module-scope dedup for the kill-switch status check. A useRef
// resets across React 18 StrictMode's `mount → cleanup → mount` cycle in
// dev, which would re-fire `/api/status` twice per session. Don't "modernize"
// back to a ref without verifying dev+StrictMode behavior first. Resets on
// Vite HMR (intentional — fresh module load wants a fresh status check).
let _killSwitchChecked = false

// Scopes every history request to this install so users never see each other's khutbahs.
const DEVICE_ID = getDeviceId()
const hist = (qs = '') => `${API_BASE}/api/history${qs ? `?${qs}&` : '?'}device_id=${encodeURIComponent(DEVICE_ID)}`
// Keep history bounded: warn + auto-prune older entries beyond this many.
const HISTORY_CAP = 50

const SOURCE_LANGS = [
  { code: 'ar-SA', label: 'Arabic (Saudi)' },
  { code: 'ar-EG', label: 'Arabic (Egyptian)' },
  { code: 'ar-MA', label: 'Arabic (Moroccan)' },
  { code: 'ur-PK', label: 'Urdu' },
  { code: 'tr-TR', label: 'Turkish' },
  { code: 'id-ID', label: 'Indonesian' },
]

const LANG_MAP = {
  'ar-SA': 'ar', 'ar-EG': 'ar', 'ar-MA': 'ar',
  'ur-PK': 'ur', 'tr-TR': 'tr', 'id-ID': 'id',
}

const SILENCE_MS = 800
const MAX_CHUNK_MS = 12000

const getFontStyle = (arabicSize = 5, translationSize = arabicSize) => ({
  arabic:  `${(0.6  + (arabicSize - 1) * 0.19).toFixed(2)}rem`,
  english: `${(0.55 + (translationSize - 1) * 0.16).toFixed(2)}rem`,
})

const DEDUP = {
  low:    { window: 8000,  minLen: 20 },
  medium: { window: 20000, minLen: 12 },
  high:   { window: 35000, minLen: 8  },
}

const ls = {
  get: (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb } catch { return fb } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
}

const fmt    = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const fmtDur = s => { const m = Math.floor(s / 60); return m > 0 ? `${m} min` : `${s}s` }

const normalize = row => ({
  id:            row.id,
  date:          row.date_label,
  duration:      row.duration,
  sentenceCount: row.sentence_count,
  arabicText:    row.arabic_text,
  englishText:   row.english_text,
  analysis:      row.analysis,
})  // Render the full history into a readable Markdown document for export-to-device.
function buildHistoryMarkdown(entries) {
  const now = new Date()
  const header = `# Noor — Khutbah History\n\n_Exported ${now.toLocaleString('en-GB')} · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}_\n`
  const blocks = entries.map((e, i) => {
    const parts = [`## ${i + 1}. ${e.date || 'Saved session'}`]
    const meta = []
    if (e.duration) meta.push(`**Duration:** ${fmtDur(e.duration)}`)
    if (e.sentenceCount) meta.push(`**Sentences:** ${e.sentenceCount}`)
    if (meta.length) parts.push(meta.join(' · '))
    if (e.englishText?.trim()) parts.push(`### English\n\n${e.englishText.trim()}`)
    if (e.arabicText?.trim())  parts.push(`### Arabic\n\n${e.arabicText.trim()}`)
    if (e.analysis?.trim())    parts.push(`### AI Analysis\n\n${e.analysis.trim()}`)
    return parts.join('\n\n')
  })
  return [header, ...blocks].join('\n\n---\n\n') + '\n'
}

const renderItalics = (text) => {
  const parts = text.split(/(\*[^*]+\*)/)
  return parts.map((part, i) =>
    part.startsWith('*') && part.endsWith('*') && part.length > 2
      ? <em key={i} className="uncertain">{part.slice(1, -1)}</em>
      : part
  )
}

// renderAIContent lives in utils/renderAI.jsx to avoid a circular import
// (QuranMode + ReferenceMode are React.lazy but used to import back from App).
import { renderAIContent } from './utils/renderAI'

function ReadyModal({ onStart, onSkip }) {
  // Inline SVG icons in place of emoji-as-icons (🕌 🎤 🌟 🔕) so the iOS WKWebView
  // never falls back to a `?` placeholder. Icons auto-scale to the existing
  // `.ready-item-icon { font-size: 1.3rem; }` / `.ready-icon { font-size: 3.2rem; }`
  // via 1em×1em width/height.
  return (
    <div className="ready-screen">
      <div className="ready-top">
        <div className="ready-icon"><Icons.Mosque /></div>
        {/* PLAN-022: dropped the empty <h2> — title was empty placeholder, removed for
            a11y + clean DOM. The mosque icon + `ready-sub` already establish context. */}
        <p className="ready-sub">Quick check before you begin</p>
      </div>
      <div className="ready-items">
        <div className="ready-item ready-item-ok">
          <div className="ready-item-icon"><Icons.Mic /></div>
          <div className="ready-item-info">
            <span className="ready-item-label">Microphone</span>
            <span className="ready-item-status">Ready to record</span>
          </div>
          <div className="ready-check">✓</div>
        </div>
        <div className="ready-item ready-item-ok">
          <div className="ready-item-icon"><Icons.Awake /></div>
          <div className="ready-item-info">
            <span className="ready-item-label">Screen</span>
            <span className="ready-item-status">Will stay awake</span>
          </div>
          <div className="ready-check">✓</div>
        </div>
        <div className="ready-item ready-item-tip">
          <div className="ready-item-icon"><Icons.BellOff /></div>
          <div className="ready-item-info">
            <span className="ready-item-label">Do Not Disturb</span>
            <span className="ready-item-status">Silence notifications for focus</span>
          </div>
        </div>
      </div>
      <div className="ready-actions">
        <button className="ready-btn-start" onClick={onStart}>
          <span>Start Listening</span>
          <span className="ready-btn-arrow">›</span>
        </button>
        <button className="ready-btn-skip" onClick={onSkip}>Skip</button>
      </div>
    </div>
  )
}

const ANALYZE_SIZES = { sm: '0.92rem', md: '1.18rem', lg: '1.5rem' }

function AnalyzeModal({ loading, result, error, onClose, onSave, onShare, onNavigateToQuran, textSize, onTextSize }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal analyze-modal" onClick={e => e.stopPropagation()} style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="quran-analyze-header">
          <button className="quran-analyze-back" onClick={onClose}>← Back</button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span className="quran-analyze-title">AI Analysis</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI-generated — may err. Verify with a scholar.</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {result && onSave && (
              <button className="quran-analyze-share" onClick={onSave} title="Save to History">
                <Icons.Save />
              </button>
            )}
            {result && (
              <button className="quran-analyze-share" onClick={onShare} title="Share">
                <Icons.Share />
              </button>
            )}
          </div>
        </div>
        <div className="analyze-size-bar">
          {[['sm','A'],['md','AA'],['lg','AAA']].map(([s, label]) => (
            <button key={s} className={`analyze-size-btn${textSize === s ? ' analyze-size-active' : ''}`} onClick={() => onTextSize(s)}>{label}</button>
          ))}
        </div>
        <div className="quran-analyze-body" style={{ overflowY: 'auto', padding: '16px' }}>
          {loading && (
            <div className="analyze-loading">
              <div className="spinner" />
              <p>Analyzing…</p>
            </div>
          )}
          {error && <p className="analyze-error">⚠ {error}</p>}
          {result && (
            <div className="quran-analyze-result" style={{ fontSize: ANALYZE_SIZES[textSize] || ANALYZE_SIZES.sm }}>
              {renderAIContent(result, onNavigateToQuran)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ModePicker({ onPick }) {
  // Icons live in JS so `mode-picker-icon` renders the SVG instead of the emoji
  // (which falls back to a `?` placeholder in iOS WKWebView). Icons auto-scale to
  // the existing `.mode-picker-icon { font-size: 1.8rem; }` via 1em×1em width/height.
  const modes = [
    { id: "basic",  Icon: Icons.Sunnah, title: "Basic",  desc: "Khutbah translation + prayer times. Simple and focused.",     features: "Khutbah • Prayers • Quran" },
    { id: "medium", Icon: Icons.Star,   title: "Medium", desc: "Daily readings, streaks, bookmarks, and Maktaba.",            features: "Basic + Maktaba • Streaks • History" },
    { id: "expert", Icon: Icons.Rocket, title: "Expert", desc: "Everything: advanced widgets, family sharing.",               features: "Medium + Widgets • Family" },
  ];
  return (
    <div className="mode-picker-overlay">
      <div className="mode-picker-card">
        <h2 className="mode-picker-title">Welcome to Noor</h2>
        <p className="mode-picker-subtitle">Choose your experience — you can change this anytime in Settings</p>
        <div className="mode-picker-grid">
          {modes.map(m => (
            <button key={m.id} className="mode-picker-option" onClick={() => onPick(m.id)}>
              <span className="mode-picker-icon"><m.Icon /></span>
              <span className="mode-picker-name">{m.title}</span>
              <span className="mode-picker-desc">{m.desc}</span>
              <span className="mode-picker-features">{m.features}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ settings, onChange }) {
  const set = (key, val) => onChange({ ...settings, [key]: val })
  const arSize = settings.fontSizeArabic ?? settings.fontSize ?? 5
  const enSize = settings.fontSizeTranslation ?? settings.fontSize ?? 5
  return (
    <div className="side-panel">
      <h2 className="side-panel-title">Settings</h2>

      {/* 1. Prayer Times & Location (first — new users land here from onboarding) */}
      <PrayerLocationSettings settings={settings} set={set} />

      {/* 2. Reading & Text */}
      <div className="setting-section-divider"><Icons.Quran /> Reading &amp; Text</div>
      <div className="setting-group">
        <label className="setting-label">Arabic Text Size <span className="setting-hint" style={{ display: 'inline', marginLeft: 8 }}>Size {arSize}</span></label>
        <div className="font-size-slider-row">
          <span className="font-size-label-a">ا</span>
          <input type="range" min="1" max="10" step="1" value={arSize} onChange={e => set('fontSizeArabic', Number(e.target.value))} className="font-size-slider" />
          <span className="font-size-label-b" style={{ fontSize: '1.3rem' }}>ا</span>
        </div>
        <p className="font-size-preview" dir="rtl" style={{ fontSize: `${(0.6 + (arSize - 1) * 0.19).toFixed(2)}rem`, fontFamily: "'Amiri', 'Scheherazade New', serif" }}>
          بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
        </p>
      </div>
      <div className="setting-group">
        <label className="setting-label">Translation Text Size <span className="setting-hint" style={{ display: 'inline', marginLeft: 8 }}>Size {enSize}</span></label>
        <div className="font-size-slider-row">
          <span className="font-size-label-a">A</span>
          <input type="range" min="1" max="10" step="1" value={enSize} onChange={e => set('fontSizeTranslation', Number(e.target.value))} className="font-size-slider" />
          <span className="font-size-label-b">A</span>
        </div>
        <p className="font-size-preview" style={{ fontSize: `${(0.55 + (enSize - 1) * 0.16).toFixed(2)}rem` }}>
          In the name of Allah, the Most Gracious, the Most Merciful
        </p>
      </div>
      <div className="setting-group">
        <label className="setting-label">Arabic Script</label>
        <p className="setting-hint">Choose the Quran script style you are most comfortable reading</p>
        <div className="seg-control">
          <button className={`seg-btn ${(settings.quranScript ?? 'uthmani') === 'uthmani' ? 'seg-active' : ''}`} onClick={() => set('quranScript', 'uthmani')}>
            Standard (Uthmani)
          </button>
          <button className={`seg-btn ${settings.quranScript === 'indopak' ? 'seg-active' : ''}`} onClick={() => set('quranScript', 'indopak')}>
            Indo-Pak
          </button>
        </div>
        <p className="setting-hint" style={{ marginTop: 6 }}>
          {(settings.quranScript ?? 'uthmani') === 'uthmani' && 'Gulf/Medina Mushaf style — used in most digital Qurans'}
          {settings.quranScript === 'indopak' && 'South Asian print style — familiar to readers from Pakistan, India & Bangladesh. Downloads ~2 MB on first use.'}
        </p>
      </div>

      {/* 3. Daily Streak */}
      <div className="setting-section-divider"><Icons.Streak /> Daily Streak</div>
      <div className="setting-group">
        <label className="setting-label">Daily Goal</label>
        <p className="setting-hint">Verses to read each day in the Quran tab to keep your streak alive. Miss a single day and your streak survives — two days in a row resets it.</p>
        <div className="seg-control">
          {[5, 10, 20].map(v => (
            <button key={v} className={`seg-btn ${(settings.streakGoal ?? 10) === v ? 'seg-active' : ''}`} onClick={() => set('streakGoal', v)}>
              {v} verses
            </button>
          ))}
        </div>
      </div>
      <div className="setting-group">
        <label className="setting-label">Reading Reminders</label>
        <p className="setting-hint">Gentle nudges at 6 AM, 4 PM &amp; 8 PM (with a motivational quote) if you haven't met today's goal</p>
        <div className="seg-control">
          <button
            className={`seg-btn ${(settings.streakReminders ?? true) ? 'seg-active' : ''}`}
            onClick={() => set('streakReminders', !(settings.streakReminders ?? true))}
          >
            {(settings.streakReminders ?? true) ? 'Reminders: ON' : 'Reminders: OFF'}
          </button>
        </div>
      </div>

      {/* 4. Speech engine (Khutbah + Quran Detect) */}
      <div className="setting-section-divider"><Icons.Mic /> Speech Engine</div>
      <div className="setting-group">
        <label className="setting-label">Cloud vs Local</label>
        <p className="setting-hint">ElevenLabs Scribe v2 Realtime for both Khutbah translation and Quran Detect (best accuracy). Apple Native (iOS/iPadOS) runs via Apple's built-in speech recognition API fully offline. Local Whisper is available on non-iOS devices.</p>
        <div className="seg-control">
          {(IS_IOS ? [['elevenlabs', 'ElevenLabs'], ['apple', 'Apple (Native)']] : [['elevenlabs', 'ElevenLabs'], ['local', 'Local']]).map(([v, label]) => (
            <button key={v} className={`seg-btn ${(settings.sttEngine ?? 'elevenlabs') === v ? 'seg-active' : ''}`} onClick={() => set('sttEngine', v)}>
              {label}
            </button>
          ))}
        </div>
        <p className="setting-hint" style={{ marginTop: 6 }}>
          {(settings.sttEngine ?? 'elevenlabs') === 'elevenlabs'
            ? 'Streams audio to ElevenLabs via a secure token — needs internet. Falls back to on-device if the connection fails.'
            : (settings.sttEngine === 'apple' ? 'Uses Apple native speech recognition on iOS. Can work fully offline if supported by your iOS version.' : 'Runs fully offline using on-device transcription.')}
        </p>
      </div>

      {/* 5. Quran Detection */}
      <div className="setting-section-divider"><Icons.Detect /> Quran Detection</div>
      <div className="setting-group">
        <label className="setting-label">Detection Streams</label>
        <p className="setting-hint">How many recent results vote on the detected surah. Higher = more stable but slower to lock on. 3–5 recommended for noisy environments.</p>
        <div className="seg-control">
          {[1, 2, 3, 4, 5].map(v => (
            <button key={v} className={`seg-btn ${settings.quranStreams === v ? 'seg-active' : ''}`} onClick={() => set('quranStreams', v)}>
              {v}
            </button>
          ))}
        </div>
        <p className="setting-hint" style={{ marginTop: 6 }}>
          {settings.quranStreams === 1 && 'Latest result wins immediately — fastest response'}
          {settings.quranStreams === 2 && 'Both results must agree — strict but fast'}
          {settings.quranStreams === 3 && '2 out of 3 must agree — good balance'}
          {settings.quranStreams === 4 && '3 out of 4 must agree — more stable'}
          {settings.quranStreams === 5 && '3 out of 5 must agree — most stable, slowest to update'}
        </p>
      </div>
      <div className="setting-group">
        <label className="setting-label">Performance Mode</label>
        <p className="setting-hint">Balances battery usage against transcription speed</p>
        <div className="seg-control">
          {[['battery', 'Battery Saver'], ['medium', 'Balanced'], ['high', 'High Performance']].map(([v, label]) => (
            <button key={v} className={`seg-btn ${settings.performanceMode === v ? 'seg-active' : ''}`} onClick={() => set('performanceMode', v)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 5. Khutbah */}
      <div className="setting-section-divider"><Icons.Mosque /> Khutbah</div>
      <div className="setting-group">
        <label className="setting-label">Repeat Filter</label>
        <p className="setting-hint">Controls how aggressively repeated phrases are removed</p>
        <div className="seg-control">
          {[['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([v, label]) => (
            <button key={v} className={`seg-btn ${settings.dedup === v ? 'seg-active' : ''}`} onClick={() => set('dedup', v)}>
              {label}
            </button>
          ))}
        </div>
        <p className="setting-hint" style={{ marginTop: 6 }}>
          {settings.dedup === 'low'    && 'Less filtering — you may see some repeated phrases'}
          {settings.dedup === 'medium' && 'Balanced — recommended for most masjids'}
          {settings.dedup === 'high'   && 'Aggressive — best for very echo-heavy halls'}
        </p>
      </div>

      {/* 6. Advanced */}
      <div className="setting-section-divider"><Icons.Settings /> Advanced</div>
      <div className="setting-group">
        <label className="setting-label">Logging Destination</label>
        <p className="setting-hint">App debug & error logs</p>
        <div className="seg-control">
          {[['off', 'Off'], ['local', 'Device Only'], ['cloud', 'Cloud (Share w/ Dev)'], ['both', 'Both']].map(([v, label]) => (
            <button key={v} className={`seg-btn ${settings.loggingMode === v ? 'seg-active' : ''}`} onClick={() => set('loggingMode', v)}>
              {label}
            </button>
          ))}
        </div>
        {(settings.loggingMode === 'local' || settings.loggingMode === 'both') && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button className="seg-btn" onClick={() => document.dispatchEvent(new Event('show-log-reader'))}>View Logs</button>
            <button className="seg-btn" onClick={async () => { await clearLocalLogs(); showToast('Local logs cleared', 'success') }}>Clear</button>
          </div>
        )}
      </div>
      <div className="setting-group">
        <label className="setting-label">App Experience</label>
        <p className="setting-hint">Basic = simpler UI. Medium = daily features. Expert = everything. Change anytime.</p>
        <div className="seg-control">
          {[['basic', Icons.Sunnah, 'Basic'], ['medium', Icons.Star, 'Medium'], ['expert', Icons.Rocket, 'Expert']].map(([v, Icon, label]) => (
            <button key={v} className={`seg-btn ${(settings.experienceMode ?? 'basic') === v ? 'seg-active' : ''}`} onClick={() => set('experienceMode', v)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
                <Icon />
                <span>{label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="setting-group">
        <label className="setting-label">Developer Options</label>
        <div className="seg-control">
          <button className={`seg-btn ${settings.debugMode ? 'seg-active' : ''}`} onClick={() => set('debugMode', !settings.debugMode)}>
            {settings.debugMode ? 'Debug Logging: ON' : 'Debug Logging: OFF'}
          </button>
        </div>
        <p className="setting-hint" style={{ marginTop: 6 }}>Enable granular logging for searches, matching scores, and AI responses. Also shows a live detection overlay on the Quran Detect screen (what the mic hears + whether it matched a verse).</p>
      </div>

      {/* 7. Family streaks */}
      <FamilySettings />

      {/* 8. Help */}
      <div className="setting-section-divider"><Icons.Help /> Help</div>
      <div className="setting-group">
        <HelpContent />
        <button className="seg-btn" style={{ marginTop: 12 }} onClick={() => document.dispatchEvent(new Event('replay-onboarding'))}>
          Replay intro tour
        </button>
        {deviceConfirmed && (
          <div className="setting-group" style={{ marginTop: 16 }}>
            <label className="setting-label">
              Device
              <span className="setting-hint" style={{ display: 'inline', marginLeft: 8 }}>
                {deviceConfirmed.name} · {deviceConfirmed.chip} · <span className={`tier-pill tier-${deviceConfirmed.tier}`}>{deviceConfirmed.tier}</span>
              </span>
            </label>
            <p className="setting-hint" style={{ marginBottom: 8 }}>
              Graphics & audio are tuned for this hardware tier. Change if you've moved to a different device.
            </p>
            <div className="seg-control">
              <button className="seg-btn" onClick={() => document.dispatchEvent(new Event('change-device'))}>
                Change device
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryPanel({ history, loaded, onClear, onExport, onAnalyze, onDelete, onShare, onNavigateToQuran }) {
  const [expanded, setExpanded] = useState(null)
  if (!loaded) return <div className="side-panel"><h2 className="side-panel-title">History</h2><p className="history-empty">Loading…</p></div>
  if (history.length === 0) return <div className="side-panel"><h2 className="side-panel-title">History</h2><p className="history-empty">Nothing saved yet.<br />Save an analysis from Khutbah, Quran, or Maktaba and it'll appear here.</p></div>
  return (
    <div className="side-panel">
      <div className="history-top">
        <h2 className="side-panel-title">History</h2>
        <div className="history-top-actions">
          <button className="history-export-btn" onClick={onExport}>Export &amp; clear</button>
          <button className="history-clear-btn" onClick={onClear}>Clear all</button>
        </div>
      </div>
      <div className="history-list">
        {history.map(entry => (
          <div key={entry.id} className="history-entry">
            <div className="history-entry-header" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
              <div>
                <div className="history-date">{entry.date}</div>
                <div className="history-meta">{fmtDur(entry.duration)} • {entry.sentenceCount} sentences</div>
              </div>
              <span className="history-chevron">{expanded === entry.id ? '▲' : '▼'}</span>
            </div>
            {expanded === entry.id && (
              <div className="history-entry-body">
                {entry.analysis ? (
                  <>
                    <div className="history-analysis">{renderAIContent(entry.analysis, onNavigateToQuran)}</div>
                    <button className="history-share-btn" onClick={() => onShare(entry.analysis)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                        <polyline points="16 6 12 2 8 6"/>
                        <line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                      Share Analysis
                    </button>
                  </>
                ) : (
                  <button className="history-analyze-btn" onClick={() => onAnalyze(entry)}>✦ Analyze this khutbah</button>
                )}
                {entry.englishText && <p className="history-preview">{entry.englishText.slice(0, 220)}…</p>}
                <button className="history-delete-btn" onClick={() => onDelete(entry.id)}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function LogReaderModal({ onClose }) {
  const [logs, setLogs] = useState([])
  const [rawLogs, setRawLogs] = useState('')

  useEffect(() => {
    try {
      const existing = localStorage.getItem('app_local_logs')
      if (existing) {
        const parsed = JSON.parse(existing)
        setLogs(parsed)
        setRawLogs(parsed.join('\n'))
      } else {
        setLogs(['No logs found.'])
        setRawLogs('No logs found.')
      }
    } catch {
      setLogs(['Error reading logs.'])
      setRawLogs('Error reading logs.')
    }
  }, [])

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(rawLogs)
      } else {
        const el = document.createElement('textarea')
        el.value = rawLogs
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      showToast('Logs copied to clipboard', 'success')
    } catch (err) {
      showToast('Failed to copy logs', 'error')
    }
  }

  return (
    <div className="log-reader-overlay">
      <div className="log-reader-modal">
        <div className="log-reader-header">
          <h3>Device Logs</h3>
          <button onClick={onClose} className="log-reader-close">X</button>
        </div>
        <div className="log-reader-body">
          <pre style={{ margin: 0, padding: 0 }}>
            {logs.map((line, idx) => {
              let color = 'var(--text)'
              if (line.includes('[KHUTBAH]')) color = '#4ade80' // Green
              else if (line.includes('[QURAN]')) color = '#22d3ee' // Cyan
              else if (line.includes('[MAKTABA]')) color = '#facc15' // Yellow
              else if (line.includes('[APP]')) color = '#a78bfa' // Purple

              if (line.includes('[ERROR]')) color = '#f87171' // Red override for errors
              if (line.includes('[WARN]')) color = '#fb923c' // Orange override for warnings

              return <div key={idx} style={{ color }}>{line}</div>
            })}
          </pre>
        </div>
        <div className="log-reader-footer">
          <button onClick={handleCopy} className="history-analyze-btn">Copy to Clipboard</button>
        </div>
      </div>
    </div>
  )
}  function ToastHost() {
    const [toasts, setToasts]   = useState([])
    const [confirm, setConfirm] = useState(null)
    // PLAN-005: track every pending auto-dismiss setTimeout id so we can
    // clearTimeout them all in the useEffect cleanup. Without this, a toast
    // outliving ToastHost's unmount would call setToasts on an unmounted
    // component (React warning + tiny memory leak per toast).
    const toastTimerIdsRef = useRef(new Set())

    useEffect(() => {
      const onToast = (e) => {
        const { message, type = 'info', duration = 3200 } = e.detail || {}
        const id = Date.now() + Math.random()
        setToasts(prev => [...prev, { id, message, type }])
        const timerId = setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== id))
          toastTimerIdsRef.current.delete(timerId)
        }, duration)
        toastTimerIdsRef.current.add(timerId)
      }
        const onConfirm = (e) => setConfirm(e.detail)
        window.addEventListener('app-toast', onToast)
        window.addEventListener('app-confirm', onConfirm)
        return () => {
          window.removeEventListener('app-toast', onToast)
          window.removeEventListener('app-confirm', onConfirm)
          // Cancel every pending toast auto-dismiss timer so the closure can't
          // call setToasts on an unmounted component.
          for (const id of toastTimerIdsRef.current) clearTimeout(id)
          toastTimerIdsRef.current.clear()
        }
    }, [])

  const resolveConfirm = (result) => {
    if (confirm) window.dispatchEvent(new CustomEvent('app-confirm-result', { detail: { id: confirm.id, result } }))
    setConfirm(null)
  }

  return (
    <>
      {toasts.length > 0 && (
        <div className="toast-host" role="status" aria-live="polite">
          {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
        </div>
      )}
      {confirm && (
        <div className="modal-overlay confirm-overlay" onClick={() => resolveConfirm(false)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
            {confirm.title && <h3 className="confirm-title">{confirm.title}</h3>}
            {confirm.message && <p className="confirm-message">{confirm.message}</p>}
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => resolveConfirm(false)}>{confirm.cancelLabel || 'Cancel'}</button>
              <button className={`confirm-ok${confirm.danger ? ' confirm-danger' : ''}`} onClick={() => resolveConfirm(true)} autoFocus>{confirm.confirmLabel || 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function App() {
  // Kill-switch: null = checking, true = open, false = disabled
  const [appStatus, setAppStatus] = useState(null)
  const [appStatusMsg, setAppStatusMsg] = useState('')

  const [phase, setPhase]             = useState('idle')
  const [quranMicActive, setQuranMicActive] = useState(false)
  const [view, setView]               = useState('home')
  const [quranTarget, setQuranTarget] = useState(null)
  const [quranOpenView, setQuranOpenView] = useState(null) // intent from Home: 'read' | 'goals' | ...
  // Memoised prop for QuranMode so its targetVerse effect (which lists this in deps)
  // doesn't re-fire on every App.jsx render. setQuranTarget is already stable across
  // renders, so this useCallback is just pinning the arrow reference.
  const consumeTargetVerse = useCallback(() => setQuranTarget(null), [])
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !localStorage.getItem('noor-onboarded') } catch { return false }
  })
  const backExitRef = useRef(0) // timestamp of last "press back again to exit"
  const [processing, setProcessing]   = useState(false)
  const [feed, setFeed]               = useState([])
  const [sourceLang, setSourceLang]   = useState('ar-SA')
  const [elapsed, setElapsed]         = useState(0)
  const [error, setError]             = useState('')
  const [supported, setSupported]     = useState(true)
  // Fix #12: cache the localStorage read once so neither settings nor
  // showModePicker re-parses the same JSON blob.
  const savedSettings = useMemo(() => ls.get('khutbah-settings', {}), [])

  const [settings, setSettings]       = useState(() => {
    // Work on a shallow clone so we don't mutate the cached object later.
    const saved = { ...savedSettings }
    // migrate old string values to number scale
    if (saved.fontSize === 'small')  saved.fontSize = 3
    if (saved.fontSize === 'medium') saved.fontSize = 4
    if (saved.fontSize === 'large')  saved.fontSize = 5
    // Google STT was removed — fold any saved 'google' mode back to on-device
    if (saved.quranSttMode === 'google') saved.quranSttMode = 'off'
    delete saved.quranGoogleApiKey
    try { localStorage.removeItem('quran-google-api-key') } catch {}
    // Unified speech engine (Khutbah + Quran Detect)
    if (!saved.sttEngine) {
      saved.sttEngine = saved.quranSttMode === 'cloudflare' ? 'elevenlabs' : 'local'
    }
    // Coerce stale 'local' to ElevenLabs on iOS since Local Whisper (Sherpa) isn't supported yet. Apple Native is allowed.
    if (IS_IOS && saved.sttEngine === 'local') saved.sttEngine = 'elevenlabs'
    // Split the old single font size into separate Arabic / translation sizes.
    if (typeof saved.fontSize === 'number') {
      if (saved.fontSizeArabic === undefined) saved.fontSizeArabic = saved.fontSize
      if (saved.fontSizeTranslation === undefined) saved.fontSizeTranslation = saved.fontSize
    }
    return { fontSize: 5, fontSizeArabic: 5, fontSizeTranslation: 5, dedup: 'medium', performanceMode: 'medium', loggingMode: 'off', debugMode: false, sttEngine: 'elevenlabs', quranSttMode: 'off', quranStreams: 1, quranScript: 'uthmani', streakReminders: true, streakGoal: 10, location: null, prayerMethod: 'NorthAmerica', prayerMadhab: 'shafi', prayerReminders: true, fastingReminders: true, experienceMode: null, tempUnit: 'c', ...saved }
  })
  const [history, setHistory]         = useState([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [analyze, setAnalyze]         = useState({ open: false, loading: false, result: null, error: null, forEntryId: null })
  const [analyzeTextSize, setAnalyzeTextSize] = useState(() => ls.get('analyze-text-size', 'sm'))
  const setAnalyzeTextSizePersist = useCallback((s) => { setAnalyzeTextSize(s); ls.set('analyze-text-size', s) }, [])
  const [showLogReader, setShowLogReader] = useState(false)
  // NAV-028: when Settings → "Change device" is tapped we want the modal to
  // reopen. Listen on the document event so SettingsPanel (inside deep
  // children) can dispatch without prop-drilling.
  useEffect(() => {
    const handler = () => { setForceDevicePicker(true); setDeviceConfirmed(null) }
    document.addEventListener('change-device', handler)
    return () => document.removeEventListener('change-device', handler)
  }, [])
  const [showModePicker, setShowModePicker] = useState(() => !savedSettings.experienceMode)
  // PLAN-028: first-launch device confirmation. Persisted under
  // 'noor-device-confirmed' via loadConfirmedDevice() so the modal only
  // shows on truly first-run or after Settings → "Change device". The
  // detected shape is the catalog entry the picker resolves to (id + tier).
  //
  // The useState lazy initializer also applys the tier class SYNC (before
  // first paint). Without this, an iPad 9 user sees the modal first with
  // backdrop-filter: blur(16px) (its own CSS uses it), because the tier
  // class wouldn't land until AFTER the user confirmed. that's the exact
  // GPU bottleneck the tier system is meant to avoid. Falls back to
  // detected (best-guess) tier when LS is empty so first-launch still gets
  // the right perf knobs.
  const [deviceConfirmed, setDeviceConfirmed] = useState(() => {
    const saved = loadConfirmedDevice()
    // applyTierClass itself guards against undefined document/body, so a throw
    // here would only happen if the body classList is mid-mutation when the JS
    // bundle evaluates. Surface those via logApp (gated by logger settings) —
    // silent swallow would hide the failure mode from the device-log reader.
    try { applyTierClass(saved?.tier || detectDevice()?.tier) }
    catch (e) { logApp('WARN', 'applyTierClass failed in lazy init', e) }
    return saved
  })
  // Forces the modal to open at the picker stage (skips the confirm stage)
  // even after a prior confirmation — used by Settings → "Change device".
  const [forceDevicePicker, setForceDevicePicker] = useState(false)
  // Mirror the tier into a ref so the audio-record hot path (setInterval
  // reading every 120ms during REC) can pick a cadence without re-rendering.
  const deviceTierRef = useRef(deviceConfirmed?.tier || null)
  deviceTierRef.current = deviceConfirmed?.tier || null
  const streamRef        = useRef(null)
  // PLAN-013.1: dedup now lives at module scope (see `_killSwitchChecked`
  // declaration above the component). The useRef pattern broke under React 18
  // StrictMode's double-mount in dev — each fresh mount got a brand-new ref,
  // defeating the dedup. The module-scope boolean survives component-instance
  // churn within a session.

  useEffect(() => {
    const handler = () => setShowLogReader(true)
    document.addEventListener('show-log-reader', handler)
    const replay = () => setShowOnboarding(true)
    document.addEventListener('replay-onboarding', replay)
    return () => {
      document.removeEventListener('show-log-reader', handler)
      document.removeEventListener('replay-onboarding', replay)
    }
  }, [])

  // PLAN-028: tier-based body class — drives per-tier CSS knobs in App.css
  // (`body.tier-high / .tier-medium / .tier-low`). The biggest iPad-9 wins
  // sit in the CSS overrides (backdrop-blur: none, reduced animation timing,
  // thinner modal shadows). The body-class swap is idempotent — applyTierClass
  // removes all three tier classes first, so a tier-medium → tier-high swap
  // never leaves a stale class behind.
  //
  // Still runs on every render where deviceConfirmed?.tier changes. Falls
  // back to detected tier when user hasn't confirmed yet, so the modal sits
  // on top of correctly-tuned UI from the very first frame.
  useEffect(() => {
    applyTierClass(deviceConfirmed?.tier || detectDevice()?.tier)
  }, [deviceConfirmed?.tier])

  // Kill-switch: check on every launch. Fail open on network error so a Cloudflare
  // hiccup never locks family members out. Resolves within 4 s either way.
  //
  // Migrated to apiFetch (PLAN-013). `retries: 0` (explicit, not the apiFetch default 1)
  // because the kill-switch is intentionally a 4 s hard ceiling — retrying a status
  // endpoint for +600 ms + 4 s would defeat the point of the fast-fail. The 4 s timeout
  // shape matches the original AbortController path byte-for-byte.
  //
  // HMR caveat: there is intentionally no useEffect cleanup here. App.jsx is the root
  // component, unmounted only on full app kill — and apiFetch self-cleans its inner
  // AbortController + setTimeout in finally. The acceptable trade-off is the ~4 s
  // window between apiFetch start and finish during which a Vite HMR re-mount could
  // race a setAppStatus call; in dev only, the worst-case symptom is the loading
  // screen appearing twice. Not worth the explicit AbortController wiring.
  useEffect(() => {
    const runFetch = () => {
      // HMR/StrictMode-safe dedup — PLAN-013.1 uses module-scope variable
      // (see top of file) so React 18 StrictMode's mount → cleanup → mount
      // cycle in dev still only fires /api/status once.
      if (_killSwitchChecked) return
      _killSwitchChecked = true
      apiFetch(API_BASE + '/api/status', {}, { timeoutMs: 4000, retries: 0 })
        .then(r => {
          // PLAN-013: route 4xx/5xx through the .catch path so an empty-body
          // 5xx doesn't silently fail-open via `{}` → undefined !== false. Identical
          // user-visible behavior (fail-open either way), but cleaner trace.
          if (!r.ok) throw new Error(`status HTTP ${r.status}`)
          return r.json()
        })
        .then(d => {
          setAppStatusMsg(d.message || '')
          setAppStatus(d.enabled !== false)
        })
        .catch(() => { setAppStatus(true) })
    }
    // Defer the network hit so first paint isn't blocked on a status check;
    // the 4 s floor timeout still bounds how long the canvas-loading screen
    // can hold the UI.
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(runFetch, { timeout: 800 })
    } else {
      setTimeout(runFetch, 0)
    }
  }, [])
  const recorderRef      = useRef(null)
  const chunkTimerRef    = useRef(null)
  const startChunkRef    = useRef(null)
  const isListeningRef   = useRef(false)
  const wakeLockRef      = useRef(null)
  const recentPhrasesRef = useRef([])
  const recentContextRef = useRef([])
  const elapsedRef       = useRef(null)
  const feedContainerRef = useRef(null)
  const dedupRef         = useRef(DEDUP[settings.dedup])
  const sourceLangRef    = useRef(sourceLang)
  const pendingRef       = useRef(0)
  const audioCtxRef      = useRef(null)
  const analyserRef      = useRef(null)
  const sessionTokenRef  = useRef(null)
  const [modelReady, setModelReady] = useState(false)
  const modelReadyRef = useRef(false)
  const [modelDownloading, setModelDownloading] = useState(false)
  const [downloadPct, setDownloadPct] = useState(0)
  // COST NOTE: sessionSummaryRef sends up to ~1500 chars of accumulated English translation
  // with every translate request (~300 extra tokens per call). To revert: remove sessionSummaryRef,
  // remove session_context from the translate() fetch body, and remove the session_context block
  // in functions/api/translate.js. Also revert previous_context slice back from 5 to 3.
  const sessionSummaryRef = useRef('')
  const scribeRef          = useRef(null)
  const sttEngineRef       = useRef('elevenlabs')
  const sourceLangShort = SOURCE_LANGS.find(l => l.code === sourceLang)?.label.split(' ')[0] ?? 'Arabic'
  const fontStyle = getFontStyle(settings.fontSizeArabic ?? settings.fontSize ?? 5, settings.fontSizeTranslation ?? settings.fontSize ?? 5)
  const isActive  = phase === 'listening' || phase === 'paused'
  const currentMode = settings.experienceMode || "basic"
  useEffect(() => { dedupRef.current = DEDUP[settings.dedup] }, [settings.dedup])
  useEffect(() => { sourceLangRef.current = sourceLang }, [sourceLang])
  useEffect(() => { sttEngineRef.current = settings.sttEngine ?? 'elevenlabs' }, [settings.sttEngine])
  useEffect(() => { ls.set('khutbah-settings', settings) }, [settings])
  useEffect(() => {
    // Don't compete with first paint on slow devices — wait for an idle slot
    // (floor 1.5 s) before warming the quran-match cache.
    let handleId
    const run = () => { getQuranVerses().then(v => primeQuranMatchCache(v)).catch(() => {}) }
    if ('requestIdleCallback' in window) {
      handleId = window.requestIdleCallback(run, { timeout: 1500 })
    } else {
      handleId = setTimeout(run, 0)
    }
    return () => {
      if (handleId == null) return
      if ('cancelIdleCallback' in window && typeof handleId === 'number') {
        window.cancelIdleCallback(handleId)
      } else {
        clearTimeout(handleId)
      }
    }
  }, [])
  // Daily streak: keep reminder notifications in sync with the toggle/goal, and
  // mirror today's progress to the cloud on open. Runs on mount and on change.
  useEffect(() => {
    const enabled = settings.streakReminders ?? true
    const goal = settings.streakGoal ?? 10
    refreshReminders({ enabled, goal })
    syncProgress(goal)
  }, [settings.streakReminders, settings.streakGoal])

  // Keep prayer-time reminders in sync with location / method / toggle.
  useEffect(() => {
    refreshPrayerReminders({
      enabled: settings.prayerReminders ?? true,
      location: settings.location || null,
      method: settings.prayerMethod || 'NorthAmerica',
      madhab: settings.prayerMadhab || 'shafi',
      city: settings.location?.city,
    })
  }, [settings.prayerReminders, settings.location, settings.prayerMethod, settings.prayerMadhab])

  // Sunnah fasting-day reminders (white days, Ashura, Arafah, Shawwal — no Mon/Thu).
  useEffect(() => {
    refreshFastingReminders({ enabled: settings.fastingReminders ?? true })
  }, [settings.fastingReminders])

  const dismissOnboarding = () => {
    try { localStorage.setItem('noor-onboarded', '1') } catch {}
    setShowOnboarding(false)
  }

  // Navigation from the Home dashboard (some destinations open a Quran sub-view).
  const goFromHome = useCallback((dest) => {
    switch (dest) {
      case 'quran':  setQuranOpenView('read');  setView('quran'); break
      case 'goals':  setQuranOpenView('goals'); setView('quran'); break
      case 'qibla':  setView('qibla'); break
      case 'maktaba': setView('maktaba'); break
      case 'settings': setView('settings'); break
      case 'prayers': break // prayer card is informational
      default: setView(dest)
    }
  }, [])

  // ── Hardware back button ────────────────────────────────────────────────────
  // Adding a backButton listener disables Capacitor's default (exit). We pop the
  // deepest open thing first, then fall back to Home, then double-press to exit.
  const handleHardwareBack = () => {
    if (showOnboarding) { dismissOnboarding(); return }
    if (analyze.open) { setAnalyze(p => ({ ...p, open: false })); return }
    if (showLogReader) { setShowLogReader(false); return }
    if (runBackHandlers()) return                 // Quran/Maktaba sub-views & modals
    if (view === 'qibla') { setView('home'); return }
    if (view !== 'home') { setView('home'); return }
    const now = Date.now()
    if (now - backExitRef.current < 2000) { try { CapApp.exitApp() } catch {} }
    else { backExitRef.current = now; showToast('Press back again to exit', 'info', 2000) }
  }
  const backHandlerRef = useRef(() => {})
  backHandlerRef.current = handleHardwareBack
  useEffect(() => {
    if (!IS_NATIVE) return
    let sub
    CapApp.addListener('backButton', () => backHandlerRef.current()).then(l => { sub = l }).catch(() => {})
    return () => { try { sub?.remove() } catch {} }
  }, [])
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setSupported(false)
    }
  }, [])

  // Load history from D1 on mount, migrate any localStorage entries first
  useEffect(() => {
    const load = async () => {
      try {
        // Migrate old localStorage history if present
        const local = ls.get('khutbah-history', [])
        if (local.length > 0) {
          for (const e of local) {
            await apiFetch(API_BASE + '/api/history', {
              method: 'POST',
              headers: apiHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({
                date_label:     e.date,
                duration:       e.duration,
                sentence_count: e.sentenceCount,
                arabic_text:    e.arabicText,
                english_text:   e.englishText,
                analysis:       e.analysis ?? null,
                device_id:      DEVICE_ID,
              }),
            }, { retries: 0 }).catch(() => {})
          }
          ls.set('khutbah-history', [])
        }

        const res = await apiFetch(hist('limit=100'), { headers: apiHeaders() }, { timeoutMs: 12000, retries: 1 })
        const data = await res.json()
        let sessions = (data.sessions ?? []).map(normalize)
        const total = data.total ?? sessions.length

        // History cap: warn, then auto-prune the oldest entries beyond HISTORY_CAP.
        if (total > HISTORY_CAP) {
          apiFetch(hist(`prune=${HISTORY_CAP}`), { method: 'DELETE', headers: apiHeaders() }, { retries: 0 }).catch(() => {})
          sessions = sessions.slice(0, HISTORY_CAP)
          showToast(`You had ${total} saved khutbahs — keeping the ${HISTORY_CAP} most recent and removing older ones.`, 'warn', 5500)
        }
        setHistory(sessions)
      } catch (e) {
        logApp('ERROR', 'Failed to load history', e)
      }
      setHistoryLoaded(true)
    }
    load()
  }, [])

  // Session timer
  useEffect(() => {
    if (phase === 'listening') {
      elapsedRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    } else {
      clearInterval(elapsedRef.current)
    }
    return () => clearInterval(elapsedRef.current)
  }, [phase])

  // Auto-scroll feed
  useEffect(() => {
    feedContainerRef.current?.scrollTo({ top: feedContainerRef.current.scrollHeight, behavior: 'smooth' })
  }, [feed, processing])

  const translate = useCallback(async (text, id, audioKey = null) => {
    setFeed(prev => prev.map(f => f.id === id ? { ...f, pending: true, failed: false } : f))
    try {
      const res = await apiFetch(API_BASE + '/api/translate', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          text,
          session_token: sessionTokenRef.current,
          source_lang: sourceLangRef.current,
          audio_key: audioKey,
          previous_context: recentContextRef.current.slice(-5),
          session_context: sessionSummaryRef.current.slice(-1500) || undefined,
        }),
      }, { timeoutMs: 20000, retries: 1 })
      const data = await res.json()
      if (!res.ok) setError(data.error || `Error ${res.status}`)
      const translation = data.translation || ''
      if (!translation) {
        // [SKIP] or refusal — drop silently so the user never sees AI complaints
        setFeed(prev => prev.filter(f => f.id !== id))
        return
      }
      setFeed(prev => prev.map(f => f.id === id ? { ...f, english: translation, pending: false, failed: false } : f))
      recentContextRef.current.push({ arabic: text, english: translation })
      if (recentContextRef.current.length > 12) recentContextRef.current = recentContextRef.current.slice(-6)
      // PLAN-024 (Bug #8): bound sessionSummaryRef growth on-device. The
      // /api/translate payload slices to the LAST 1500 chars before sending, but
      // the in-memory ref used to grow unbounded — a long Friday khutbah could
      // pin tens of KB of English translation in memory. Cap at 2x the API
      // slice so the top of the window stays the same content shipped + a little
      // overhead for the in-flight translation that hasn't been slice'd yet.
      sessionSummaryRef.current = (sessionSummaryRef.current
        ? sessionSummaryRef.current + ' ' + translation
        : translation).slice(-3000)
    } catch (err) {
      setError(`Network error: ${err.message}`)
      setFeed(prev => prev.map(f => f.id === id ? { ...f, english: '', pending: false, failed: true } : f))
    }
  }, [])

  const retryTranslate = useCallback((item) => {
    translate(item.arabic, item.id, item.audioKey ?? null)
  }, [translate])

  const commitPhrase = useCallback(async (phrase, audioKey = null) => {
    if (!isListeningRef.current) return
    const lang = LANG_MAP[sourceLangRef.current] || 'ar'
    const normalized = filterTranscript(phrase, { lang })
    if (!normalized) return
    const duaT = checkDuaTransition(normalized)
    if (duaT === 'enter') {
      setFeed(prev => [...prev, { id: 'dua-divider-' + Date.now(), isDuaDivider: true, kind: 'dua', text: 'Du’ā' }])
    } else if (duaT === 'exit') {
      setFeed(prev => [...prev, { id: 'khutbah-resume-' + Date.now(), isDuaDivider: true, kind: 'khutbah', text: 'Resumes khutbah' }])
    }
    const now = Date.now()
    const { window: win, minLen } = dedupRef.current
    recentPhrasesRef.current = recentPhrasesRef.current.filter(p => now - p.at < win)
    const isDupe = recentPhrasesRef.current.some(p => {
      if (p.text === normalized) return true
      const a = p.text.length < normalized.length ? p.text : normalized
      const b = p.text.length < normalized.length ? normalized : p.text
      return b.includes(a) && a.length > minLen
    })
    if (isDupe) return
    recentPhrasesRef.current.push({ text: normalized, at: now })

    // Quran-quote splicing: replace garbled ASR with canonical ayah text when confident
    const quote = await matchQuranQuote(normalized)
    if (quote && quote.score >= 0.5 && quote.arabic) {
      const id = Date.now() + Math.random()
      const english = quote.english
        ? `📖 ${quote.surahName} ${quote.surah}:${quote.ayah} — ${quote.english}`
        : `📖 ${quote.surahName} ${quote.surah}:${quote.ayah}`
      setFeed(prev => [...prev, { id, arabic: quote.arabic, english, pending: false, failed: false, audioKey, isQuranQuote: true }])
      recentContextRef.current.push({ arabic: quote.arabic, english })
      if (recentContextRef.current.length > 12) recentContextRef.current = recentContextRef.current.slice(-6)
      sessionSummaryRef.current = (sessionSummaryRef.current
        ? sessionSummaryRef.current + ' ' + english
        : english).slice(-3000)
      return
    }

    const id = Date.now() + Math.random()
    setFeed(prev => [...prev, { id, arabic: normalized, english: null, pending: true, failed: false, audioKey, isDua: isCurrentlyDua() }])
    translate(normalized, id, audioKey)
  }, [translate])

  const sendChunk = useCallback(async (blob) => {
    pendingRef.current++
    setProcessing(true)
    try {
      const lang = LANG_MAP[sourceLangRef.current] || 'ar'
      const arrayBuffer = await blob.arrayBuffer()
      const transcribeUrl = `${API_BASE}/api/transcribe?lang=${lang}&session_token=${sessionTokenRef.current}&debug=${(settings.loggingMode === 'cloud' || settings.loggingMode === 'both') ? 'true' : 'false'}`
      const res = await apiFetch(transcribeUrl, {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': blob.type || 'audio/webm' }),
        body: arrayBuffer,
      }, { timeoutMs: 25000, retries: 1 })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `Transcription error ${res.status}`)
        return
      }
      if (data.text) {
        const filtered = filterTranscript(data.text, { lang })
        if (filtered) commitPhrase(filtered, data.audio_key ?? null)
        else logKhutbah('WARN', 'Transcript rejected by sanity gate', { lang, text: data.text })
      }
    } catch (err) {
      setError(`Network error: ${err.message}`)
    } finally {
      pendingRef.current--
      if (pendingRef.current === 0) setProcessing(false)
    }
  }, [commitPhrase])

  const acquireWakeLock = async () => {
    // iOS WKWebView has no reliable navigator.wakeLock — use the native
    // KeepAwake plugin there; shim .release() so releaseWakeLock works as-is.
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
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        wakeLockRef.current.addEventListener('release', () => { if (isListeningRef.current) acquireWakeLock() })
      } catch {}
    }
  }
  const releaseWakeLock = () => { wakeLockRef.current?.release(); wakeLockRef.current = null }

  // ── Sherpa-ONNX on-device STT (Whisper small + Silero VAD) ─────────────────

  // Check model status on mount (native only)
  useEffect(() => {
    if (!IS_NATIVE) return
    SherpaSTT.getModelStatus().then(({ downloaded }) => {
      setModelReady(downloaded)
      modelReadyRef.current = downloaded
    }).catch(() => {})
  }, [])

  const downloadSherpaModel = async () => {
    setModelDownloading(true)
    setDownloadPct(0)
    const listener = await SherpaSTT.addListener('downloadProgress', ({ progress }) => {
      setDownloadPct(progress)
    })
    try {
      await SherpaSTT.downloadModel()
      setModelReady(true)
      modelReadyRef.current = true
    } catch (e) {
      const msg = e?.message || e?.toString() || 'Unknown error'
      setError('Model download failed: ' + msg)
    } finally {
      listener.remove()
      setModelDownloading(false)
    }
  }

  const stopScribeListening = async () => {
    if (scribeRef.current) {
      await scribeRef.current.disconnect()
      scribeRef.current = null
    }
  }

  // Bug #H2: takes `isResume` so pause→resume doesn't reset the modal/feed.
  // On a fresh start the modal is dismissed and the session cleared (existing
  // behavior). On resume we leave both alone — the user has an in-flight feed
  // and just wants the mic + WebSocket back. Sync state (phase='listening', wake
  // lock) is set inside this function so the caller doesn't have to.
  // `isFallback`: true when we're entering Scribe because Apple Native STT
  // already failed with AAPLESTT_UNAVAILABLE. Stops the Scribe → Apple ping-pong
  // if Scribe itself fails for the same reason — we then surface a clean error
  // to the user instead of recursing forever.
  const startScribeListening = async (isResume = false, isFallback = false) => {
    if (!isResume) {
      setPhase('idle')
      clearAll()
      // PLAN-024 (Bug #14): clear any stale error from the previous session so the
      // status bar doesn't keep showing "⚠ Could not start…" when the user
      // successfully begins a new listening pass. Keeps the banner truthful.
      setError('')
    }
    try {
      const lang = LANG_MAP[sourceLangRef.current] || 'ar'
      const session = new ScribeSession()
      scribeRef.current = session
      await session.connect({
        languageCode: lang,
        keyterms: ['Allah', 'Muhammad', 'Alhamdulillah', 'SubhanAllah', 'Salah', 'Quran', 'Hadith', 'Jumuah', 'Imam'],
        onCommitted: (text) => { if (isListeningRef.current) commitPhrase(text) },
        onError: (err) => logKhutbah('ERROR', 'Scribe STT', err?.message || err),
        // If server VAD never commits during continuous speech, force a segment every 8s
        // so translations keep flowing.
        commitWatchdogMs: 8000,
      })
      await session.startMicrophone()
      isListeningRef.current = true
      sessionTokenRef.current = Date.now().toString(36) + Math.random().toString(36).slice(2)
      setError('')
      setPhase('listening')
      acquireWakeLock()
    } catch (e) {
      await stopScribeListening()
      const isAuthError = e?.message?.includes('401') || e?.message?.includes('Unauthorized')
      if (isAuthError) {
        logKhutbah('WARN', 'Scribe unauthorized (missing API token) — falling back to Apple Native', e)
        showToast('Cloud STT requires API token in .env.local — using on-device engine', 'warn', 4500)
      } else {
        logKhutbah('WARN', IS_IOS ? 'Scribe unavailable on iOS — falling back to Apple Native if available' : 'Scribe unavailable, falling back to local', e)
        showToast('Cloud speech unavailable — using on-device engine', 'warn', 4500)
      }
      // Don't bounce back to Native if we're already the Native → Scribe
      // fallback (it'll just produce the same AAPLESTT_UNAVAILABLE again and
      // ping-pong). Show a clean error and stay idle instead.
      if (IS_NATIVE && !isFallback) await startNativeListeningInternal()
      else if (isFallback) {
        setError('Both Apple Native and ElevenLabs speech failed. Check the app logs for details.')
        setPhase('idle')
        isListeningRef.current = false
      } else await startBrowserListeningInternal()
    }
  }

  const startNativeListeningInternal = async () => {
    setPhase('idle')  // dismiss modal immediately so progress/errors are visible
    // PLAN-024 (Bug #14): clear any stale error from the previous session so we
    // don't display an old failure message alongside the new listening pass.
    setError('')
    const engine = IS_IOS ? 'apple' : (settings.sttEngine ?? sttEngineRef.current ?? 'elevenlabs')
    const NativeSTT = engine === 'apple' ? AppleSTT : SherpaSTT

    if (engine !== 'apple' && !modelReadyRef.current) {
      await downloadSherpaModel()
      if (!modelReadyRef.current) return  // download failed
    }

    clearAll()

    try {
      await NativeSTT.initialize({ performanceMode: settings.performanceMode || 'medium' })
    } catch (e) {
      setError('STT init failed: ' + e.message)
      setPhase('idle')
      return
    }

    // Wire up result listener — each result is a complete transcribed sentence
    await NativeSTT.addListener('result', ({ text }) => {
      if (!isListeningRef.current) return
      commitPhrase(text)
    })
    if (NativeSTT.addListener) {
      await NativeSTT.addListener('error', ({ message }) => {
        setError('STT: ' + message)
      })
    }

    isListeningRef.current = true
    sessionTokenRef.current = Date.now().toString(36) + Math.random().toString(36).slice(2)
    setError('')
    setPhase('listening')
    acquireWakeLock()

    try {
      await NativeSTT.startListening()
    } catch (e) {
      const msg = e?.message?.toLowerCase() || ''
      // Bug fix #N1 (paired with src/plugins/AppleSTT.js probe): if the
      // Capacitor bridge can't find the @capacitor-community/speech-recognition
      // native plugin, fall back to ElevenLabs Scribe so Detect mode still
      // works. The `isFallback` flag on startScribeListening prevents an
      // infinite ping-pong if Scribe also fails.
      if (msg.toLowerCase().includes('applestt_') || msg.toLowerCase().includes('aaplestt_')) {
        logKhutbah('WARN', 'AppleSTT unavailable, falling back to ElevenLabs Scribe', e?.message || String(e))
        showToast('Apple Native speech not available on this device — using ElevenLabs cloud STT', 'warn', 4500)
        try { await NativeSTT.stopListening?.() } catch {}
        try { await NativeSTT.removeAllListeners?.() } catch {}
        await startScribeListening(false, true /* isFallback: breaks ping-pong */)
        return
      }
      if (msg.includes('simulator') || msg.includes('not supported on this device') || msg.includes('recognizer is not supported')) {
        setError('Apple Native STT does not work on iOS Simulators. Please test on a real device.')
      } else if (msg.includes('permission')) {
        setError('Speech Recognition permission was denied. Please enable it in Settings.')
      } else {
        setError('Could not start microphone: ' + (e.message || 'Unknown error'))
      }
      setPhase('idle')
      isListeningRef.current = false
    }
  }

  const stopNativeListening = async () => {
    isListeningRef.current = false
    try {
      const engine = IS_IOS ? 'apple' : (settings.sttEngine ?? sttEngineRef.current ?? 'elevenlabs')
      const NativeSTT = engine === 'apple' ? AppleSTT : SherpaSTT
      await NativeSTT.stopListening()
      await NativeSTT.removeAllListeners()
    } catch {}
  }

  // ── Browser fallback (MediaRecorder + Whisper) ───────────────────────────
  const startBrowserListeningInternal = async () => {
    if (IS_NATIVE) return
    clearAll()
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access denied. Please allow and reload.')
      setPhase('idle')
      return
    }

    streamRef.current = stream
    isListeningRef.current = true
    sessionTokenRef.current = Date.now().toString(36) + Math.random().toString(36).slice(2)
    setError('')
    setPhase('listening')
    acquireWakeLock()

    try {
      const audioCtx = new AudioContext()
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      audioCtx.createMediaStreamSource(stream).connect(analyser)
      audioCtxRef.current = audioCtx
      analyserRef.current = analyser
    } catch {}

    function startChunk() {
      if (!isListeningRef.current || !streamRef.current) return
      const recorder = new MediaRecorder(streamRef.current)
      const chunks = []
      let speechStarted = false
      let silenceTimer = null

      const flush = () => {
        clearTimeout(silenceTimer)
        silenceTimer = null
        if (recorder.state === 'recording') recorder.stop()
      }

      const freqData = analyserRef.current ? new Uint8Array(analyserRef.current.frequencyBinCount) : null
      const levelTimer = analyserRef.current ? setInterval(() => {
        analyserRef.current.getByteFrequencyData(freqData)
        const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length
        if (avg > 12) {
          if (!speechStarted) {
            speechStarted = true
            chunkTimerRef.current = setTimeout(flush, MAX_CHUNK_MS)
          }
          clearTimeout(silenceTimer)
          silenceTimer = null
        } else if (speechStarted && !silenceTimer) {
          silenceTimer = setTimeout(flush, SILENCE_MS)
        }
      }, 120) : null

      if (!analyserRef.current) {
        speechStarted = true
        chunkTimerRef.current = setTimeout(flush, MAX_CHUNK_MS)
      }

      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        clearInterval(levelTimer)
        clearTimeout(silenceTimer)
        if (isListeningRef.current) startChunk()
        if (speechStarted && chunks.length > 0) {
          const blob = new Blob(chunks, { type: recorder.mimeType })
          sendChunk(blob)
        }
      }
      recorder.start()
      recorderRef.current = recorder
    }

    startChunkRef.current = startChunk
    startChunk()
  }

  const startListening = async () => {
    // iOS forces either 'elevenlabs' or 'apple'. 'local' (Sherpa) is unsupported.
    const engine = IS_IOS
      ? (settings.sttEngine === 'apple' ? 'apple' : 'elevenlabs')
      : (settings.sttEngine ?? sttEngineRef.current ?? 'elevenlabs')
    if (engine === 'elevenlabs') {
      await startScribeListening()
      return
    }
    if (IS_NATIVE) await startNativeListeningInternal()
    else await startBrowserListeningInternal()
  }

  const pause = () => {
    isListeningRef.current = false
    setPhase('paused')
    // Fix #10/#19: ALWAYS tear down regardless of `scribeRef.current?.isConnected`.
    // The old early-return skipped wake-lock release and native-recognition cleanup
    // whenever the Scribe WebSocket was still flagged connected (a stale getter —
    // `connect()` flips it to true inside `ws.onopen`, but `onclose` only resets
    // `_connected = false`, so a freshly-then-reconnected session skipped cleanup
    // entirely → wake lock held, mic kept streaming → next session inherits state).
    if (scribeRef.current) {
      // Stop Scribe without awaiting — pause() is sync to the UI but we still want
      // the teardown scheduled immediately.
      scribeRef.current.disconnect().catch(() => {})
      scribeRef.current = null
    }
    if (IS_NATIVE) {
      const engine = IS_IOS ? 'apple' : (settings.sttEngine ?? sttEngineRef.current ?? 'elevenlabs')
      const NativeSTT = engine === 'apple' ? AppleSTT : SherpaSTT
      NativeSTT.stopListening().catch(() => {})
      NativeSTT.removeAllListeners?.().catch(() => {})
    } else {
      clearTimeout(chunkTimerRef.current)
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {})
        audioCtxRef.current = null
      }
      analyserRef.current = null
    }
    releaseWakeLock()
  }

  // Bug #H2: previous `resume()` only re-started the native recognizer. If the user
  // paused on ElevenLabs (Scribe sessions are one-shot — the server token is single-use),
  // we'd flip phase to 'listening' but never reconnect the WebSocket, so the mic stayed
  // dead while the UI claimed "Listening". ElevenLabs now reuses `startScribeListening(true)`
  // which preserves the in-flight feed (no `clearAll`) and skips the modal-dismiss setPhase.
  // For native Apple/Sherpa we still resume in-place via `startListening()`. On any
  // failure we roll back `isListeningRef` and phase so the UI doesn't lie.
  const resume = async () => {
    const engine = IS_IOS
      ? (settings.sttEngine === 'apple' ? 'apple' : 'elevenlabs')
      : (settings.sttEngine ?? sttEngineRef.current ?? 'elevenlabs')
    // Optimistic UI flip BEFORE the async connect — users see the "Listening" pill
    // immediately, since waiting ~1 round-trip for the token fetch would leave the
    // pause button visible. The catch block rolls this back on failure.
    isListeningRef.current = true
    setPhase('listening')
    try {
      if (engine === 'elevenlabs') {
        await startScribeListening(true)   // reuses existing fresh-connection entry
        return
      }
      if (IS_NATIVE) {
        const NativeSTT = engine === 'apple' ? AppleSTT : SherpaSTT
        await NativeSTT.startListening()
        acquireWakeLock()
        return
      }
      // Browser MediaRecorder path — start a fresh chunk (no async needed).
      startChunkRef.current?.()
      acquireWakeLock()
    } catch (e) {
      logKhutbah('WARN', 'Resume failed (' + engine + ')', e?.message || String(e))
      isListeningRef.current = false
      setPhase('paused')
      releaseWakeLock()
      showToast('Could not resume — try End and Start fresh.', 'error', 4500)
    }
  }

  const saveSession = async (curElapsed, curFeed, analysis = null) => {
    if (curFeed.length === 0) return
    const curTrans = curFeed.filter(f => f.english)
    const payload = {
      date_label:     new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' - ' + new Date().toLocaleTimeString('en-GB'),
      duration:       curElapsed,
      sentence_count: curTrans.length,
      arabic_text:    curFeed.filter(f => f.arabic).map(f => f.arabic).join(' '),
      english_text:   curTrans.filter(f => f.english).map(f => f.english).join(' '),
      analysis,
    }
    try {
      const res = await apiFetch(API_BASE + '/api/history', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...payload, session_token: sessionTokenRef.current, device_id: DEVICE_ID }),
      }, { retries: 0, timeoutMs: 15000 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const entry = normalize({ id: data.id, ...payload, date_label: payload.date_label })
      setHistory(prev => [entry, ...prev])
    } catch (e) {
      logKhutbah('ERROR', 'Failed to save khutbah to history', e)
      if (e?.message?.includes('401')) {
        setError('⚠ Cannot save history: API token is missing. Please configure .env.local.')
      } else {
        setError('⚠ Could not save this khutbah — check your connection. Your transcript is still on screen.')
      }
    }
  }

  const saveHistoryFromTab = async ({ duration, sentenceCount, analysis }) => {
    try {
      const payload = {
        date_label:     new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' - ' + new Date().toLocaleTimeString('en-GB'),
        duration:       duration || 0,
        sentence_count: sentenceCount || 1,
        arabic_text:    '',
        english_text:   '',
        analysis:       analysis
      }
      const res = await apiFetch(API_BASE + '/api/history', { method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ ...payload, device_id: DEVICE_ID }) }, { retries: 0, timeoutMs: 15000 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const entry = normalize({ id: data.id, ...payload, date_label: payload.date_label })
      setHistory(prev => [entry, ...prev])
      showToast('Saved to History', 'success')
    } catch (e) {
      logApp('ERROR', 'Failed to save analysis to history', e)
      showToast('Could not save to History — check your connection and try again.', 'error', 5000)
    }
  }

  const end = async () => {
    const curElapsed = elapsed
    const curFeed    = [...feed]

    isListeningRef.current = false
    await stopScribeListening()
    if (IS_NATIVE) {
      // Bug #H1: was `stopNativeListening()` (no await). The Scribe teardown above is
      // awaited but the native recognizer cleanup wasn't, so a quick end→start cycle
      // could race with leftover Sherpa/AppleSTT teardown and keep the mic streaming
      // into the next session.
      await stopNativeListening()
    } else {
      clearTimeout(chunkTimerRef.current)
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    analyserRef.current = null
    releaseWakeLock()

    setPhase('idle')
    setProcessing(false)
    setElapsed(0)
    saveSession(curElapsed, curFeed)
  }

  const deleteEntry = async (id) => {
    setHistory(prev => prev.filter(e => e.id !== id))
    await apiFetch(hist(`id=${id}`), { method: 'DELETE', headers: apiHeaders() }, { retries: 0 })
      .catch(e => logApp('ERROR', 'Failed to delete history entry server-side', e))
  }

  const clearHistory = async () => {
    setHistory([])
    await apiFetch(hist(), { method: 'DELETE', headers: apiHeaders() }, { retries: 0 })
      .catch(e => logApp('ERROR', 'Failed to clear history server-side', e))
  }

  // Export the entire history to a Markdown file on the device, then clear it.
  // Bug #H6: previous implementation always fell through to `clearHistory()` after
  // the write. On native the inner `Share.share` throws when the user cancels the
  // share sheet (iOS), and that exception was silenced — leaving the user with
  // hidden data loss (file written but no share target AND history wiped). We now
  // gate `clearHistory()` on actual export success: native only clears if share
  // completed, web always clears (download click is the consent).
  const exportAndClearHistory = async () => {
    if (history.length === 0) { showToast('Nothing saved to export yet.', 'info'); return }
    const ok = await showConfirm({
      title: 'Export & clear history',
      message: `Save all ${history.length} saved khutbah${history.length === 1 ? '' : 's'} to a Markdown file, then clear your history on this device?`,
      confirmLabel: 'Export & clear',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!ok) return
    const md = buildHistoryMarkdown(history)
    const filename = `noor-history-${new Date().toISOString().slice(0, 10)}.md`
    try {
      if (IS_NATIVE) {
        const { uri } = await Filesystem.writeFile({ path: filename, data: md, directory: Directory.Documents, encoding: Encoding.UTF8 })
        // Throws on user-cancel (iOS) or share failure. If the file exists but
        // share was cancelled, the user can re-share from Files — no history wipe.
        await Share.share({ title: 'Noor — Khutbah History', text: 'Your exported khutbah history (Markdown).', files: [uri], dialogTitle: 'Save or share your history' })
      } else {
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      logApp('ERROR', 'History export failed', e?.message || e)
      // Distinguish share-cancel from real failure: Capacitor Share on iOS throws a
      // DOMException with `name === 'AbortError'` when the user dismisses the sheet
      // (verified against @capacitor/share semantics). Android Share rarely throws and
      // returns a result. We treat the structured AbortError as a user-cancel (keep
      // history, file is in Documents for re-share); any other error is treated as
      // a real failure (no clear). String substring matching is deliberately avoided
      // because message wording varies across Capacitor / NetworkError versions and a
      // "network abort" message would otherwise be misclassified.
      if (IS_NATIVE && e?.name === 'AbortError') {
        showToast('Export saved to Documents — share it from the Files app whenever you\u2019re ready. Your history was kept.', 'info', 6000)
      } else {
        showToast('Could not export history — nothing was deleted.', 'error', 5000)
      }
      return
    }
    await clearHistory()
    showToast('History exported and cleared.', 'success', 4000)
  }

  const runAnalysis = async (englishText, forEntryId = null) => {
    if (!englishText?.trim()) { setError('No translation content to analyze yet.'); return }
    setAnalyze({ open: true, loading: true, result: null, error: null, forEntryId })
    try {
      const res = await apiFetch(API_BASE + '/api/analyze', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: englishText }),
      }, { timeoutMs: 30000, retries: 1 })
      const data = await res.json()
      const result = data.analysis || 'No analysis returned.'
      setAnalyze(prev => ({ ...prev, loading: false, result }))
      if (forEntryId) {
        setHistory(prev => prev.map(e => e.id === forEntryId ? { ...e, analysis: result } : e))
        await apiFetch(hist(`id=${forEntryId}`), {
          method: 'PATCH',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ analysis: result, device_id: DEVICE_ID }),
        }, { retries: 0 }).catch(() => {})
      }
    } catch (err) {
      setAnalyze(prev => ({ ...prev, loading: false, error: err.message }))
    }
  }

  const analyzeCurrentSession = () => {
    const text = feed.filter(f => f.english).map(f => f.english).join(' ')
    runAnalysis(text, null)
  }

  const saveAnalysisToHistory = () => {
    if (!analyze.result) return
    saveSession(elapsed, feed, analyze.result)
    setAnalyze(prev => ({ ...prev, open: false }))
  }

  const clearAll = () => {
    setFeed([]); setProcessing(false)
    recentPhrasesRef.current = []; pendingRef.current = 0; recentContextRef.current = []
    sessionSummaryRef.current = ''
    resetDuaState(); setError('')
  }

  const shareText = async (text) => {
    if (!text?.trim()) return
    try {
      await Share.share({ title: 'Khutbah Analysis', text, dialogTitle: 'Share via' })
    } catch {}
  }

  useEffect(() => {
    const handleClearSession = () => {
      if (view === 'translate') clearAll();
    };
    window.addEventListener('app-clear-session', handleClearSession);
    return () => window.removeEventListener('app-clear-session', handleClearSession);
  }, [view]);

  useEffect(() => {
    const pauseKhutbahStt = async () => {
      if (!isListeningRef.current) return
      isListeningRef.current = false
      await stopScribeListening()
      if (IS_NATIVE) await stopNativeListening()
      else {
        clearTimeout(chunkTimerRef.current)
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop())
          streamRef.current = null
        }
        audioCtxRef.current?.close()
        audioCtxRef.current = null
      }
      releaseWakeLock()
      setPhase('idle')
    }
    window.addEventListener('app-pause-khutbah-stt', pauseKhutbahStt)
    return () => window.removeEventListener('app-pause-khutbah-stt', pauseKhutbahStt)
  }, [])

  useEffect(() => {
    const handler = (e) => setQuranMicActive(e.detail?.active ?? false)
    window.addEventListener('quran-mic-state', handler)
    return () => window.removeEventListener('quran-mic-state', handler)
  }, []);

  // Kill switch: show spinner while checking, overlay if disabled
  if (appStatus === null) {
    return (
      <div className="app-status-screen">
        <span className="app-status-logo">🌙</span>
        <p className="app-status-msg">Loading Noor…</p>
      </div>
    )
  }
  if (appStatus === false) {
    return (
      <div className="app-status-screen">
        <span className="app-status-logo">🌙</span>
        <h2 className="app-status-title">Noor is temporarily unavailable</h2>
        <p className="app-status-msg">{appStatusMsg || 'We are making updates. Please check back shortly.'}</p>
      </div>
    )
  }

  return (
    <div className="app" data-view={view}>
      {showOnboarding && <Onboarding onDone={dismissOnboarding} />}
      {showModePicker && <ModePicker onPick={(mode) => { const updated = { ...settings, experienceMode: mode }; setSettings(updated); ls.set('khutbah-settings', updated); setShowModePicker(false) }} />}
      {phase === 'modal' && <ReadyModal onStart={startListening} onSkip={startListening} />}
      {analyze.open && <AnalyzeModal loading={analyze.loading} result={analyze.result} error={analyze.error} onClose={() => setAnalyze(prev => ({ ...prev, open: false }))} onSave={!analyze.forEntryId && analyze.result ? saveAnalysisToHistory : null} onShare={() => shareText(analyze.result)} onNavigateToQuran={(surah, ayah) => { setQuranTarget({ surah, ayah }); setView('quran'); }} textSize={analyzeTextSize} onTextSize={setAnalyzeTextSizePersist} />}
      <header className="header">
        <div className="header-left">
          <span className="header-logo"><Icons.Logo /></span>
          <span className="header-title" style={{ fontSize: '1.4rem' }}>Noor <span className="version" style={{ fontSize: '0.85rem' }}>- v1.0.0</span></span>
        </div>
        <div className="header-right">
          <button className="header-clear-btn" onClick={() => window.dispatchEvent(new Event('app-clear-session'))}>
            Clear
          </button>
          <span aria-hidden="true" className={`status-dot ${(phase === 'listening' || quranMicActive) ? 'dot-live' : phase === 'paused' ? 'dot-paused' : 'dot-idle'}`} />
        </div>
      </header>
      <div className="lang-bar" style={(view === 'quran' || view === 'maktaba' || view === 'settings' || view === 'home' || view === 'qibla' || view === 'adhkar') ? { display: 'none' } : {}}>
        <div className="lang-pill lang-pill-left">
          <span className="lang-pill-label">From</span>
          <select className="lang-select-input" value={sourceLang} onChange={e => setSourceLang(e.target.value)} disabled={isActive}>
            {SOURCE_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div className="lang-swap" aria-hidden="true">⇄</div>
        <div className="lang-pill lang-pill-right">
          <span className="lang-pill-label">To</span>
          <span className="lang-pill-value">English</span>
        </div>
      </div>
      <div className={`status-bar ${error ? 'status-error' : ''}`} style={(view === 'quran' || view === 'maktaba' || view === 'settings' || view === 'home' || view === 'qibla' || view === 'adhkar') ? { display: 'none' } : {}}>
        {error ? `⚠ ${error}` : phase === 'listening' ? (processing ? '⟳ Translating…' : (scribeRef.current ? '● Listening — ElevenLabs (Cloud)' : IS_IOS ? '● Listening — Apple Native' : '● Listening — Whisper on-device')) : phase === 'paused' ? '⏸ Paused' : 'Tap the mic to begin'}
      </div>
      <div className="content">
        {view === 'translate' && (
          <div className="feed-container" ref={feedContainerRef}>
            {feed.length === 0 ? (
              <div className="feed-empty">
                {processing ? '⟳ Transcribing…' : `${sourceLangShort} & English translation will appear here…`}
              </div>
            ) : (
              feed.map(item => item.isDuaDivider ? (
                <div key={item.id} className={`feed-dua-divider${item.kind === 'khutbah' ? ' feed-dua-divider-khutbah' : ''}`}><span className="feed-dua-divider-icon">{item.kind === 'khutbah' ? '📣' : '🤲'}</span><span className="feed-dua-divider-text">{item.text}</span></div>
              ) : (
                <div key={item.id} className="feed-card">
                  <p className="feed-arabic" dir="rtl" style={{ fontSize: fontStyle.arabic }}>
                    {item.arabic}
                  </p>
                  <p className="feed-english" style={{ fontSize: fontStyle.english }}>
                    {item.pending
                      ? <span className="pending-dot">…</span>
                      : item.failed
                        ? <button className="feed-retry-btn" onClick={() => retryTranslate(item)} aria-label="Retry translation">⟳ Translation failed — tap to retry</button>
                        : item.english ? <>{renderItalics(item.english)}</> : ''}
                  </p>
                </div>
              ))
            )}
            {processing && <div className="feed-interim">⟳ Transcribing…</div>}
          </div>
        )}
        {view === 'history' && <HistoryPanel history={history} loaded={historyLoaded} onClear={clearHistory} onExport={exportAndClearHistory} onAnalyze={entry => runAnalysis(entry.englishText, entry.id)} onDelete={deleteEntry} onShare={shareText} onNavigateToQuran={(surah, ayah) => { setQuranTarget({ surah, ayah }); setView('quran'); }} />}
        {view === 'settings' && <SettingsPanel settings={settings} onChange={setSettings} />}
        {view === 'home' && <HomePanel settings={settings} streakGoal={settings.streakGoal ?? 10} onGoto={goFromHome} />}
        {view === 'qibla' && <Suspense fallback={<div className="feed-empty" style={{ padding: '2rem', textAlign: 'center' }}>🧭 Loading compass…</div>}><QiblaCompass location={settings.location || null} onBack={() => setView('home')} /></Suspense>}
        {view === 'adhkar' && <AdhkarPanel settings={settings} fontStyle={fontStyle} onBack={() => setView('home')} />}
        {view === 'quran' && <Suspense fallback={<div className="feed-empty" style={{ padding: '2rem', textAlign: 'center' }}>📖 Loading Quran…</div>}><QuranMode fontStyle={fontStyle} modelReady={modelReady} targetVerse={quranTarget} onTargetVerseConsumed={consumeTargetVerse} openView={quranOpenView} onOpenViewConsumed={() => setQuranOpenView(null)} sttMode={(settings.sttEngine ?? 'elevenlabs') === 'elevenlabs' ? 'elevenlabs' : (settings.sttEngine === 'apple' ? 'apple' : 'off')} performanceMode={settings.performanceMode} quranStreams={settings.quranStreams} quranScript={settings.quranScript ?? 'uthmani'} streakGoal={settings.streakGoal ?? 10} streakReminders={settings.streakReminders ?? true} debugMode={settings.debugMode ?? false} onNavigateToQuran={(surah, ayah) => { setQuranTarget({ surah, ayah }); }} onSaveHistory={saveHistoryFromTab} onModelReady={() => { setModelReady(true); modelReadyRef.current = true; }} /></Suspense>}
        {view === 'maktaba' && <Suspense fallback={<div className="feed-empty" style={{ padding: '2rem', textAlign: 'center' }}>📚 Loading Maktaba…</div>}><ReferenceMode settings={settings} onNavigateToQuran={(surah, ayah) => { setQuranTarget({ surah, ayah }); setView('quran'); }} onSaveHistory={saveHistoryFromTab} /></Suspense>}
      </div>
      <div className="controls" style={(view === 'quran' || view === 'maktaba' || view === 'settings' || view === 'home' || view === 'qibla' || view === 'adhkar') ? { display: 'none' } : {}}>
        <div className="unified-controls">
          {phase === 'idle' && (
            <>
              {modelDownloading ? (
                <div className="model-dl-progress">
                  <span>Downloading speech model… {downloadPct}%</span>
                  <div className="model-dl-bar"><div className="model-dl-fill" style={{ width: `${downloadPct}%` }} /></div>
                </div>
              ) : feed.length === 0 ? (
                <>
                  <button className="ctrl-btn ctrl-mic" onClick={() => setPhase('modal')} disabled={!supported && !IS_NATIVE} aria-label="Start listening">
                    <Icons.Mic />
                  </button>
                  <button className="ctrl-btn ctrl-stop" disabled aria-label="Stop">
                    <Icons.Stop />
                  </button>
                </>
              ) : (
                <>
                  <button className="ctrl-btn ctrl-analyze" onClick={analyzeCurrentSession}>
                    <Icons.Analyze /> Analyze
                  </button>
                  <button className="ctrl-btn ctrl-share" onClick={() => shareText(feed.map(f => f.arabic + '\n' + f.english).join('\n\n'))}>
                    <Icons.Share /> Share
                  </button>
                </>
              )}
            </>
          )}

          {isActive && (
            <>
              {phase === 'listening' ? (
                <button className="ctrl-btn ctrl-pause" onClick={pause} aria-label="Pause listening">
                  <Icons.Pause />
                </button>
              ) : (
                <button className="ctrl-btn ctrl-mic ctrl-resume" onClick={resume} aria-label="Resume listening">
                  <Icons.Mic />
                </button>
              )}
              <button className="ctrl-btn ctrl-stop" onClick={end} aria-label="End session">
                <Icons.Stop />
              </button>
            </>
          )}
        </div>
      </div>
      <nav className="bottom-nav">
        <button className={`nav-btn ${view === 'home' ? 'nav-btn-active' : ''}`} onClick={() => setView('home')}><span className="nav-icon"><Icons.Home /></span><span>Home</span></button>
        <button className={`nav-btn ${view === 'quran' ? 'nav-btn-active' : ''}`} onClick={() => setView('quran')}><span className="nav-icon"><Icons.Quran /></span><span>Quran</span></button>
        {currentMode === 'expert' && (
          <button className={`nav-btn ${view === 'translate' ? 'nav-btn-active' : ''}`} onClick={() => setView('translate')}><span className="nav-icon"><Icons.Khutbah /></span><span>Khutbah</span></button>
        )}
        {(currentMode === 'medium' || currentMode === 'expert') && (
          <button className={`nav-btn ${view === 'maktaba' ? 'nav-btn-active' : ''}`} onClick={() => setView('maktaba')}><span className="nav-icon"><Icons.Maktaba /></span><span>Maktaba</span></button>
        )}
        {(currentMode === 'medium' || currentMode === 'expert') && (
          <button className={`nav-btn ${view === 'history' ? 'nav-btn-active' : ''}`} onClick={() => setView('history')}><span className="nav-icon"><Icons.History /></span><span>History</span></button>
        )}
        <button className={`nav-btn ${view === 'settings' ? 'nav-btn-active' : ''}`} onClick={() => setView('settings')}><span className="nav-icon"><Icons.Settings /></span><span>Settings</span></button>
      </nav>
      {showLogReader && <LogReaderModal onClose={() => setShowLogReader(false)} />}
      <ToastHost />
    </div>
  )
}





