// Generates the iOS launch-screen splash (2732x2732 universal) — dark green
// with the mihrab-lamp motif centered, matching the app theme so launch does
// not flash white. Writes all three slots in Splash.imageset.
// Run: node scripts/gen-ios-splash.cjs
const sharp = require('sharp')
const path = require('path')

const DIR = path.join(__dirname, '..', 'ios', 'App', 'App',
  'Assets.xcassets', 'Splash.imageset')

const motif = `
  <circle cx="54" cy="62" r="20" fill="url(#glow)"/>
  <path d="M39,78 L39,50 A15,21 0 0 1 54,33 A15,21 0 0 1 69,50 L69,78" fill="none" stroke="#f4d175" stroke-width="4" stroke-linejoin="round"/>
  <line x1="36" y1="78" x2="72" y2="78" stroke="#f4d175" stroke-width="4" stroke-linecap="round"/>
  <line x1="54" y1="36" x2="54" y2="58" stroke="#f4d175" stroke-width="2.4"/>
  <circle cx="54" cy="62" r="6" fill="#ffe9a8"/>
  <circle cx="54" cy="62" r="6" fill="none" stroke="#f4d175" stroke-width="1.6"/>
  <line x1="54" y1="50" x2="54" y2="74" stroke="#ffe9a8" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>
  <line x1="42" y1="62" x2="66" y2="62" stroke="#ffe9a8" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>
`

const defs = `
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffe9a8" stop-opacity="0.95"/>
      <stop offset="0.6" stop-color="#f1c75f" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#f1c75f" stop-opacity="0"/>
    </radialGradient>
  </defs>
`

// 324-unit canvas = motif (108) centered at 1/3 scale relative to full frame;
// solid app background (--bg #02120B) so any aspect-fill crop stays uniform.
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 324 324">${defs}` +
  `<rect x="0" y="0" width="324" height="324" fill="#02120B"/>` +
  `<g transform="translate(108,108)">${motif}</g></svg>`

;(async () => {
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await sharp(Buffer.from(svg)).flatten({ background: '#02120B' }).png()
      .toFile(path.join(DIR, name))
    console.log('wrote', name)
  }
})()
