import React from 'react'

export const Icons = {
  Mic: () => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>,
  Pause: () => <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>,
  Stop: () => <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>,
  Analyze: () => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  Share: () => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>,
  Save: () => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
  // Noor mark — a mihrab niche with a glowing lamp (Ayat an-Nur).
  Logo: () => (
    <svg viewBox="0 0 64 64" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="noorBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#15633b"/><stop offset="1" stopColor="#04190f"/>
        </linearGradient>
        <radialGradient id="noorGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.95"/><stop offset="0.6" stopColor="#f1c75f" stopOpacity="0.3"/><stop offset="1" stopColor="#f1c75f" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="64" height="64" rx="16" fill="url(#noorBg)"/>
      <circle cx="32" cy="41" r="15" fill="url(#noorGlow)"/>
      <path d="M21,53 L21,35 A11,15 0 0 1 32,24 A11,15 0 0 1 43,35 L43,53" fill="none" stroke="#f4d175" strokeWidth="3" strokeLinejoin="round"/>
      <line x1="19" y1="53" x2="45" y2="53" stroke="#f4d175" strokeWidth="3" strokeLinecap="round"/>
      <line x1="32" y1="26" x2="32" y2="38" stroke="#f4d175" strokeWidth="2"/>
      <circle cx="32" cy="41" r="4.5" fill="#ffe9a8"/>
      <line x1="32" y1="33" x2="32" y2="49" stroke="#ffe9a8" strokeWidth="1.6" strokeLinecap="round" opacity="0.85"/>
      <line x1="24" y1="41" x2="40" y2="41" stroke="#ffe9a8" strokeWidth="1.6" strokeLinecap="round" opacity="0.85"/>
    </svg>
  ),
  Clear: () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>,
  // Luxury bookmark — dark-green ribbon, gold border, gold crescent + star.
  // Sized in em so existing button font-sizes control it. Solid fills (no
  // gradients/masks) keep it cheap when rendered once per verse (~6k instances).
  Bookmark: () => (
    <svg viewBox="0 0 40 56" width="1em" height="1em" style={{ display: 'inline-block', verticalAlign: '-0.18em' }} xmlns="http://www.w3.org/2000/svg">
      <path d="M6 17 A14 14 0 0 0 34 17 L34 51 L20 43 L6 51 Z" fill="#0e4d31" stroke="#f4d175" strokeWidth="2.5" strokeLinejoin="round"/>
      <circle cx="20" cy="27" r="8.5" fill="#f4d175"/>
      <circle cx="23.5" cy="25.3" r="7" fill="#0e4d31"/>
      <path d="M25.5 26.4 L26.4 28.8 L28.9 28.9 L26.9 30.5 L27.6 32.9 L25.5 31.5 L23.4 32.9 L24.1 30.5 L22.1 28.9 L24.6 28.8 Z" fill="#f4d175"/>
    </svg>
  ),
  // Onboarding slide icons + UI affordance icons. Same stroke tokens as the rest
  // of the registry so they scale via 1em×1em to whatever font-size the parent
  // provides. Rendering as SVG instead of emoji avoids the iOS WKWebView font
  // fallback that showed missing-glyph placeholders for some emoji in the system font.
  Welcome: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ),
  Quran: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  ),
  Detect: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M3 10v4"/>
      <line x1="6"  y1="9"  x2="6"  y2="15"/>
      <line x1="10" y1="6"  x2="10" y2="18"/>
      <line x1="14" y1="9"  x2="14" y2="15"/>
      <line x1="18" y1="7"  x2="18" y2="17"/>
      <circle cx="21" cy="12" r="1.6" fill="currentColor"/>
    </svg>
  ),
  // Stack of two books on a shelf with title lines on the spines — clearly distinct
  // from Icons.Quran (an open book across a vertical spine). The Quran and Maktaba
  // slides are adjacent in the Onboarding carousel, so visual differentiation matters.
  Maktaba: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M3 7h18"/>
      <rect x="3" y="9"  width="18" height="4" rx="1"/>
      <rect x="3" y="14" width="18" height="6" rx="1"/>
      <line x1="8"  y1="11" x2="14" y2="11"/>
      <line x1="8"  y1="17" x2="14" y2="17"/>
    </svg>
  ),
  Mosque: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M3 21h18"/>
      <path d="M5 21V12a7 7 0 0 1 14 0v9"/>
      <line x1="12" y1="3" x2="12" y2="6"/>
      <circle cx="12" cy="3" r="0.9" fill="currentColor"/>
    </svg>
  ),
  // Bottom-nav + dashboard tile icons. All 1em×1em so a parent font-size
  // (".nav-icon" = 1.42rem, ".section-divider" = 0.7rem, etc.) controls scale.
  // House silhouette with a centre door + a small chimney stroke for distinction.
  Home: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <path d="M9 22V12h6v10"/>
    </svg>
  ),
  // Classic 8-tooth gear with a centred hole — instantly readable as "settings".
  Settings: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  // A clock face with an arrow curving back — reads as "past / history".
  History: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
      <path d="M3 3v5h5"/>
      <path d="M12 7v5l3 2"/>
    </svg>
  ),
  // Question mark inside a circle — the Help affordance on Settings.
  Help: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <circle cx="12" cy="12" r="10"/>
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/>
      <line x1="12" y1="17" x2="12" y2="17.01"/>
    </svg>
  ),
  // Flame — Daily Streak divider.
  Streak: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
    </svg>
  ),
  // Crescent moon — Sunnah Fasting reminders divider (distinguished from
  // Icons.Welcome which is the Onboarding slide 1 "Welcome" mark).
  Sunnah: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3"/>
      <circle cx="17" cy="6" r="1.2" fill="currentColor" stroke="none"/>
      <circle cx="20" cy="9" r="0.8" fill="currentColor" stroke="none"/>
    </svg>
  ),
  // Bell with a slash — DND / notifications-off badge.
  BellOff: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8"/>
      <path d="M6.26 6.26A5.89 5.89 0 0 0 6 8c0 7-3 9-3 9h14"/>
      <path d="M18 8a6 6 0 0 0-9.33-5"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ),
  // Solid bell — "Morning Adhkar / Adhan notification" badge without slash.
  Bell: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  ),
  // Mic on a stand — Khutbah header / mode picker "Expert" pipeline.
  // Distinct from Icons.Mic (just a capsule): the floor stand reads as "speech / lecture".
  Khutbah: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <rect x="9" y="3" width="6" height="11" rx="3"/>
      <path d="M19 11v1a7 7 0 0 1-14 0v-1"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="8" y1="22" x2="16" y2="22"/>
      <line x1="12" y1="14" x2="12" y2="19"/>
    </svg>
  ),
  // Sun-with-rays — "Screen will stay awake" affordance in ReadyModal.
  // Distinct from Icons.BellOff (DND) so the two semantically different rows
  // don't look identical to the user.
  Awake: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <circle cx="12" cy="12" r="4"/>
      <line x1="12"   y1="2"    x2="12"   y2="4"/>
      <line x1="12"   y1="20"   x2="12"   y2="22"/>
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/>
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/>
      <line x1="2"    y1="12"   x2="4"    y2="12"/>
      <line x1="20"   y1="12"   x2="22"   y2="12"/>
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/>
      <line x1="17.66" y1="6.34"  x2="19.07" y2="4.93"/>
    </svg>
  ),
  // Five-point star — ModePicker "Medium".
  Star: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  // Stylised rocket — ModePicker "Expert".
  Rocket: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
    </svg>
  ),
  // Crosshair / target — Home tile for goals tab. Distinct from Icons.Quran
  // and Icons.Mosque so it reads as "goals / aim".
  Target: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <circle cx="12" cy="12" r="9"/>
      <circle cx="12" cy="12" r="5"/>
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
      <line x1="12" y1="1" x2="12" y2="4"/>
      <line x1="12" y1="20" x2="12" y2="23"/>
      <line x1="1" y1="12" x2="4" y2="12"/>
      <line x1="20" y1="12" x2="23" y2="12"/>
    </svg>
  ),
  // Filled play triangle — StreakBanner "▶ Read" button (replaces the emoji so
  // iOS WKWebView no longer shows a placeholder glyph).
  Play: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M7 5 L19 12 L7 19 Z"/>
    </svg>
  ),
  // Mirrored play triangle (pointing left) — "◀ Prev" button in Detect mode.
  Prev: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none" style={{ display: 'inline-block', verticalAlign: '-0.18em' }}>
      <path d="M17 5 L5 12 L17 19 Z"/>
    </svg>
  ),
}
