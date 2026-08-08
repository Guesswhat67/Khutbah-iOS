import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { initLogger } from './utils/logger'
import { initSentry, reportError } from './utils/sentry'

// PLAN-026: Sentry.init MUST run before anything that could throw — that's
// initLogger (which wraps console, so any subsequent error fires a hook we want
// captured) and createRoot (which evaluates every top-level React render and
// any lazy module). Safe no-op when VITE_SENTRY_DSN isn't set.
initSentry()

// PLAN-026: unhandledrejection is the second most common crash source after
// React render errors. ErrorBoundary does not catch it. Forward every
// uncaught rejection to Sentry via reportError so TestFlight families'
// "app just stopped, screen froze" reports land in our dashboard. Wrapped
// in try/catch so an Sentry SDK failure can't crash the main thread.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = e?.reason ?? new Error('unhandled rejection (no reason)')
      // Wrap non-Error rejections so Sentry's group-by-error grouping works.
      // For string/number/boolean reasons, use String(). For object reasons,
      // JSON.stringify so Sentry groups them by their content (not the
      // useless "[object Object]" placeholder that String() produces).
      // Both paths are length-bounded so a pathologically huge payload can't
      // blow up the event.
      let wrapped
      if (reason instanceof Error) {
        wrapped = reason
      } else if (reason && typeof reason === 'object') {
        try { wrapped = new Error(JSON.stringify(reason).slice(0, 500)) }
        catch { wrapped = new Error('unhandled rejection (object, unserializable)') }
      } else {
        wrapped = new Error(String(reason).slice(0, 500))
      }
      reportError(wrapped, { extra: { boundary: 'unhandledrejection', reasonType: typeof reason } })
      if (typeof console !== 'undefined' && console.error) console.error('[unhandledrejection]', reason)
    } catch { /* never crash the handler over a crash report */ }
  })
}

initLogger()
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
