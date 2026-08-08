// DeviceConfirmModal — first-run UX for picking the right hardware tier so
// the app can dial GPU/CPU costs accordingly.
//
// Two stages:
//   1. CONFIRM: shows our best UA-based guess + the perf tier it'll pick.
//      "Yes, that's mine" persists + closes. "Not quite right" → stage 2.
//   2. PICKER:  grouped list (iPad Pro / Air / iPad / mini / iPhone).
//      Every tap persists + closes the modal — no extra "Confirm" step
//      needed since the picker IS a confirmation by definition.
//
// Persistence key: `noor-device-confirmed` — JSON {id, confirmedAt}. Loaded
// back into the App on next mount via `loadConfirmedDevice()` so the modal
// only shows on truly first-launch (or after "Change device" from Settings).

import { useState } from 'react'
import {
  detectDevice,
  getDeviceById,
  getDeviceCatalogGrouped,
  saveConfirmedDevice,
} from '../utils/deviceDetect'

const ICONS = {
  ipad:  '📱', // Family icon — backing for the device group icon row.
  // Inline SVGs would be more reliable in WKWebView but the family's used
  // emoji elsewhere, so we keep consistent. Apple in iOS 17.4 added
  // emoji-tinting with default-off unicode-emoji style; field shows fine.
}

const TIER_PILL = {
  high:   { label: 'Full',  cls: 'tier-high'   },
  medium: { label: 'Tuned', cls: 'tier-medium' },
  low:    { label: 'Lite',  cls: 'tier-low'    },
}

const TIER_COPY = {
  high:   'Full visual + audio quality. Backdrop blur, larger karaoke-highlight repaint, audio analyzer at 120 ms.',
  medium: 'Backdrop blur disabled. Audio analyzer at 180 ms (saves ~2% CPU on A13). Slightly chunkier card shadows.',
  low:    'Lite mode — fewer animations, thinner modal shadows, smaller audio FFT window. Khutbah translation quality is identical.',
}

// Hook so App.jsx doesn't have to react-style re-render between two stage
// states itself. Keeps the modal internally consistent.
export default function DeviceConfirmModal({ detected = null, onConfirm, forceOpen = false }) {
  // If parent passes `detected`, paint stage 1 with it. Otherwise fall back
  // to our UA-driven guess. (The App fetches once on mount and passes down.)
  const initial = detected || detectDevice()
  const [stage, setStage] = useState(forceOpen ? 'picker' : 'confirm')
  const grouped = getDeviceCatalogGrouped()

  const handleConfirm = (entry) => {
    saveConfirmedDevice(entry.id)
    onConfirm?.(entry)
  }

  if (stage === 'confirm') {
    return (
      <div className="device-confirm-overlay" role="dialog" aria-modal="true">
        <div className="device-confirm-card">
          <h2 className="device-confirm-title">Confirm your device</h2>
          <p className="device-confirm-sub">
            So we can tune graphics & audio for your hardware. One-tap choice — you can change it in <strong>Settings</strong> anytime.
          </p>

          <div className="device-confirm-detected">
            <div className="device-confirm-chip">{initial.chip}</div>
            <div className="device-confirm-name">{initial.name}</div>
            <div className="device-confirm-sub-name">{initial.sub}</div>
            <div className="device-confirm-actions">
              <button
                type="button"
                className="device-confirm-btn-secondary"
                onClick={() => setStage('picker')}
                aria-label="My device is not this one"
              >
                Not quite right
              </button>
              <button
                type="button"
                className={`device-confirm-btn-primary ${TIER_PILL[initial.tier]?.cls || ''}`}
                onClick={() => handleConfirm(initial)}
                autoFocus
              >
                Yes, that's mine
              </button>
            </div>
          </div>

          <div className="device-confirm-tier-note">
            <span className={`device-confirm-tier-pill ${TIER_PILL[initial.tier]?.cls || ''}`}>
              {TIER_PILL[initial.tier]?.label || initial.tier}
            </span>
            <p>{TIER_COPY[initial.tier] || ''}</p>
          </div>
        </div>
      </div>
    )
  }

  // Picker stage
  return (
    <div className="device-confirm-overlay device-confirm-overlay-wide" role="dialog" aria-modal="true">
      <div className="device-confirm-card device-confirm-card-wide">
        <button
          type="button"
          className="device-confirm-back"
          onClick={() => setStage('confirm')}
          aria-label="Back to detected device"
        >
          ← Back
        </button>
        <h2 className="device-confirm-title">Pick your device</h2>
        <p className="device-confirm-sub">
          Tap your model — we'll save and tune the app for it.
        </p>

        <div className="device-picker-scroll">
          {grouped.map(group => (
            <section key={group.id} className="device-picker-group">
              <h3 className="device-picker-group-label">{group.label}</h3>
              <ul className="device-picker-list">
                {group.devices.map(d => {
                  const pill = TIER_PILL[d.tier] || { label: d.tier, cls: '' }
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        className={`device-picker-row ${d.id === initial?.id ? 'selected' : ''}`}
                        onClick={() => handleConfirm(d)}
                      >
                        <span className="device-picker-row-chip">{d.chip}</span>
                        <span className="device-picker-row-text">
                          <span className="device-picker-row-name">{d.name}</span>
                          <span className="device-picker-row-sub">{d.sub}</span>
                        </span>
                        <span className={`device-picker-row-tier ${pill.cls}`}>{pill.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
