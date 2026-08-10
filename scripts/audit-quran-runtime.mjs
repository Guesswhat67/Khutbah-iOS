import fs from 'fs'
import path from 'path'

console.log('=== AUDITING QURAN DATASET & STORE ===')

try {
  const quranPath = path.resolve(process.cwd(), 'public/quran.json')
  console.log('Checking public/quran.json path:', quranPath)
  if (!fs.existsSync(quranPath)) {
    console.error('CRITICAL ERROR: public/quran.json does NOT exist!')
    process.exit(1)
  }
  const raw = fs.readFileSync(quranPath, 'utf8')
  const json = JSON.parse(raw)
  console.log(`Loaded ${json.length} verses from public/quran.json`)
  
  if (!Array.isArray(json) || json.length === 0) {
    console.error('CRITICAL ERROR: quran.json is empty or not an array!')
    process.exit(1)
  }

  let missingAr = 0
  let missingS = 0
  let missingA = 0
  for (let i = 0; i < json.length; i++) {
    const v = json[i]
    if (!v.ar) missingAr++
    if (v.s === undefined) missingS++
    if (v.a === undefined) missingA++
  }

  console.log(`Audit metrics: missingAr=${missingAr}, missingS=${missingS}, missingA=${missingA}`)
  if (missingAr > 0 || missingS > 0 || missingA > 0) {
    console.error('CRITICAL ERROR: Corrupted fields in quran.json!')
  } else {
    console.log('✓ quran.json dataset structure is 100% valid!')
  }
} catch (e) {
  console.error('CRITICAL ERROR auditing quran.json:', e)
}
