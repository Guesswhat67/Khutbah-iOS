// iOS stub for the Android-native SherpaSTT Capacitor plugin.
// Same interface as android/src SherpaSTT.ts so App.jsx/QuranMode.jsx run unchanged.
//
// On iOS (Phases 1-4) there is NO on-device STT: ElevenLabs Scribe is the only
// engine. Background listening is covered by UIBackgroundModes=audio, so the
// foreground-session and battery-optimization methods are safe no-ops.
// Phase 5 (optional) replaces this stub with a real sherpa-onnx iOS plugin —
// keep the method signatures identical when that happens.

export interface ModelStatus {
  downloaded: boolean
  progress: number
}

export interface SherpaSTTPlugin {
  getModelStatus(): Promise<ModelStatus>
  downloadModel(): Promise<{ success: boolean }>
  getQuranModelStatus(): Promise<{ downloaded: boolean; progress: number }>
  downloadQuranModel(): Promise<{ success: boolean }>
  initialize(options?: { quranMode?: boolean; initialPrompt?: string }): Promise<void>
  startListening(): Promise<void>
  stopListening(): Promise<void>
  setSttMode(options: { mode: string }): Promise<void>
  getSttMode(): Promise<{ mode: string }>
  startForegroundSession(): Promise<void>
  stopForegroundSession(): Promise<void>
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestIgnoreBatteryOptimizations(): Promise<void>
  addListener(event: string, listener: (data: any) => void): Promise<any>
  removeAllListeners(): Promise<void>
}

let mode = 'off'

export const SherpaSTT: SherpaSTTPlugin = {
  // Report "downloaded" so no model-setup screen ever blocks the iOS app
  // (ElevenLabs needs no local models). startListening still fails loudly
  // below if the offline path is ever reached.
  async getModelStatus() { return { downloaded: true, progress: 100 } },
  async downloadModel() { return { success: true } },
  async getQuranModelStatus() { return { downloaded: true, progress: 100 } },
  async downloadQuranModel() { return { success: true } },

  async initialize() {
    throw new Error('On-device speech recognition is not available on iOS yet — use the ElevenLabs engine (Settings → Speech Engine).')
  },
  async startListening() {
    throw new Error('On-device speech recognition is not available on iOS yet — use the ElevenLabs engine (Settings → Speech Engine).')
  },
  async stopListening() {},

  async setSttMode(options: { mode: string }) { mode = options?.mode ?? 'off' },
  async getSttMode() { return { mode } },

  // Covered by UIBackgroundModes=audio on iOS — nothing to do.
  async startForegroundSession() {},
  async stopForegroundSession() {},

  // Android/One UI concept only; "true" keeps the battery banner hidden.
  async isIgnoringBatteryOptimizations() { return { ignoring: true } },
  async requestIgnoreBatteryOptimizations() {},

  async addListener(_event: string, _listener: (data: any) => void) {
    return { remove: async () => {} }
  },
  async removeAllListeners() {},
}
