import UIKit
import AVFoundation
import Capacitor
#if canImport(Sentry)
import Sentry
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // PLAN-026: Sentry native crash capture (early-bound, before WKWebView
        // loads — catches crashes that happen between AppDelegate launch and
        // the JS-side Sentry.init). Gated on three conditions:
        //   1. `canImport(Sentry)` — the @sentry/capacitor SPM dep must already
        //      be linked (post `npx cap sync ios` after `npm install`).
        //   2. The `SentryDSN` Info.plist key is present and non-empty.
        //   3. The Info.plist lookup overrides any stale env-local leakage.
        // If any of these fails, the SDK is a no-op and the app boots normally.
        // Privacy-first option profile below — every auto-capture path is
        // disabled (no swizzling, no screenshots, no view hierarchy, no UIKit
        // tracing, no fetch breadcrumb, no PII). The same scrubber policy is
        // enforced on the JS side via `src/utils/sentry.js`.
        #if canImport(Sentry)
        if let raw = Bundle.main.object(forInfoDictionaryKey: "SentryDSN") as? String {
            let dsn = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !dsn.isEmpty {
                SentrySDK.start { options in
                    options.dsn = dsn
                    #if DEBUG
                    options.environment = "development"
                    #else
                    options.environment = "production"
                    #endif
                    options.releaseName = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
                    options.sendDefaultPii = false
                    options.attachScreenshot = false
                    options.attachViewHierarchy = false
                    options.enableAutoSessionTracking = true
                    options.enableAppHangTracking = true
                    // Disable every auto-instrumenter that could capture user
                    // data (UIKit swizzling, fetch headers, file IO, timing
                    // aggregates). Privacy over debugging convenience for a
                    // religious-familial app.
                    options.enableUIViewControllerTracing = false
                    options.enableUserInteractionTracing = false
                    options.enableNetworkTracking = false
                    options.enableFileIOTracing = false
                    options.enableCoreDataTracing = false
                    options.enableSwizzling = false
                    options.enableMetrics = false
                    options.maxBreadcrumbs = 0
                }
            }
        }
        #endif

        // Keep WKWebView getUserMedia capture alive when the screen locks / app
        // backgrounds (Quran Detect during salah, Khutbah translation). Works
        // together with UIBackgroundModes=audio in Info.plist. .playAndRecord +
        // .mixWithOthers avoids killing other apps' audio; category config alone
        // never triggers the mic permission prompt (getUserMedia does that).
        let session = AVAudioSession.sharedInstance()
        // PLAN-024.1 (Bug #13): options trade-off, kept verbatim from earlier
        // Claude Fable session with this audit trip expanded for future-me:
        //
        //  .mixWithOthers
        //    + Lets the user keep listening to / playing a nasheed podcast
        //      while the mic is capturing during Detect — they don't have to
        //      kill their Quran audio to use the app.
        //    - On an incoming phone call iOS deactivates us regardless; this
        //      option does NOT prevent the OS from reclaiming the mic. The
        //      only real mitigation for "call kills mic capture" is to use
        //      ABRecord on a recording audio unit (not done here — getUserMedia
        //      path is sufficient for the use case).
        //    - Combined with .playAndRecord, .mixWithOthers reduces session
        //      priority vs other apps' audio DURING playback. This is what we
        //      want — the recitation audio from another app shouldn't be
        //      overwritten.
        //
        //  .allowBluetooth
        //    + Masjid users on AirPods / BT headsets use the BT mic rather than
        //      the iPad mic; without this option, AVAudioSession falls back to
        //      the built-in mic and AirPod mics are ignored.
        //    - Some users see unexpected re-routing when first connected; the
        //      system Settings app is the override knob.
        //
        //  .defaultToSpeaker
        //    + During normal use (khutbah / Detect), the audio output goes to
        //      the iPad's bottom-firing speaker rather than the earpiece —
        //      important so the user can hear ElevenLabs Scribe's `scribe_v2_realtime`
        //      partials on iPhone.
        //    - On iPad there's no earpiece, so this option is essentially a
        //      no-op there. Kept for the iPhone path so the same AppDelegate
        //      works on both device classes.
        //
        // No code change here — keep verifying on real hardware that the
        // combination survives an incoming call without dropping the capture.
        try? session.setCategory(.playAndRecord,
                                 mode: .default,
                                 options: [.mixWithOthers, .allowBluetooth, .defaultToSpeaker])
        try? session.setActive(true)
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
