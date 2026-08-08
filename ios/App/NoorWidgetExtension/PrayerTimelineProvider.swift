//
//  PrayerTimelineProvider.swift
//  Noor (iOS widget extension)
//
//  Reads PrayerData.json from the App Group's UserDefaults (written by the main app's
//  NoorWidget Capacitor plugin) and constructs WidgetKit timeline entries.
//
//  Refresh strategy:
//    - 7 entries per timeline: today at "now" → today-is-isha → tomorrow-fajr.
//      The widget's SwiftUI Text(timerInterval:) handles the per-second countdown
//      against each entry's `date` automatically; the timeline itself only rotates
//      at prayer boundaries.
//    - Policy: `.atEnd` so WidgetKit calls back here after the last entry passes.
//      At that point we re-read the App-Group payload (the user has likely opened the
//      app at least once since, refreshing tomorrow's prayer times).
//    - Belt-and-suspenders: when the JS side pushes a new payload via
//      `NoorWidget.updateData(...)`, the main app calls
//      `WidgetCenter.shared.reloadAllTimelines()` which immediately re-runs
//      `getTimeline(...)` below.
//

import Foundation
import WidgetKit

/// A single WidgetKit timeline entry. `date` is the wall-clock instant the widget
/// will display this snapshot AT. `kind` lets the SwiftUI view render different copy
/// (e.g. "starting fresh after isha passes" vs "mid-day update").
struct PrayerEntry: TimelineEntry {
    let date: Date
    let data: PrayerData
    /// What kind of timeline beat this is — used by the view to choose copy.
    enum Kind: String, Codable {
        /// Widget appeared just now; show the next prayer + countdown.
        case current
        /// A prayer boundary just passed in this entry — the view can fade in
        /// a corner indicator if it wants, or just keep the countdown rolling.
        case atPrayerTime
    }
    let kind: Kind
}

struct PrayerTimelineProvider: TimelineProvider {

    static let appGroupIdentifier = "group.com.ali.noor"
    static let payloadKey = "prayer_payload_v1"

    // MARK: - Static fallback (placeholder + snapshot)

    /// Placeholder shown in the widget gallery / first frame before the real
    /// payload arrives. Keep it self-contained and free of side effects so the
    /// gallery preview never reads App-Group storage.
    func placeholder(in context: Context) -> PrayerEntry {
        PrayerEntry(
            date: Date(),
            data: PrayerData.placeholder(),
            kind: .current
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (PrayerEntry) -> Void) {
        // For .systemSmall / .systemMedium previews, prefer real data; fall back
        // to placeholder so the widget still renders if the App Group is empty
        // (e.g. simulator first-launch without running the host app).
        if let data = PrayerData.loadFromAppGroup() {
            completion(PrayerEntry(date: Date(), data: data, kind: .current))
        } else {
            completion(placeholder(in: context))
        }
    }

    // MARK: - Real timeline

    func getTimeline(in context: Context, completion: @escaping (Timeline<PrayerEntry>) -> Void) {
        guard let data = PrayerData.loadFromAppGroup() else {
            // No fresh payload — WidgetKit's gallery placeholder is fine; we'll be
            // re-pinged the next time the host app calls updateData().
            completion(Timeline(entries: [placeholder(in: context)], policy: .never))
            return
        }

        let entries = Self.buildTimeline(for: data, around: Date())
        // `.atEnd` so when the last entry's date passes (e.g. tomorrow's fajr time),
        // WidgetKit invokes us again to rebuild. At that point the user has
        // almost certainly opened the app at least once, scheduling a new payload.
        let lastDate = entries.last?.date ?? Date().addingTimeInterval(60 * 60)
        completion(Timeline(entries: entries, policy: .atEnd))
        _ = lastDate  // (TimelineDate implicitly built; kept here for readability)
    }

    // MARK: - Timeline construction

    /// Builds 7 entries covering: now, today's fajr, sunrise, dhuhr, asr, maghrib, isha,
    /// tomorrow's fajr. Each entry's `date` is the wall-clock instant the widget
    /// should display — for the "now" entry we set it to `now` itself; for prayer-boundary
    /// entries we set it to the prayer's time. The widget's SwiftUI view then uses
    /// SwiftUI's Text(timerInterval:) which auto-re-renders each second until `date`.
    static func buildTimeline(for data: PrayerData, around now: Date) -> [PrayerEntry] {
        // First entry: immediate snapshot — show the next prayer + countdown right now.
        var entries: [PrayerEntry] = [PrayerEntry(date: now, data: data, kind: .current)]

        // Then one entry per *future* prayer today. Each entry's date is that prayer's time.
        for slot in data.prayerSlots {
            let slotDate = data.date(forSlotAt: slot.at)
            guard slotDate > now else { continue }   // skip prayers that already passed
            entries.append(PrayerEntry(date: slotDate, data: data, kind: .atPrayerTime))
        }

        // Final entry: tomorrow's fajr (so the countdown keeps running through the night).
        let fajrTomorrow = data.date(forSlotAt: data.tomorrowFajr)
        if !entries.contains(where: { abs($0.date.timeIntervalSince(fajrTomorrow)) < 1 }) {
            entries.append(PrayerEntry(date: fajrTomorrow, data: data, kind: .atPrayerTime))
        }

        // Type-earlier wall-clock entries first so the timeline is monotonic.
        entries.sort { $0.date < $1.date }
        return entries
    }
}

// MARK: - Storage helpers (used by both Provider and the bundled view for the gallery)

extension PrayerData {
    /// Load the JSON-encoded payload from App Group UserDefaults. Returns nil if
    /// the group isn't reachable (capability not set up) or the payload is missing /
    /// malformed.
    static func loadFromAppGroup(
        appGroup: String = PrayerTimelineProvider.appGroupIdentifier,
        key: String = PrayerTimelineProvider.payloadKey
    ) -> PrayerData? {
        guard let defaults = UserDefaults(suiteName: appGroup) else { return nil }
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(PrayerData.self, from: data)
    }

    /// Self-contained placeholder used when the App Group hasn't received any payload
    /// yet (e.g. simulator before the host app has run at least once). Numbers are
    /// fixed & clearly-fake-but-recognizable so the gallery thumbnail doesn't look
    /// like a real prayer time.
    static func placeholder() -> PrayerData {
        // Pick a static "today at 14:30 local" so the gallery preview is consistent.
        let comps = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        var baseComps = DateComponents()
        baseComps.year = comps.year
        baseComps.month = comps.month
        baseComps.day = comps.day
        baseComps.hour = 14
        baseComps.minute = 30
        let dhuhr = Calendar.current.date(from: baseComps)?.timeIntervalSince1970 ?? 0
        let prayers: [(Double, Double, Double)] = [
            (0,    1*60*60*1000, dhuhr - 5*60*60*1000),  // fajr    5h before dhuhr
            (1,    2*60*60*1000, dhuhr - 30*60*1000),    // sunrise 30m before dhuhr
            (2,    3*60*60*1000, dhuhr),                 // dhuhr   (anchor)
            (3,    4*60*60*1000, dhuhr + 3*60*60*1000),  // asr     3h after dhuhr
            (4,    5*60*60*1000, dhuhr + 4*60*60*1000),  // maghrib 4h after dhuhr
            (5,    6*60*60*1000, dhuhr + 5*60*60*1000),  // isha    5h after dhuhr
        ]
        return PrayerData(
            fajr:             prayers[0].2,
            sunrise:          prayers[1].2,
            dhuhr:            prayers[2].2,
            asr:              prayers[3].2,
            maghrib:          prayers[4].2,
            isha:             prayers[5].2,
            tomorrowFajr:     dhuhr + 24*60*60*1000 - 5*60*60*1000,
            yesterdayIsha:    dhuhr - 24*60*60*1000 + 5*60*60*1000,
            hijri:            "Add Noor to your home",
            city:             "—",
            tempUnit:         "c",
            dateKey:          String(format: "%04d-%02d-%02d",
                                     comps.year ?? 2024,
                                     comps.month ?? 1,
                                     comps.day ?? 1)
        )
    }
}
