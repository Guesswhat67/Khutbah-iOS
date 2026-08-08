import { SpeechRecognition } from '@capacitor-community/speech-recognition';

// Apple STT wrapper for Khutbah + Quran Detect (mimicking the ElevenLabs/Sherpa API).
// Provides a unified startListening / stopListening interface.
//
// Bug fixes (chronological):
//   #5 — The previous version called `SpeechRecognition.addListener('partialResults', …)`
//        every time `startListening()` ran but only `removeAllListeners()` cleared it on
//        stop. After several pause/resume cycles the internal listener stacked, leaking
//        memory and firing every result N times. We now store the inner handle and
//        remove it explicitly on stop.
//   #6 — `language: 'ar-SA'` was hardcoded. We now accept an explicit language on each
//        startListening() call so the user's sourceLang (eg ar-EG / ur-PK) is honored.
//   #H3 — `reset()` did not call `SpeechRecognition.stop()`, so the native recognizer
//         kept streaming audio even after JS listeners were torn down. Now it does.
//   #H4 — `addListener('partialResults', …)` rejection was uncaught: we marked
//         `isListening = true` then leaked through. Now wrapped in try/catch with
//         rollback so a failed init leaves the wrapper fully idle.
//   #H5 — `stopListening()` previously left the public `listeners` array populated,
//         so pause/resume cycles accumulated handlers and each partial fired to N+1
//         callbacks. `stopListening()` now also clears the public listeners — callers
//         re-register after each start, matching the ElevenLabs Scribe semantics where
//         each session is one-shot.

let isListening = false
let listeners = []
// Tracks the inner SpeechRecognition.addListener handle so we can remove just the one
// listener we added (rather than nuking every listener the host app registered).
let innerHandle = null

// Cleans up any stale SpeechRecognition listener we added. Used as a single
// point in both startListening (on failure) and reset().
async function dropInner() {
  if (!innerHandle) return
  try { await innerHandle.remove() } catch {}
  innerHandle = null
}

export const AppleSTT = {
  // Harmless if no options are passed — perf mode defaults to 'medium' and isn't
  // wired to any native API on iOS yet, but accepting it avoids surface-level
  // ApiMismatch surprises when callers migrate from the native-Sherpa world.
  async initialize(_options = {}) {
    try {
      const hasPermission = await SpeechRecognition.checkPermissions()
      if (hasPermission.speechRecognition !== 'granted') {
        await SpeechRecognition.requestPermissions()
      }
    } catch (e) {
      console.error('Failed to initialize Apple STT', e)
    }
  },

  async startListening({ language = 'ar-SA' } = {}) {
    if (isListening) return

    // Bug fix #N1: probe the Capacitor bridge BEFORE setting isListening so a
    // broken plugin surfaces as a recognizable `AAPLESTT_UNAVAILABLE:` error
    // instead of leaking through into the listener / start chain. The
    // @capacitor-community/speech-recognition native side fails to register
    // when the dual-target SPM split (Plugin.swift + Plugin.m in different
    // targets) doesn't pull the ObjC constructor into the App's binary.
    // When that happens Capacitor's bridge throws "SpeechRecognition
    // plugin is not implemented on iOS" — the user sees that string in the
    // toast and App.jsx falls back to ElevenLabs Scribe (already wired).
    try {
      const probe = await SpeechRecognition.available()
      if (!probe || probe.available !== true) {
        throw new Error('SpeechRecognition reports available=false on this iOS device.')
      }
    } catch (e) {
      throw new Error('AAPLESTT_UNAVAILABLE: ' + (e?.message || String(e)))
    }

    isListening = true

    // Bug #H4: wrap addListener so a rejection rolls back isListening instead of
    // leaving the wrapper in a stuck "listening" state with no inner handle.
    try {
      innerHandle = await SpeechRecognition.addListener('partialResults', (data) => {
        const text = data.matches?.[0]
        if (text) listeners.forEach(l => l({ text }))
      })
    } catch (e) {
      isListening = false
      throw e
    }

    try {
      await SpeechRecognition.start({
        language,
        // maxResults=5 gives the recognizer a richer best-of list for the partial
        // callback, which improves accuracy on noisy Arabic / Urdu audio.
        maxResults: 5,
        prompt: 'Say something',
        partialResults: true,
        popup: false,
      })
    } catch (e) {
      console.error('Apple STT startListening error', e)
      isListening = false
      await dropInner()
      throw e
    }
  },

  async stopListening() {
    if (!isListening) return
    try {
      await SpeechRecognition.stop()
    } catch (e) {
      console.error('Apple STT stopListening error', e)
    }
    // Bug #H5: drop the inner SpeechRecognition handle AND clear the public listener
    // list. Each start is a one-shot session (matches ElevenLabs Scribe semantics);
    // callers re-register `addListener('result', …)` after each start. Without this
    // clear, repeated pause/resume cycles accumulated handlers and every partial
    // fired to N+1 callbacks, producing duplicate feed pushes.
    await dropInner()
    listeners = []
    isListening = false
  },

  async addListener(event, listener) {
    if (event === 'result') listeners.push(listener)
    return {
      remove: async () => {
        listeners = listeners.filter(l => l !== listener)
      },
    }
  },

  async removeAllListeners() {
    listeners = []
  },

  // Reset all state — used on app teardown / engine swaps.
  async reset() {
    // Bug #H3: explicitly stop the native recognizer. Without this, a previous engine
    // session keeps streaming audio after the JS listeners were torn down, and the
    // next start races with the still-running predecessor.
    try { await SpeechRecognition.stop() } catch {}
    listeners = []
    await dropInner()
    isListening = false
  },
}
