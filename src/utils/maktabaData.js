// Maktaba (Hadith library) — offline-first, bundled.
//
// Books ship INSIDE the app at /hadith-books/eng-<id>.json (Vite copies from
// public/hadith-books/ on build, `npx cap sync ios` puts it into the native
// bundle). On first Maktaba visit, ensureSeeded() loads each bundled book
// into IndexedDB and from then on `loadBook` is an IDB read.
//
// Availability is driven by public/hadith-books/manifest.json (one tiny JSON
// file) so adding new books upstream is a one-line change there — re-run
// `scripts/seed-hadith-books.mjs`, that's it. The manifest is fetched at
// runtime by ensureSeeded() (not statically imported — files in Vite's
// `public/` are served as static assets and CAN'T be `import`ed as modules).
//
// Compatibility:
//  - `src/workers/searchWorker.js` still receives the flat lowercased
//    hadith array over postMessage — assembled by `getHadithCorpus()`.
//    Contract unchanged.
//  - UI displays only books whose IDs are listed in the manifest.
//  - Old installs that had fetched books via the previous CDN flow still
//    load fine: extra keys in IDB are simply ignored by `loadBook`.
//
// Why seed into IDB at all when the data ships in the bundle already?
//  - Subsequent `loadBook` calls become a synchronous-feeling IDB read
//    instead of re-fetching + re-parsing multi-MB JSON on every visit.
//  - Memory cache (`memoryCache`) layered on top makes per-render reads O(1).

const DB_NAME = 'MaktabaDB'
const STORE_NAME = 'hadith_books'
const MANIFEST_URL = '/hadith-books/manifest.json'

let dbInstance = null
let _manifest = null  // { lang: 'eng', ids: ['bukhari', ...], generatedAt }

// Display names per id. Add entries here as you bundle more books; ids not
// present here fall back to a title-cased version of the id.
const COLLECTION_NAMES = {
  bukhari: 'Sahih al-Bukhari',
  muslim:  'Sahih Muslim',
  tirmidhi: 'Jami\u2018 at-Tirmidhi',
}
const displayName = (id) => COLLECTION_NAMES[id] || id.charAt(0).toUpperCase() + id.slice(1)

// IndexedDB plumbing (unchanged shape from the original) ---------------------
const initDB = () => {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance)
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = (e) => {
      dbInstance = e.target.result
      resolve(dbInstance)
    }
    request.onerror = (e) => reject(e.target.error)
  })
}

const putItem = async (key, val) => {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(val, key)
    tx.oncomplete = () => resolve()
    tx.onerror = (e) => reject(e.target.error)
  })
}

const getItem = async (key) => {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = (e) => reject(e.target.error)
  })
}

// Dev helper: nuke the IDB so the next ensureSeeded() does a fresh copy.
export const clearHadithData = async () => {
  const db = await initDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = (e) => reject(e.target.error)
  })
  Object.keys(memoryCache).forEach(k => delete memoryCache[k])
  Object.keys(_corpusCache).forEach(k => delete _corpusCache[k])
  try { localStorage.removeItem('maktaba_has_data') } catch {}
}

// Fetch & cache the bundled manifest (one HTTP GET, ~150 bytes).
// Failing here is fatal because there is no fallback source — the entire
// bundled-books scheme depends on this file existing.
async function loadManifest() {
  if (_manifest) return _manifest
  const r = await fetch(MANIFEST_URL)
  if (!r.ok) throw new Error(`manifest fetch ${MANIFEST_URL} HTTP ${r.status}`)
  const m = await r.json()
  if (!m || !Array.isArray(m.ids)) throw new Error('manifest missing ids[]')
  _manifest = { lang: m.lang || 'eng', ids: m.ids, generatedAt: m.generatedAt || '' }
  return _manifest
}

// First-time seed: for any book not already in IDB, fetch its bundled JSON
// from /hadith-books/ and write it. Skips existing entries so re-runs are
// near-instant. Progress callback (`done`, `total`) is optional.
export async function ensureSeeded({ onProgress } = {}) {
  const m = await loadManifest()
  const lang = m.lang
  const ids  = m.ids
  if (!ids.length) return
  let done = 0
  for (const id of ids) {
    const key = `${lang}_${id}`
    try {
      const cached = await getItem(key)
      if (cached && Array.isArray(cached.hadiths) && cached.hadiths.length) {
        done++
        if (onProgress) onProgress(done, ids.length)
        continue
      }
    } catch {
      // IDB unavailable right now — we'll still write below via putItem.
    }
    const res = await fetch(`/hadith-books/${lang}-${id}.json`)
    if (!res.ok) throw new Error(`bundled ${lang}-${id}.json HTTP ${res.status}`)
    const parsed = await res.json()
    if (!parsed || !Array.isArray(parsed.hadiths)) {
      throw new Error(`bundled ${lang}-${id}.json missing hadiths[]`)
    }
    await putItem(key, parsed)
    done++
    if (onProgress) onProgress(done, ids.length)
  }
  try { localStorage.setItem('maktaba_has_data', 'true') } catch {}
}

// Reactive getters for components — only safe to call AFTER ensureSeeded()
// has resolved. Before that they return safe defaults.
export function getLang() { return _manifest?.lang || 'eng' }
export function getCollections() {
  return _manifest ? _manifest.ids.map(id => ({ id, name: displayName(id) })) : []
}

// In-memory cache for fast repeated loads during a single session.
const memoryCache = {}

// Flat pre-lowercased search corpus — built ONCE per lang (search worker
// consumes it via postMessage). Unchanged contract from the previous file.
const _corpusCache = {}

export const getHadithCorpus = async (bookList, lang) => {
  if (_corpusCache[lang]) return _corpusCache[lang]
  const docs = []
  for (const book of bookList) {
    const bookData = await loadBook(book.id, lang)
    if (bookData && bookData.hadiths) {
      const bookName = bookData.metadata?.name || book.name
      for (const h of bookData.hadiths) {
        const text = h.text || ''
        docs.push({ ...h, text, lower: text.toLowerCase(), bookId: book.id, bookName })
      }
    }
  }
  _corpusCache[lang] = docs
  return docs
}

export const loadBook = async (book, lang) => {
  const cacheKey = `${lang}_${book}`
  if (memoryCache[cacheKey]) return memoryCache[cacheKey]

  // Primary path: IDB read after ensureSeeded.
  try {
    const cached = await getItem(cacheKey)
    if (cached) { memoryCache[cacheKey] = cached; return cached }
  } catch (e) {
    console.warn('loadBook IDB read failed', cacheKey, e?.message)
  }

  // Cold-cache fallback: read straight from the bundled JSON. Covers the
  // window between cold start and ensureSeeded finishing, and the case
  // where WebKit evicted IDB under storage pressure.
  try {
    const res = await fetch(`/hadith-books/${lang}-${book}.json`)
    if (!res.ok) return null
    const parsed = await res.json()
    await putItem(cacheKey, parsed).catch(() => {})
    memoryCache[cacheKey] = parsed
    return parsed
  } catch (err) {
    console.error(`Error loading bundled ${lang}-${book}`, err)
    return null
  }
}
