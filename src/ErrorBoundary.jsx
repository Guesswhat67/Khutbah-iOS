import { Component } from 'react'
import { reportError } from './utils/sentry'

// Catches render-time JS errors anywhere below it and shows a message instead
// of a silent blank screen. Reportable layer wires Sentry.captureException
// behind a try/catch so a crashing crash reporter can't crash the boundary.
//
// PLAN-026 wiring: Sentry.reportError runs in componentDidCatch. The boundary
// itself preserves the existing in-app recovery UX (Reload button + visible
// error message). We deliberately DON'T replace this with Sentry.ErrorBoundary
// because:
//   • The custom UI was tuned for the iPad build (dark green theme, large
//     tap targets, a usable Reload button) — losing that on TestFlight day 1
//     would be a regression.
//   • Sentry's ErrorBoundary default UI doesn't render without an active
//     event handler, which is harder to test.
//   • reportError is a single importable util — adding it here keeps the
//     boundary stable and lets future code reuse the helper (notably
//     AsyncBoundary / fetch-failure surfaces).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    try {
      // Surface to logs if logging is enabled.
      console.error('App crashed:', error, info?.componentStack)
    } catch {}
    // Sentry report — PLAN-026. Wrapped so an Sentry SDK bug never crashes
    // the boundary that already caught a render-time error. The scrubber in
    // utils/sentry.js redacts location/audio/verse references before send.
    try { reportError(error, { extra: { boundary: 'app-root', hasComponentStack: !!info?.componentStack } }) } catch {}
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          padding: 24, textAlign: 'center', background: '#02120B', color: '#cfe9dc',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h2 style={{ margin: 0, color: '#f87171' }}>Something went wrong</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.85 }}>
            The app hit an unexpected error and stopped rendering.
          </p>
          <pre style={{
            maxWidth: '100%', overflow: 'auto', fontSize: '0.7rem',
            background: 'rgba(0,0,0,0.4)', padding: 12, borderRadius: 8,
            color: '#ffb4b4', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{String(this.state.error?.message || this.state.error)}</pre>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload() }}
            style={{
              padding: '12px 24px', fontSize: '1rem', fontWeight: 700, color: '#fff',
              background: '#10804b', border: 'none', borderRadius: 12, cursor: 'pointer',
            }}
          >Reload app</button>
        </div>
      )
    }
    return this.props.children
  }
}
