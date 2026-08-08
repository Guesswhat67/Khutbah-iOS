# Noor — iOS

The iOS version of the Noor app (Quran recitation detection, live khutbah translation, prayer times, streaks, and daily worship) for Ali's family.

**Start here → [NOOR_IOS.md](NOOR_IOS.md)** — the complete build spec and live progress log. The **⚡ LIVE PROGRESS** section at the top always has the current state and the exact next steps.

- Stack: React 18 + Vite 5 + Capacitor 8 (iOS)
- Parity target: Android Noor v8.23.0 (branch `aliandroidv2`)
- Backend: shared with Android (Cloudflare Pages `khutbah-v2`) — no server changes needed
- Tests: `npm run test:tracker` / `test:stream` / `test:bulk` / `test:mega` (all must stay green; CI enforces this on push)

⚠️ Builds need a `.env.local` containing `VITE_APP_TOKEN` (ask Ali) — without it the app runs but all AI features return 401.
