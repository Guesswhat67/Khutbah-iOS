//
//  NoorWidgetExtension.swift
//  Noor (iOS widget extension)
//
//  @main entry point for the widget extension. Bundles every widget we ship;
//  currently just `PrayerClockWidget`, but new widgets (e.g. "Daily Verse",
//  "Hijri Date", "Streak Counter") can be appended to the bundle without
//  touching the host app.
//

import SwiftUI
import WidgetKit

@main
struct NoorWidgetExtension: WidgetBundle {
    var body: some Widget {
        PrayerClockWidget()
    }
}
