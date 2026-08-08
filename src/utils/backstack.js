// Tiny coordination layer for the Android hardware back button.
//
// The app navigates by React state spread across components (App view, QuranMode's
// quranView, ReferenceMode's mView, plus modals). A component that has an internal
// "back" step registers a handler here while it's mounted. On a hardware back press,
// App walks the handlers most-recent-first; the first one that returns true consumes
// the press (it popped a modal / sub-view). If none do, App handles it at the app
// level (secondary tab → Home, or double-press to exit at Home).

const handlers = []

// Register a back handler. Returns an unregister function (call in a cleanup).
export function pushBackHandler(fn) {
  handlers.push(fn)
  return () => {
    const i = handlers.indexOf(fn)
    if (i >= 0) handlers.splice(i, 1)
  }
}

// Run handlers newest-first; stop at the first that returns true. Returns whether
// any handler consumed the back press.
export function runBackHandlers() {
  for (let i = handlers.length - 1; i >= 0; i--) {
    try { if (handlers[i]()) return true } catch {}
  }
  return false
}
