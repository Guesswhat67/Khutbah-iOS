// Tiny fire-and-forget haptics wrapper around @capacitor/haptics.
// Every call is wrapped in try/catch and swallows errors so web builds (and any
// device without a vibrator) no-op silently — callers never need to await or guard.

import { Haptics, ImpactStyle } from '@capacitor/haptics'

// Light tap — e.g. incrementing a counter.
export function tick() {
  try { Haptics.impact({ style: ImpactStyle.Light }) } catch {}
}

// Strong, noticeable feedback — e.g. a goal reached. Heavy impact plus a longer
// vibration so completion is unmistakable even in a pocket.
export function success() {
  try { Haptics.impact({ style: ImpactStyle.Heavy }) } catch {}
  try { Haptics.vibrate({ duration: 400 }) } catch {}
}

// Medium single pulse — e.g. the tracker locking on.
export function pulse() {
  try { Haptics.impact({ style: ImpactStyle.Medium }) } catch {}
}
