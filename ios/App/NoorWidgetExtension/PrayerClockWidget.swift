//
//  PrayerClockWidget.swift
//  Noor (iOS widget extension)
//
//  The home-screen widget. Supports two families:
//    - .systemSmall  : one prayer next, big live countdown, Hijri strip at the bottom.
//    - .systemMedium : big "next prayer" tile + remaining-prayer strip below.
//
//  Live countdown: SwiftUI's Text(_:timerInterval:) re-renders the visible label
//  each second within the supplied range — so we don't have to ship hundreds of
//  timeline entries just to keep a clock ticking. The timeline itself only rotates
//  at prayer-time boundaries (see PrayerTimelineProvider.buildTimeline).
//
//  Pin Locale to en_US_POSIX so the AM/PM strip stays consistent regardless of the
//  user's device language (an Arabic device would otherwise show ص / م instead).
//
//  Visual palette — mirrors Noor's dark-on-emerald app:
//    - Background:   dark emerald / near-black
//    - Primary text: cream (#f0fdf4)
//    - Accent:       gold (#f4d175) for prayer-name highlight + countdown
//    - Muted:        cool grey (#94a3b8) for city + hijri strip
//

import SwiftUI
import WidgetKit

struct PrayerClockWidget: Widget {
    let kind: String = "PrayerClockWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PrayerTimelineProvider()) { entry in
            // iOS 17+ uses containerBackground(.background) for the widget chrome.
            // We keep the iOS 16+ fallback by branching on #available.
            if #available(iOSApplicationExtension 17.0, *) {
                PrayerClockView(entry: entry)
                    .containerBackground(for: .widget) {
                        LinearGradient(
                            colors: [Color(red: 0.04, green: 0.27, blue: 0.18),
                                     Color(red: 0.01, green: 0.07, blue: 0.05)],
                            startPoint: .top, endPoint: .bottom
                        )
                    }
            } else {
                PrayerClockView(entry: entry)
                    .padding()
                    .background(
                        LinearGradient(
                            colors: [Color(red: 0.04, green: 0.27, blue: 0.18),
                                     Color(red: 0.01, green: 0.07, blue: 0.05)],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
            }
        }
        .configurationDisplayName("Prayer Clock")
        .description("See your next prayer and countdown right on your home screen.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()  // we draw edge-to-edge for a cleaner home-screen look
    }
}

// MARK: - View switch

struct PrayerClockView: View {
    let entry: PrayerEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .systemMedium:
            MediumPrayerClockView(entry: entry)
        default:
            SmallPrayerClockView(entry: entry)
        }
    }
}

// MARK: - Small (single next-prayer tile)

struct SmallPrayerClockView: View {
    let entry: PrayerEntry

    var body: some View {
        let now = entry.date           // every entry's date is its "now" — Text(timerInterval:) ticks per second
        let next = entry.data.nextPrayerDate(now: now)

        VStack(alignment: .leading, spacing: 6) {
            // Tiny header
            HStack(spacing: 4) {
                Image(systemName: "moon.stars.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Color(red: 0.95, green: 0.82, blue: 0.46))   // gold
                Text("Noor")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 0.95, green: 0.82, blue: 0.46))
                Spacer()
                Text(entry.data.city)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .lineLimit(1)
            }
            .padding(.top, 2)

            Spacer(minLength: 0)

            // Next prayer name + LIVE countdown. SwiftUI's Text(_:timerInterval:)
            // auto-re-renders once per second inside the supplied range — the widget
            // is "live" without needing hundreds of timeline entries.
            VStack(alignment: .leading, spacing: 2) {
                Text("Next")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .textCase(.uppercase)
                Text(next.slot.name)
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.white)
                Text(timerInterval: now...next.date, countsDown: true, showsHours: true)
                    .font(.system(size: 28, weight: .heavy, design: .rounded).monospacedDigit())
                    .foregroundStyle(Color(red: 0.95, green: 0.82, blue: 0.46))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            // Hijri strip at the bottom
            Text(entry.data.hijri)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.55))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(14)
    }
}

// MARK: - Medium (big tile + remaining-prayer strip)

struct MediumPrayerClockView: View {
    let entry: PrayerEntry

    var body: some View {
        let now = entry.date
        let next = entry.data.nextPrayerDate(now: now)
        let previous = entry.data.previousPrayerDate(now: now)

        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack(spacing: 4) {
                Image(systemName: "moon.stars.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color(red: 0.95, green: 0.82, blue: 0.46))
                Text("Noor")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 0.95, green: 0.82, blue: 0.46))
                Spacer()
                Text(entry.data.hijri)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .lineLimit(1)
            }

            // Big "next prayer + LIVE countdown" row. Text(timerInterval:) ticks per
            // second automatically; the entry's date is the entry's effective "now"
            // (the first entry has date = Date(); later entries have date = prayer time).
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("NEXT")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.55))
                        .textCase(.uppercase)
                    Text(next.slot.name)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.white)
                    Text("after \(previous.slot.name)")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.55))
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(timerInterval: now...next.date, countsDown: true, showsHours: true)
                        .font(.system(size: 30, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundStyle(Color(red: 0.95, green: 0.82, blue: 0.46))
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                    Text(entry.data.city)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.55))
                        .lineLimit(1)
                }
            }

            Divider()
                .background(Color.white.opacity(0.15))

            // Remaining-prayer strip — show today's prayers from now forward,
            // wrapping to tomorrow's fajr when today's isha has passed.
            HStack(alignment: .top, spacing: 0) {
                ForEach(remainingSlots(data: entry.data, now: now), id: \.key) { slot in
                    VStack(spacing: 2) {
                        Text(slot.name)
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundStyle(Color.white.opacity(0.7))
                        Text(slot.shortTime)
                            .font(.system(size: 11, weight: .semibold, design: .rounded).monospacedDigit())
                            .foregroundStyle(slot.isNext ? Color(red: 0.95, green: 0.82, blue: 0.46) : Color.white)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
    }

    /// Returns the prayers that haven't passed yet today (or the slot that wraps
    /// around to tomorrow's fajr if isha has passed). Marks the immediate next
    /// one so we can highlight it in the strip. Times are rendered with a fixed
    /// en_US_POSIX locale so AM/PM stays consistent on Arabic/French devices.
    private func remainingSlots(data: PrayerData, now: Date) -> [(key: String, name: String, shortTime: String, isNext: Bool)] {
        let nowMs = now.timeIntervalSince1970 * 1000
        var rows: [(key: String, name: String, shortTime: String, isNext: Bool, sortKey: Double)] = []
        for slot in data.prayerSlots where slot.at > nowMs {
            let isNext = rows.isEmpty
            rows.append((slot.key, String(slot.name.prefix(3)), formatHM(epochMs: slot.at), isNext, slot.at))
        }
        if rows.isEmpty {
            rows.append(("fajr", "Faj", formatHM(epochMs: data.tomorrowFajr), true, data.tomorrowFajr))
        }
        rows.sort { $0.sortKey < $1.sortKey }
        return rows.map { ($0.key, $0.name, $0.shortTime, $0.isNext) }
    }

    /// "5:42 AM" — locale-pinned so every device shows the same string.
    private func formatHM(epochMs: Double) -> String {
        let d = Date(timeIntervalSince1970: epochMs / 1000)
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current        // user-local time
        f.dateFormat = "h:mm a"
        return f.string(from: d)
    }
}
