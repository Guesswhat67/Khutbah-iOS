import { registerPlugin } from '@capacitor/core'

// iOS WidgetKit + Android home-screen prayer widget. The previous version of this file
// was a no-op object literal; even though the iOS Swift plugin ships (`ios/App/App/NoorWidget.swift`),
// the JS side never called into it because nothing invoked `registerPlugin('NoorWidget')`.
// Now that the App Group UserDefaults bridge is wired on iOS, App.jsx's `NoorWidget.updateData(payload)`
// fires the native impl on iOS and the Android impl on Android; the web fallback is a
// silent no-op so vite-dev / web previews don't break.

export interface WidgetPrayerPayload {
  fajr: number
  sunrise: number
  dhuhr: number
  asr: number
  maghrib: number
  isha: number
  tomorrowFajr: number
  yesterdayIsha: number
  hijri: string
  city: string
  lat: number
  lng: number
  tempUnit: 'c' | 'f'
  dateKey: string
}

export interface NoorWidgetPlugin {
  updateData(payload: WidgetPrayerPayload): Promise<void>
  canScheduleExactAlarms(): Promise<{ allowed: boolean }>
  requestScheduleExactAlarms(): Promise<void>
}

// Native fallback for the web: a silent no-op. Native platforms get the platform
// impl; if the native plugin is unavailable (older iOS without the WidgetKit bridge,
// for instance), the web fallback takes over and the JS promise just resolves.
const webFallback: NoorWidgetPlugin = {
  async updateData() { /* no-op on web */ },
  // "allowed" keeps the Android exact-alarm banner permanently hidden when the
  // native plugin is missing (e.g. web preview).
  async canScheduleExactAlarms() { return { allowed: true } },
  async requestScheduleExactAlarms() { /* no-op on web */ },
}

export const NoorWidget = registerPlugin<NoorWidgetPlugin>('NoorWidget', {
  web: () => webFallback,
})
