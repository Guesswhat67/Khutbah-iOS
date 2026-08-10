// Shared Quran corpus store.
// Keeps the full verse list in IndexedDB (not localStorage — it's multiple MB and
// localStorage is tiny on Android WebViews) plus ONE in-memory copy for the session.
// Both QuranMode (tracking/browse) and ReferenceMode (search) read from here.

const DB_NAME = 'QuranDB'
const STORE = 'corpus'
const KEY = 'verses-v4'   // bumped for the letter-only norm() — forces .n to re-derive

let _db = null
let _verses = null        // in-memory processed array (single shared copy)
let _loadPromise = null   // de-dupes concurrent loads

// Must stay byte-identical to the normalization used for recitation matching
// (QuranMode.jsx has an identical copy). The trailing letter-only filter is critical:
// cloud STT (ElevenLabs) returns Arabic with punctuation (".") and invisible marks
// (ZWNJ/RLM/NBSP) that otherwise glue onto words, so "العالمين." never matches the
// index key "العالمين" and even clean words silently fail to match.
export function norm(text) {
  // IMPORTANT: every Arabic range below is emitted as \uXXXX escapes, NEVER literal Arabic.
  // A literal RTL range pasted into source gets byte-scrambled by editors into a range that
  // spans the letter block U+0621-U+064A, which silently makes norm() strip the letters
  // themselves and return '' for ALL input. That corruption shipped in v8.18.0 and broke the
  // cloud tracker (transcript -> '' -> 0 tokens -> never locks). Keep this escaped forever.
  return (text || '')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')        // harakat / tashkeel / Quranic marks
    .replace(/\u0640/g, '')        // tatweel (kashida)
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627') // alef forms -> bare alef
    .replace(/\u0649/g, '\u064A') // alef maqsura -> ya
    .replace(/\u0629/g, '\u0647') // ta marbuta -> ha
    .replace(/[^\u0621-\u064A\s]/g, ' ')          // keep Arabic letters + spaces only
    .replace(/\s+/g, ' ')
    .trim()
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db)
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
    req.onerror = (e) => reject(e.target.error)
  })
}

function idbGet(key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(key)
    r.onsuccess = () => resolve(r.result)
    r.onerror = (e) => reject(e.target.error)
  }))
}

function idbPut(key, val) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(val, key)
    tx.oncomplete = () => resolve()
    tx.onerror = (e) => reject(e.target.error)
  }))
}

// Ensure each verse carries the derived fields both tabs rely on.
// `n` is ALWAYS recomputed (not `v.n ??`) so a norm() change can never be shadowed by
// a stale precomputed `.n` baked into quran.json or an older cache.
function ensureDerived(arr) {
  return arr.map(v => {
    // If the verse lacks Arabic text (`ar`), we cannot normalize it.
    // Log a warning so developers can notice malformed data.
    if (!v.ar) {
      console.warn('quranStore: verse missing Arabic text', v)
    }
    const normText = v.ar ? norm(v.ar) : ''
    return {
      ...v,
      n: normText,
      _lowerEn: v._lowerEn ?? (v.en || '').toLowerCase(),
    }
  })
}

export async function getQuranVerses() {
  if (_verses) return _verses
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    // 1. IndexedDB. Re-run ensureDerived even on a cache hit: cached rows keep `.ar`, so
    // recomputing `.n = norm(v.ar)` here means a norm() change ALWAYS takes effect on the
    // next load, self-healing a stale cache whose `.n` was derived by an older norm (e.g.
    // one that left harakat on, so index keys like "اللَّه" never matched clean STT "الله").
    try {
      const cached = await idbGet(KEY)
      if (cached && cached.length && cached[0] && cached[0].ar) {
        _verses = ensureDerived(cached)
        idbPut(KEY, _verses).catch(() => {})
        return _verses
      } else if (cached) {
        console.warn('quranStore: cached verses are unhealthy or missing ar field. Ignoring cache.')
      }
    } catch {}

    // 2. Migrate legacy localStorage copy, then free that space
    try {
      const legacy = localStorage.getItem('quran-data-v3')
      if (legacy) {
        const parsed = JSON.parse(legacy)
        if (parsed && parsed.length && parsed[0] && parsed[0].ar) {
          const derived = ensureDerived(parsed)
          _verses = derived
          idbPut(KEY, derived).catch(() => {})
          try { localStorage.removeItem('quran-data-v3') } catch {}
          return _verses
        }
      }
    } catch {}

    // 3. Fetch fresh from the bundled JSON
    const res = await fetch('/quran.json')
    if (!res.ok) throw new Error('quran load error')
    const rawText = await res.text()
    const cleanText = rawText.replace(/^\uFEFF/, '')
    const processed = ensureDerived(JSON.parse(cleanText))
    _verses = processed
    idbPut(KEY, processed).catch(() => {})
    return _verses
  })()

  try {
    return await _loadPromise
  } finally {
    _loadPromise = null
  }
}
