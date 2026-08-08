//
//  PrayerData.swift
//  Noor (iOS widget extension)
//
//  Shared, versioned Codable payload. The same struct is serialized by JS (via
//  getWidgetPayload() in src/utils/prayer.js) into App-Group UserDefaults and then
//  decoded here by the TimelineProvider. Field names match the JS keys verbatim so
//  JSONEncoder / JSONDecoder work out of the box (no CodingKeys mapping needed).
//
//  Schema version: "prayer_payload_v1" (see UserDefaults key in NoorWidget.swift).
//
//  All `at` / `tomorrowFajr` / `yesterdayIsha` values are epoch milliseconds, matching
//  `Date(timeIntervalSince1970: at / 1000)` on the JS side.
//
//  Privacy: lat/lng are intentionally NOT stored here. The JS payload includes them
//  (for Home screen weather on Android), and Swift Codable's default behavior simply
//  ignores unknown keys on decode — so the iOS widget never persists or transmits
//  precise coordinates. Per NOOR_IOS.md L389: "Weather was widget-only → drop
//  entirely on iOS."
//

import Foundation

/// All scalar fields mirror the JS `getWidgetPayload(...)` output. Keep the names in sync.
struct PrayerData: Codable, Equatable, Hashable, Sendable {
    /// Today's six prayers as epoch ms (ms since 1970-01-01 UTC).
    /// Order matches `PRAYER_ORDER` in src/utils/prayer.js: fajr, sunrise, dhuhr, asr, maghrib, isha.
    var fajr: Double
    var sunrise: Double
    var dhuhr: Double
    var asr: Double
    var maghrib: Double
    var isha: Double

    /// Tomorrow's Fajr as epoch ms — used to keep the countdown running past midnight
    /// (after today's isha passes, "next prayer" becomes tomorrow's fajr).
    var tomorrowFajr: Double

    /// Yesterday's Isha as epoch ms — used for the optional "carry" entry (showing
    /// the previous-most-recent prayer back to yesterday's isha when no prayer has
    /// passed yet today). Equal to fajr of today when the day has rolled over.
    var yesterdayIsha: Double

    /// Formatted Hijri date string, e.g. "Wed 16 Muharram · 1 Jul".
    var hijri: String

    /// City label the widget shows in the corner ("Mecca", "Toronto", etc.) —
    /// never raw coordinates so the home-screen widget never leaks the user's location.
    var city: String

    /// "c" or "f" — temperature unit preference for any future weather widget cell.
    /// Not displayed today (per NOOR_IOS.md: "Weather was widget-only → drop entirely on iOS").
    var tempUnit: String

    /// Calendar day key in YYYY-MM-DD (timezone-naive). Lets the TimelineProvider
    /// detect a calendar rollover and discard the cached payload (so the widget doesn't
    /// somehow show last night's prayers).
    var dateKey: String

    // MARK: - Explicit memberwise initializer
    //
    // We define this *explicitly* (rather than relying on Swift's synthesized
    // memberwise init) to dodge a known Xcode cache/indexer bug in
    // `PBXFileSystemSynchronizedRootGroup` targets: when stored properties are
    // added to a struct mid-session, the indexer can hold a stale module
    // signature that "remembers" the old (smaller) memberwise init, producing
    // errors like:
    //     "Extra arguments at positions #11, #12 in call"
    // …against perfectly valid call sites that match the on-disk struct.
    //
    // Defining the init here locks the 12-arg signature into the AST so the
    // compiler can't disagree with the source file. Functionally identical to
    // the synthesized memberwise init — just not synthesized.
    //
    // NOTE: Codable / Equatable / Hashable / Sendable synthetic conformances
    // are not affected by this explicit init — they keep generating normally.
    //
    init(
        fajr: Double,
        sunrise: Double,
        dhuhr: Double,
        asr: Double,
        maghrib: Double,
        isha: Double,
        tomorrowFajr: Double,
        yesterdayIsha: Double,
        hijri: String,
        city: String,
        tempUnit: String,
        dateKey: String
    ) {
        self.fajr = fajr
        self.sunrise = sunrise
        self.dhuhr = dhuhr
        self.asr = asr
        self.maghrib = maghrib
        self.isha = isha
        self.tomorrowFajr = tomorrowFajr
        self.yesterdayIsha = yesterdayIsha
        self.hijri = hijri
        self.city = city
        self.tempUnit = tempUnit
        self.dateKey = dateKey
    }

    // MARK: - Convenience helpers

    /// The six prayer slots in canonical order, with both the JS key and a localized
    /// display name. The widget view uses `name` for the visible label; `at` is the
    /// epoch ms (use `Date(timeIntervalSince1970: at / 1000)` to get a Date).
    var prayerSlots: [(key: String, name: String, at: Double)] {
        [
            ("fajr",    "Fajr",    fajr),
            ("sunrise", "Sunrise", sunrise),
            ("dhuhr",   "Dhuhr",   dhuhr),
            ("asr",     "Asr",     asr),
            ("maghrib", "Maghrib", maghrib),
            ("isha",    "Isha",    isha),
        ]
    }

    /// Resolve a single slot's Date so callers don't keep doing `Date(timeIntervalSince1970: x / 1000)`.
    func date(forSlotAt at: Double) -> Date {
        Date(timeIntervalSince1970: at / 1000.0)
    }

    /// Index (0..5) of the prayer whose `at` time is the latest one ≤ `now`.
    /// Returns nil if `now` is before today's fajr — the widget should fall back to
    /// "current is yesterday's isha" and "next is today's fajr" instead.
    func indexOfLatestPrayer(now: Date) -> Int? {
        let nowMs = now.timeIntervalSince1970 * 1000.0
        var bestIdx: Int? = nil
        var bestAt: Double = -.infinity
        for (i, slot) in prayerSlots.enumerated() {
            if slot.at <= nowMs && slot.at > bestAt {
                bestAt = slot.at
                bestIdx = i
            }
        }
        return bestIdx
    }

    /// Index (0..5) of the next prayer whose `at` time is the smallest one > `now`.
    /// If today is fully past (now > isha), returns nil and the caller should use
    /// `tomorrowFajr` as the next.
    func indexOfNextPrayer(now: Date) -> Int? {
        let nowMs = now.timeIntervalSince1970 * 1000.0
        for (i, slot) in prayerSlots.enumerated() {
            if slot.at > nowMs { return i }
        }
        return nil
    }

    /// Date of the *next* prayer after `now`. Falls back to `tomorrowFajr` once
    /// today's isha has passed.
    func nextPrayerDate(now: Date) -> (slot: (key: String, name: String, at: Double), date: Date) {
        if let i = indexOfNextPrayer(now: now) {
            let s = prayerSlots[i]
            return (s, date(forSlotAt: s.at))
        }
        // Past today's isha — show tomorrow's fajr as the next prayer.
        let dummy = (key: "fajr", name: "Fajr", at: tomorrowFajr)
        return (dummy, date(forSlotAt: tomorrowFajr))
    }

    /// Date of the *most recent* prayer ≤ `now`. If today hasn't reached fajr yet,
    /// returns yesterday's isha (one day rollover, just for display).
    func previousPrayerDate(now: Date) -> (slot: (key: String, name: String, at: Double), date: Date) {
        if let i = indexOfLatestPrayer(now: now) {
            let s = prayerSlots[i]
            return (s, date(forSlotAt: s.at))
        }
        // Before today's fajr → use yesterday's isha as the "previous" reference.
        let dummy = (key: "isha", name: "Isha", at: yesterdayIsha)
        return (dummy, date(forSlotAt: yesterdayIsha))
    }
}
