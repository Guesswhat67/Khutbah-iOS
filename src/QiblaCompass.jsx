import { useState, useEffect, useRef } from 'react'
import { getQiblaBearing } from './utils/prayer'

// Qibla compass using the WebView's device-orientation sensor. Heading accuracy
// depends on the phone's magnetometer and calibration (figure-8 motion helps).
// If no sensor data arrives we still show the fixed qibla bearing from North.
export default function QiblaCompass({ location, onBack }) {
  const bearing = getQiblaBearing(location) // degrees from true North, or null
  const [heading, setHeading] = useState(null) // device heading (deg from North)
  const [hasSensor, setHasSensor] = useState(false)
  // iOS only grants DeviceOrientationEvent.requestPermission() when called from
  // a real user tap — the mount-time attempt below silently fails on first use,
  // so we surface an "Enable compass" button that re-requests inside its onClick.
  const [needsPermission, setNeedsPermission] = useState(false)
  const smooth = useRef(null)
  const attachRef = useRef(null)

  useEffect(() => {
    let mounted = true

    const onOrient = (e) => {
      let hdg = null
      if (typeof e.webkitCompassHeading === 'number') {
        hdg = e.webkitCompassHeading // iOS: already heading from North, clockwise
      } else if (typeof e.alpha === 'number') {
        // Android absolute: alpha is counter-clockwise from North.
        hdg = 360 - e.alpha
        const scrAngle = (screen.orientation && screen.orientation.angle) || 0
        hdg = (hdg + scrAngle) % 360
      }
      if (hdg == null || Number.isNaN(hdg)) return
      if (!mounted) return
      setHasSensor(true)
      // Low-pass smoothing to stop the needle jittering.
      const prev = smooth.current
      if (prev == null) smooth.current = hdg
      else {
        let delta = hdg - prev
        if (delta > 180) delta -= 360
        if (delta < -180) delta += 360
        smooth.current = (prev + delta * 0.2 + 360) % 360
      }
      setHeading(smooth.current)
    }

    const attach = () => {
      window.addEventListener('deviceorientationabsolute', onOrient, true)
      window.addEventListener('deviceorientation', onOrient, true)
    }

    // iOS 13+ gated behind a permission request; Android just attaches.
    attachRef.current = attach
    const DOE = window.DeviceOrientationEvent
    if (DOE && typeof DOE.requestPermission === 'function') {
      // Resolves without a prompt if already granted in this session; otherwise
      // iOS rejects (no user gesture) and we show the Enable button instead.
      DOE.requestPermission()
        .then(state => { if (state === 'granted') attach(); else if (mounted) setNeedsPermission(true) })
        .catch(() => { if (mounted) setNeedsPermission(true) })
    } else {
      attach()
    }

    return () => {
      mounted = false
      window.removeEventListener('deviceorientationabsolute', onOrient, true)
      window.removeEventListener('deviceorientation', onOrient, true)
    }
  }, [])

  // Rotation of the qibla needle relative to the top of the phone.
  const needleRot = (bearing != null && heading != null) ? (bearing - heading) : (bearing || 0)
  const dialRot = heading != null ? -heading : 0
  const aligned = bearing != null && heading != null && Math.abs(((bearing - heading + 540) % 360) - 180) < 6

  return (
    <div className="qibla-view">
      <div className="quran-browse-header">
        <button className="quran-browse-back" onClick={onBack}>← Back</button>
        <span className="quran-browse-title">Qibla</span>
        <span className="quran-browse-back" style={{ visibility: 'hidden' }}>←</span>
      </div>

      {!location ? (
        <div className="qibla-empty">
          <p>Set your location first to find the qibla.</p>
        </div>
      ) : (
        <div className="qibla-body">
          <div className={`qibla-dial-wrap${aligned ? ' qibla-aligned' : ''}`}>
            {/* Compass dial rotates so N tracks true north */}
            <div className="qibla-dial" style={{ transform: `rotate(${dialRot}deg)` }}>
              <span className="qibla-n">N</span>
              <span className="qibla-e">E</span>
              <span className="qibla-s">S</span>
              <span className="qibla-w">W</span>
            </div>
            {/* Kaaba needle points to the qibla relative to the phone top */}
            <div className="qibla-needle" style={{ transform: `rotate(${needleRot}deg)` }}>
              <div className="qibla-needle-tip">🕋</div>
              <div className="qibla-needle-line" />
            </div>
          </div>

          <div className="qibla-readout">
            <div className="qibla-bearing">{bearing != null ? `${Math.round(bearing)}° from North` : '—'}</div>
            {aligned && <div className="qibla-aligned-msg">✓ Facing the qibla</div>}
            {needsPermission && !hasSensor && (
              <button
                className="quran-dl-btn"
                onClick={() => {
                  const DOE = window.DeviceOrientationEvent
                  DOE?.requestPermission?.()
                    .then(state => { if (state === 'granted') { attachRef.current?.(); setNeedsPermission(false) } })
                    .catch(() => {})
                }}
              >
                🧭 Enable compass
              </button>
            )}
            {!hasSensor && (
              <div className="qibla-hint">
                Compass sensor unavailable — face <strong>{bearing != null ? Math.round(bearing) : '—'}°</strong> from North (use a compass app if needed).
              </div>
            )}
            {hasSensor && !aligned && (
              <div className="qibla-hint">Turn until the Kaaba points straight up. If it drifts, move the phone in a figure-8 to calibrate.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
