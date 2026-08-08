import { useState, useEffect } from 'react'
import {
  getCachedCircle, getCachedMembers, createCircle, joinCircle, leaveCircle, fetchCircle, displayStreakOf,
} from './utils/circle'
import { showToast, showConfirm } from './utils/toast'

// Settings section: create / join / manage the family streak circle.
// Members share streak numbers only — never reading content or device ids.
export default function FamilySettings() {
  const [circle, setCircle] = useState(() => getCachedCircle())
  const [members, setMembers] = useState(() => getCachedMembers())
  const [name, setName] = useState('')          // display name
  const [circleName, setCircleName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('create')    // create | join

  // PLAN-024 (Bug #2): keep [circle?.code] as the dep (it correctly flips from
  // "X" → undefined → "X" on a leave→rejoin cycle, so the effect re-fires), and
  // add a `cancelled` flag so a stale in-flight fetchCircle() can't clobber a
  // fresh response if the user joins/leaves in rapid succession.
  useEffect(() => {
    if (!circle) return
    let cancelled = false
    fetchCircle().then(m => { if (!cancelled) setMembers(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [circle?.code])

  const doCreate = async () => {
    if (!name.trim()) { showToast('Enter your name first', 'error', 2500); return }
    setBusy(true)
    try {
      await createCircle(circleName.trim() || 'Our family', name.trim())
      setCircle(getCachedCircle())
      showToast('Family circle created', 'success', 2500)
    } catch (e) {
      showToast(`Could not create circle: ${e.message}`, 'error', 3500)
    } finally { setBusy(false) }
  }

  const doJoin = async () => {
    if (!name.trim() || !code.trim()) { showToast('Enter the code and your name', 'error', 2500); return }
    setBusy(true)
    try {
      await joinCircle(code.trim(), name.trim())
      setCircle(getCachedCircle())
      showToast('Joined the family circle', 'success', 2500)
    } catch (e) {
      showToast(`Could not join: ${e.message}`, 'error', 3500)
    } finally { setBusy(false) }
  }

  const doLeave = async () => {
    const ok = await showConfirm({
      title: 'Leave family circle',
      message: 'Your streak will no longer be shared with your family. You can rejoin any time with the code.',
      confirmLabel: 'Leave', cancelLabel: 'Cancel',
    })
    if (!ok) return
    setBusy(true)
    try { await leaveCircle() } catch {}
    setCircle(null); setMembers([]); setBusy(false)
  }

  return (
    <>
      <div className="setting-section-divider">👨‍👩‍👧 Family Streaks</div>
      <div className="setting-group">
        {!circle ? (
          <>
            <p className="setting-hint">Share reading streaks with your family. One person creates a circle and shares the code; everyone else joins with it. Only streak numbers are shared — never what anyone reads.</p>
            <div className="seg-control" style={{ marginTop: 10 }}>
              <button className={`seg-btn ${mode === 'create' ? 'seg-active' : ''}`} onClick={() => setMode('create')}>Create</button>
              <button className={`seg-btn ${mode === 'join' ? 'seg-active' : ''}`} onClick={() => setMode('join')}>Join with code</button>
            </div>
            <input className="loc-search" type="text" placeholder="Your name (e.g. Ali)" value={name} onChange={e => setName(e.target.value)} maxLength={24} />
            {mode === 'create' ? (
              <input className="loc-search" type="text" placeholder="Circle name (e.g. Yaqoob family)" value={circleName} onChange={e => setCircleName(e.target.value)} maxLength={30} />
            ) : (
              <input className="loc-search" type="text" placeholder="Family code (e.g. ABC-234)" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={9} />
            )}
            <button className="loc-use-gps" disabled={busy} onClick={mode === 'create' ? doCreate : doJoin}>
              {busy ? 'Working…' : mode === 'create' ? 'Create family circle' : 'Join circle'}
            </button>
          </>
        ) : (
          <>
            <p className="setting-hint">{circle.circleName || 'Family circle'} — share this code with family so they can join:</p>
            <div className="family-code">{circle.code}</div>
            {members.length > 0 && (
              <div className="home-goals-list" style={{ marginTop: 10 }}>
                {members.map((m, i) => (
                  <div key={i} className={`home-goal-row${m.completed ? ' home-goal-done' : ''}`}>
                    <span className="home-goal-check">{m.completed ? '✓' : '○'}</span>
                    <span className="home-goal-name">{m.display_name}{m.isYou ? ' (you)' : ''}</span>
                    <span className="home-goal-status">🔥 {displayStreakOf(m)}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="seg-btn" style={{ marginTop: 12 }} disabled={busy} onClick={doLeave}>Leave circle</button>
          </>
        )}
      </div>
    </>
  )
}
