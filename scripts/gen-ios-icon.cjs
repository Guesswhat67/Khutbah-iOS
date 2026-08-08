// Generates the iOS App Store icon (1024x1024, opaque, full-bleed square —
// iOS rounds the corners itself) from the same mihrab-lamp motif used by the
// Android launcher icons (ported from the Android repo's scripts/gen-icons.cjs).
// Run: node scripts/gen-ios-icon.cjs   (needs `sharp` devDependency)
const sharp = require('sharp')
const path = require('path')

const OUT = path.join(__dirname, '..', 'ios', 'App', 'App',
  'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png')

// Shared mihrab-lamp motif (gold) centered in a 108x108 canvas.
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
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#15633b"/><stop offset="1" stop-color="#04190f"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffe9a8" stop-opacity="0.95"/>
      <stop offset="0.6" stop-color="#f1c75f" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#f1c75f" stop-opacity="0"/>
    </radialGradient>
  </defs>
`

// Full-bleed square (rx=0 — iOS masks its own corners), opaque background.
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 108 108">${defs}` +
  `<rect x="0" y="0" width="108" height="108" fill="url(#bg)"/>${motif}</svg>`

;(async () => {
  await sharp(Buffer.from(svg)).flatten({ background: '#04190f' }).png().toFile(OUT)
  console.log('wrote', OUT)
})()
