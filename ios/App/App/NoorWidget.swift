//
//  NoorWidget.swift
//  Noor (iOS)
//
//  Capacitor plugin that bridges the JS-side prayer payload to the iOS home-screen widget.
//  Mirrors the Android `NoorWidget` Capacitor plugin (see Khutbah/android/.../PrayerWidgetPlugin.kt
//  + NoorPrayerWidgetProvider.kt) so the same `getWidgetPayload(...)` JS plumbing drives both
//  platforms. On Android the payload lands in widget_state.json + AppWidgetProvider code; on iOS
//  we land it in the App Group's UserDefaults and ask WidgetKit to re-evaluate the timeline.
//
//  App Group:           group.com.ali.noor
//  UserDefaults key:    prayer_payload_v1   (JSON-encoded PrayerData; see PrayerData.swift
//                                              in the NoorWidgetExtension target)
//
//  Public surface (matches src/plugins/NoorWidget.ts):
//      updateData(payload)             → write JSON to App Group, reloadAllTimelines()
//      canScheduleExactAlarms()        → { allowed: true } (Android-only concern)
//      requestScheduleExactAlarms()    → resolve() no-op
//

import Foundation
import Capacitor
import WidgetKit

@objc(NoorWidget)
public class NoorWidget: CAPPlugin {

    // App Group identifier shared with the widget extension target.
    // When wiring the Xcode project manually, both the main app target AND the
    // NoorWidgetExtension target must list `group.com.ali.noor` under
    // "Signing & Capabilities → App Groups" with the same value.
    private static let appGroupIdentifier = "group.com.ali.noor"

    // UserDefaults key. Versioned so a future payload-shape change can ship
    // "prayer_payload_v2" without breaking the on-device widget on the first install.
    private static let payloadKey = "prayer_payload_v1"

    private static let lastPushedAtKey = "noor_widget_last_pushed_at_v1"

    // MARK: - JS-callable methods (must be @objc, names match TS interface)

    /// `updateData(payload)` — receive the prayer payload from JS, persist to the App
    /// Group's UserDefaults so the widget extension can read it, then ask WidgetKit to
    /// re-evaluate both the active widget and any snapshot WidgetKit is taking (e.g.
    /// for the Smart Stack).
    ///
    /// JS payload shape (camelCase keys, all epoch-ms where number) — see
    /// src/utils/prayer.js#getWidgetPayload:
    ///   {
    ///     fajr, sunrise, dhuhr, asr, maghrib, isha (numbers, epoch ms),
    ///     tomorrowFajr (number, epoch ms),
    ///     yesterdayIsha (number, epoch ms),
    ///     hijri (string), city (string),
    ///     lat (number), lng (number),
    ///     tempUnit ("c" | "f"),
    ///     dateKey ("YYYY-MM-DD")
    ///   }
    @objc public func updateData(_ call: CAPPluginCall) {
        guard var payload = call.options else {
            call.reject("updateData: missing payload argument (call.options is nil)")
            return
        }
        // Strip lat/lng before persisting to App-Group storage. The JS payload still
        // contains them for Home-screen weather on Android, but the iOS widget never
        // displays precise location (only the rounded city label); per NOOR_IOS.md
        // L389: "Weather was widget-only → drop entirely on iOS." Defense in depth
        // in case a future weather-cell developer accidentally reads these defaults.
        payload.removeValue(forKey: "lat")
        payload.removeValue(forKey: "lng")
        // NSDictionary → JSON Data. Use .sortedKeys so the on-device fingerprint is
        // stable (helps debugging if we ever diff two payloads in App Group).
        let json: Data
        do {
            json = try JSONSerialization.data(
                withJSONObject: payload,
                options: [.sortedKeys]
            )
        } catch {
            call.reject("updateData: failed to serialize payload — \(error.localizedDescription)")
            return
        }

        guard let defaults = UserDefaults(suiteName: Self.appGroupIdentifier) else {
            call.reject("updateData: App Group '\(Self.appGroupIdentifier)' is not available. Make sure both the main app and the NoorWidgetExtension targets have App Groups capability with this identifier (Signing & Capabilities → App Groups → +).")
            return
        }

        defaults.set(json, forKey: Self.payloadKey)
        defaults.set(Date().timeIntervalSince1970 * 1000, forKey: Self.lastPushedAtKey)
        // No need for defaults.synchronize() — App-Group UserDefaults writes are
        // atomic and visible to the widget extension on the next process startup
        // (WidgetKit's TimelineProvider is a separate process that re-reads on each
        // getTimeline() call).

        if #available(iOS 14.0, *) {
            // Tell all NoorWidget-extension timelines to re-evaluate.
            // reloadAllTimelines() is the canonical push-for-refresh API; safe to call
            // from any thread, costs nothing if there's no widget installed.
            WidgetCenter.shared.reloadAllTimelines()
        }

        call.resolve([
            "ok": true,
            "bytes": json.count,
            "appGroup": Self.appGroupIdentifier,
            "savedAt": Date().timeIntervalSince1970 * 1000
        ])
    }

    /// `canScheduleExactAlarms()` — Android-only concern (exact-alarm permission is
    /// gated behind `SCHEDULE_EXACT_ALARM` on Android 12+). On iOS, timeline refresh is
    /// handled by WidgetKit and we never request OS-level exact alarms, so we always
    /// report allowed=true. Mirrors what /src/PrayerLocationSettings.jsx expects.
    @objc public func canScheduleExactAlarms(_ call: CAPPluginCall) {
        call.resolve(["allowed": true])
    }

    /// `requestScheduleExactAlarms()` — Android-only UI intent (open the system
    /// settings page so the user can grant SCHEDULE_EXACT_ALARM). No-op on iOS —
    /// the JS caller awaits a successful resolution and proceeds.
    @objc public func requestScheduleExactAlarms(_ call: CAPPluginCall) {
        call.resolve()
    }
}
