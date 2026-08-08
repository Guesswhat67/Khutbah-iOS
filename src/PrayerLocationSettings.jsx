import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { CITIES } from './data/cities'
import { PRAYER_METHODS } from './utils/prayer'
import { showToast } from './utils/toast'

const IS_NATIVE = Capacitor.isNativePlatform()

// Reverse-geocode GPS coordinates to a "City, Region" label. BigDataCloud's
// client-side reverse-geocode endpoint is free and needs no API key — used only
// for a friendly display name; the app works fine on lat/lng alone if this fails.
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`)
    if (!res.ok) return null
    const data = await res.json()
    const city = data.city || data.locality || data.principalSubdivision
    const region = data.principalSubdivision && data.principalSubdivision !== city ? data.principalSubdivision : data.countryName
    if (!city) return null
    return region ? `${city}, ${region}` : city
  } catch {
    return null
  }
}

// Settings section: location (city search or manual coords) + prayer calculation
// preferences + the prayer-reminder toggle. Location is shared with the qibla view
// and the home-screen widget.
export default function PrayerLocationSettings({ settings, set }) {
  const loc = settings.location || null
  const [q, setQ] = useState('')
  const [manLat, setManLat] = useState('')
  const [manLng, setManLng] = useState('')



  const [locating, setLocating] = useState(false)

  const matches = q.trim().length >= 2
    ? CITIES.filter(c => c.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : []

  const chooseCity = (c) => {
    set('location', { lat: c.lat, lng: c.lng, city: c.name })
    setQ('')
  }

  // One-shot foreground GPS fix — no background-location permission involved.
  const useMyLocation = async () => {
    setLocating(true)
    try {
      const perm = await Geolocation.requestPermissions()
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        showToast('Location permission denied', 'error', 3000)
        return
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
      const lat = pos.coords.latitude, lng = pos.coords.longitude
      const city = await reverseGeocode(lat, lng)
      set('location', { lat, lng, city: city || `${lat.toFixed(3)}, ${lng.toFixed(3)}` })
      setQ('')
    } catch (e) {
      showToast('Could not get your location', 'error', 3000)
    } finally {
      setLocating(false)
    }
  }

  const applyManual = () => {
    const lat = parseFloat(manLat), lng = parseFloat(manLng)
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      set('location', { lat, lng, city: `${lat.toFixed(3)}, ${lng.toFixed(3)}` })
      setManLat(''); setManLng('')
    }
  }

  return (
    <>
      <div className="setting-section-divider">🕌 Prayer Times & Location</div>

      <div className="setting-group">
        <label className="setting-label">Your Location</label>
        {loc ? (
          <div className="loc-current">
            <span>📍 {loc.city || `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}`}</span>
            <button className="loc-clear" onClick={() => set('location', null)}>Change</button>
          </div>
        ) : (
          <p className="setting-hint">Choose your city (or enter coordinates) to enable prayer times & qibla. Calculated on-device — works offline.</p>
        )}

        {!loc && (
          <>
            {IS_NATIVE && (
              <button className="loc-use-gps" onClick={useMyLocation} disabled={locating}>
                📍 {locating ? 'Locating…' : 'Use my location'}
              </button>
            )}
            <input
              type="text"
              className="loc-search"
              placeholder="Search your city…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            {matches.length > 0 && (
              <div className="loc-results">
                {matches.map(c => (
                  <button key={c.name} className="loc-result" onClick={() => chooseCity(c)}>{c.name}</button>
                ))}
              </div>
            )}
            {q.trim().length >= 2 && matches.length === 0 && (
              <p className="setting-hint" style={{ marginTop: 6 }}>No match — enter coordinates below.</p>
            )}
            <div className="loc-manual">
              <input type="number" inputMode="decimal" placeholder="Latitude" value={manLat} onChange={e => setManLat(e.target.value)} />
              <input type="number" inputMode="decimal" placeholder="Longitude" value={manLng} onChange={e => setManLng(e.target.value)} />
              <button className="seg-btn" onClick={applyManual}>Use</button>
            </div>
          </>
        )}
      </div>

      <div className="setting-group">
        <label className="setting-label">Calculation Method</label>
        <select
          className="loc-method"
          value={settings.prayerMethod || 'NorthAmerica'}
          onChange={e => set('prayerMethod', e.target.value)}
        >
          {PRAYER_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <p className="setting-hint" style={{ marginTop: 6 }}>Use the method your local masjid follows.</p>
      </div>

      <div className="setting-group">
        <label className="setting-label">Asr Time (Madhab)</label>
        <div className="seg-control">
          {[['shafi', 'Standard (Shafi/Maliki/Hanbali)'], ['hanafi', 'Hanafi']].map(([v, label]) => (
            <button key={v} className={`seg-btn ${(settings.prayerMadhab || 'shafi') === v ? 'seg-active' : ''}`} onClick={() => set('prayerMadhab', v)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-group">
        <label className="setting-label">Prayer Reminders</label>
        <p className="setting-hint">A notification at each prayer time</p>
        <div className="seg-control">
          <button
            className={`seg-btn ${(settings.prayerReminders ?? true) ? 'seg-active' : ''}`}
            onClick={() => set('prayerReminders', !(settings.prayerReminders ?? true))}
          >
            {(settings.prayerReminders ?? true) ? 'Reminders: ON' : 'Reminders: OFF'}
          </button>
        </div>

      </div>

      <div className="setting-group">
        <label className="setting-label">Sunnah Fasting Reminders</label>
        <p className="setting-hint">A heads-up 3 days before and the evening before recommended fasting days — white days (13–15 of each Islamic month), Tasu'a &amp; Ashura, Arafah, and the six of Shawwal. Weekly Mon/Thu fasts are not included. Dates follow the calculated calendar; confirm with local moonsighting.</p>
        <div className="seg-control">
          <button
            className={`seg-btn ${(settings.fastingReminders ?? true) ? 'seg-active' : ''}`}
            onClick={() => set('fastingReminders', !(settings.fastingReminders ?? true))}
          >
            {(settings.fastingReminders ?? true) ? 'Reminders: ON' : 'Reminders: OFF'}
          </button>
        </div>
      </div>

      <div className="setting-group">
        <label className="setting-label">Temperature Unit</label>
        <p className="setting-hint">Used for the weather shown on the home-screen widget</p>
        <div className="seg-control">
          {[['c', '°C'], ['f', '°F']].map(([v, label]) => (
            <button key={v} className={`seg-btn ${(settings.tempUnit || 'c') === v ? 'seg-active' : ''}`} onClick={() => set('tempUnit', v)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {IS_NATIVE && (
        <div className="setting-group">
          <label className="setting-label">Home Screen Widget</label>
          <p className="setting-hint">Long-press your home screen → Widgets → Noor to add the prayer-clock widget. You can resize it by long-pressing the widget itself — weather &amp; the countdown will use the extra space.</p>
        </div>
      )}
    </>
  )
}
