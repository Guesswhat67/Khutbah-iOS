#!/usr/bin/env node
// One-shot seed: pull the English hadith books the Maktaba currently uses from
// the public jsDelivr mirror of `aliyaqoob7575160/hadith-books@main` into
// `public/hadith-books/`, then write a small `manifest.json` listing the IDs.
//
// The upstream repo does NOT contain every classic collection — it only has a
// subset (bukhari, muslim, tirmidhi at the time of writing). We discover what's
// actually there via the GitHub API each run, download exactly that, and let
// the app react dynamically via `manifest.json`.
//
// Vite copies `public/` → `dist/` on build, and `npx cap sync ios` then writes
// the result into `ios/App/App/public/` — so once this script has run, the
// books ship IN the iPad app. No "Download Library" screen, no GitHub API call
// at runtime, no jsDelivr dependency at runtime.
//
// Idempotent — valid existing files (>1 KB) are skipped.
// Safe to re-run after upstream adds/updates files.
//
// Usage: `node scripts/seed-hadith-books.mjs [lang]`
//   lang defaults to `eng`. Pass `ara` or `urd` to seed Arabic or Urdu.

import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(__dirname)
const OUT = join(ROOT, 'public', 'hadith-books')

const LANG = process.argv[2] || 'eng'
const GH_API = 'https://api.github.com/repos/aliyaqoob7575160/hadith-books/contents/books'
const JSDELIVR = `https://cdn.jsdelivr.net/gh/aliyaqoob7575160/hadith-books@main/books`

function looksLikeJson(text) {
  const t = text.slice(0, 80).trim()
  return t.startsWith('{') || t.startsWith('[')
}

console.log(`[seed-hadith] Probing upstream for ${LANG}-* books...`)
const res = await fetch(GH_API, { headers: { 'Accept': 'application/vnd.github+json' } })
if (!res.ok) {
  console.error(`[seed-hadith] GitHub API error: HTTP ${res.status}`)
  process.exit(1)
}
const files = await res.json()
const matches = files
  .filter(f => f.type === 'file' && f.name.startsWith(`${LANG}-`) && f.name.endsWith('.json'))
  .map(f => f.name)

if (matches.length === 0) {
  console.error(`[seed-hadith] No ${LANG}-* books found upstream.`)
  process.exit(1)
}
console.log(`[seed-hadith] ${matches.length} ${LANG}-* files in upstream: ${matches.join(', ')}`)

mkdirSync(OUT, { recursive: true })
const ids = []
for (const filename of matches) {
  const id = filename.replace(`${LANG}-`, '').replace('.json', '')
  const outFile = join(OUT, filename)

  if (existsSync(outFile) && statSync(outFile).size > 1024) {
    console.log(`[seed-hadith]   ${filename}  skip (exists, ${statSync(outFile).size} bytes)`)
    ids.push(id)
    continue
  }

  const url = `${JSDELIVR}/${filename}`
  try {
    const r = await fetch(url, { redirect: 'follow' })
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`)
    const text = await r.text()
    if (!looksLikeJson(text)) throw new Error(`non-JSON body (first chars: ${text.slice(0, 60).replace(/\n/g, '\\n')})`)
    writeFileSync(outFile, text, 'utf8')
    console.log(`[seed-hadith]   ${filename}  ok (${(text.length / 1024).toFixed(0)} KB)`)
    ids.push(id)
  } catch (err) {
    console.error(`[seed-hadith]   ${filename}  FAILED: ${err.message}`)
    process.exit(1)
  }
}

// The manifest is what maktabaData.js reads at build time. Listing only the IDs
// (and lang) keeps it tiny. Book data is fetched by the app at runtime via the
// file paths derived from the IDs.
const manifest = {
  lang: LANG,
  ids,
  generatedAt: new Date().toISOString().split('T')[0],
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`[seed-hadith] Wrote manifest (${ids.length} ids) → manifest.json`)
console.log(`[seed-hadith] Done.`)
