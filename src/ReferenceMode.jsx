import { useState, useEffect, useRef, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { getCollections, getHadithCorpus, loadBook, ensureSeeded } from './utils/maktabaData'
import { getQuranVerses } from './utils/quranStore'
import { logMaktaba } from './utils/logger'
import { renderAIContent } from './utils/renderAI'
import { apiHeaders } from './utils/net'
import { Icons } from './utils/icons'
import { apiFetch } from './utils/net'
import { showToast, showConfirm } from './utils/toast'
import { expandSynonyms } from './data/synonyms'
import { pushBackHandler } from './utils/backstack'

const IS_NATIVE = Capacitor.isNativePlatform()
const API_BASE = IS_NATIVE ? 'https://khutbah-v2.pages.dev' : ''
const ANALYZE_SIZES = { sm: '0.92rem', md: '1.18rem', lg: '1.5rem' }

const getFontStyle = (arabicSize = 5, translationSize = arabicSize) => ({
  arabic:  `${(0.6  + (arabicSize - 1) * 0.19).toFixed(2)}rem`,
  english: `${(0.55 + (translationSize - 1) * 0.16).toFixed(2)}rem`,
})

function highlightMatch(text, words) {
  if (!text || !words || words.length === 0) return text
  // Simple case-insensitive highlight
  const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi')
  const parts = text.split(regex)
  return parts.map((part, i) =>
    words.some(w => w.toLowerCase() === part.toLowerCase()) ?
    <mark key={i} className="quran-highlight">{part}</mark> : part
  )
}

// Normalize English text for verbatim snippet matching (strip punctuation, diacritics,
// honorifics) so an AI-supplied phrase can be located inside the stored hadith text.
function normalizeSnippet(t) {
  return (t || '')
    .toLowerCase()
    .replace(/ﷺ|﷽/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Authenticity grade pill — the hadith data already carries a grades array.
function GradeBadge({ hadith }) {
  const g = hadith?.grades?.[0]?.grade
  if (!g) return null
  const lower = g.toLowerCase()
  const cls = lower.includes('sahih') || lower.includes('strong') ? 'grade-sahih'
    : lower.includes('hasan') || lower.includes('good') ? 'grade-hasan'
    : (lower.includes('da') && lower.includes('if')) || lower.includes('weak') ? 'grade-daif'
    : 'grade-other'
  return <span className={`hadith-grade ${cls}`}>{g}</span>
}

export default function ReferenceMode({ settings, onNavigateToQuran, onSaveHistory }) {
  const fontStyle = getFontStyle(settings?.fontSizeArabic ?? settings?.fontSize ?? 5, settings?.fontSizeTranslation ?? settings?.fontSize ?? 5)
  const [isWide, setIsWide] = useState(() => window.innerWidth >= 600)
  const [dataReady, setDataReady] = useState(false)
  
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('both') // 'both', 'quran', 'hadith'
  const lang = 'eng'
  
  const [results, setResults] = useState({ quran: [], hadith: [], searching: false })
  const [analyze, setAnalyze] = useState({ open: false, loading: false, result: null, error: null, item: null, type: null })
  const [analyzeTextSize, setAnalyzeTextSize] = useState(() => { try { return localStorage.getItem('analyze-text-size') || 'sm' } catch { return 'sm' } })
  const setAnalyzeTextSizePersist = useCallback((s) => { setAnalyzeTextSize(s); try { localStorage.setItem('analyze-text-size', s) } catch {} }, [])
  const [hadithModal, setHadithModal] = useState(null) // full hadith detail modal

  // ── Read/browse layer (shelf → book reader), separate from search ──
  const MAKTABA_BM_KEY = 'maktaba-bookmarks'
  const [mView, setMView] = useState('shelf')      // 'shelf' | 'book' | 'bookmarks'
  const [shelfBooks, setShelfBooks] = useState([]) // [{ id, name, count }]
  const [currentBook, setCurrentBook] = useState(null) // { id, name, hadiths }
  const [bookLoading, setBookLoading] = useState(false)
  const [bookLimit, setBookLimit] = useState(40)   // reader pagination (long books)
  const [hadithOfDay, setHadithOfDay] = useState(null) // { book:{id,name}, hadith }
  const [maktabaBookmarks, setMaktabaBookmarks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MAKTABA_BM_KEY) || '[]') } catch { return [] }
  })

  // Smart mode: when ON, tapping a concept suggestion uses /api/related (semantic).
  // Default OFF — concept suggestions still show, but tapping one does keyword expansion.
  const [smartMode, setSmartMode] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [isSuggesting, setIsSuggesting] = useState(false)
  // Semantic ("Related to X") concept-search mode — distinct from literal search.
  const [semantic, setSemantic] = useState({ active: false, concept: '', loading: false, error: null })
  
  useEffect(() => {
    const h = () => setIsWide(window.innerWidth >= 600)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  const searchTimerRef = useRef(null)
  const autocompleteTimerRef = useRef(null)
  // Tracks the query the user currently wants results for, so a slow/stale
  // search response can't overwrite results for a newer query.
  const latestQueryRef = useRef('')
  // Map "s:a" → verse, built once, to resolve AI concept references against the local Quran.
  const quranIndexRef = useRef(null)

  // Off-main-thread search worker (keeps typing smooth even over the full corpus).
  const workerRef            = useRef(null)
  const workerUnavailableRef = useRef(false)
  const workerSentQuranRef   = useRef(false)
  const workerSentHadithRef  = useRef(false)
  const pendingSearchRef     = useRef(new Map())
  const searchSeqRef         = useRef(0)

  useEffect(() => () => {
    if (workerRef.current) { try { workerRef.current.terminate() } catch {} workerRef.current = null }
  }, [])

  useEffect(() => {
    let cancelled = false
    ensureSeeded()
      .then(() => { if (!cancelled) setDataReady(true) })
      .catch(err => {
        console.error('maktaba ensureSeeded failed', err)
        if (!cancelled) {
          showToast('Could not load the Hadith library. Reinstall the app if this keeps happening.', 'error', 6000)
          // Proceed anyway — the cold-cache fallback in loadBook() still serves
          // a partial shelf so the user gets something instead of a blank screen.
          setDataReady(true)
        }
      })
    return () => { cancelled = true }
  }, [])

  // Persist Maktaba hadith bookmarks.
  useEffect(() => {
    try { localStorage.setItem(MAKTABA_BM_KEY, JSON.stringify(maktabaBookmarks)) } catch {}
  }, [maktabaBookmarks])

  // Once the library is downloaded, discover which books actually resolved and
  // pick a deterministic "Hadith of the Day" from an available book.
  useEffect(() => {
    if (!dataReady) return
    let cancelled = false
    ;(async () => {
      const COLLECTIONS = getCollections()
      const found = []
      for (const c of COLLECTIONS) {
        const b = await loadBook(c.id, lang)
        if (b && Array.isArray(b.hadiths) && b.hadiths.length) {
          found.push({ id: c.id, name: b.metadata?.name || c.name, count: b.hadiths.length })
        }
      }
      if (cancelled) return
      setShelfBooks(found)
      // Hadith of the Day — stable per calendar day, from the first available book.
      if (found.length) {
        const day = Math.floor(Date.now() / 86400000)
        const pick = found[0]
        const book = await loadBook(pick.id, lang)
        if (!cancelled && book?.hadiths?.length) {
          const h = book.hadiths[day % book.hadiths.length]
          setHadithOfDay({ book: { id: pick.id, name: pick.name }, hadith: { ...h, bookId: pick.id, bookName: pick.name } })
        }
      }
    })()
    return () => { cancelled = true }
  }, [dataReady])

  const bmKey = (bookId, num) => `${bookId}:${num}`
  const isBookmarked = useCallback((bookId, num) =>
    maktabaBookmarks.some(b => b.bookId === bookId && String(b.hadithnumber) === String(num)),
    [maktabaBookmarks])

  const toggleBookmark = useCallback((h) => {
    setMaktabaBookmarks(prev => {
      const exists = prev.some(b => b.bookId === h.bookId && String(b.hadithnumber) === String(h.hadithnumber))
      if (exists) return prev.filter(b => !(b.bookId === h.bookId && String(b.hadithnumber) === String(h.hadithnumber)))
      return [...prev, {
        bookId: h.bookId, bookName: h.bookName, hadithnumber: h.hadithnumber,
        text: (h.text || '').slice(0, 400), grade: h.grades?.[0]?.grade || null,
      }]
    })
  }, [])

  // Hardware back: close modals / clear search / book→shelf before the app goes Home.
  useEffect(() => {
    return pushBackHandler(() => {
      if (analyze.open) { setAnalyze(prev => ({ ...prev, open: false })); return true }
      if (hadithModal) { setHadithModal(null); return true }
      if (query.trim().length >= 3 || semantic.active) {
        setQuery(''); latestQueryRef.current = ''
        setSemantic({ active: false, concept: '', loading: false, error: null })
        setSuggestions([]); setResults({ quran: [], hadith: [], searching: false })
        return true
      }
      if (mView === 'book' || mView === 'bookmarks') { setMView('shelf'); return true }
      return false
    })
  }, [analyze.open, hadithModal, query, semantic.active, mView])

  const openBook = useCallback(async (meta) => {
    setBookLoading(true)
    setBookLimit(40)
    setMView('book')
    const book = await loadBook(meta.id, lang)
    const hadiths = (book?.hadiths || []).map(h => ({ ...h, bookId: meta.id, bookName: meta.name }))
    setCurrentBook({ id: meta.id, name: meta.name, hadiths })
    setBookLoading(false)
  }, [])

  // (Bundled-only: there is no Download or Reload flow anymore. Books ship
  // inside the app and are seeded into IndexedDB once by ensureSeeded() above.
  // The ReferencesMode UI therefore opens straight to the shelf.)

  // Lazily create the search worker; falls back to main-thread scanning if unavailable.
  const ensureWorker = () => {
    if (workerRef.current || workerUnavailableRef.current) return workerRef.current
    try {
      const w = new Worker(new URL('./workers/searchWorker.js', import.meta.url), { type: 'module' })
      w.onmessage = (e) => {
        const msg = e.data || {}
        if (msg.type === 'result') {
          const resolve = pendingSearchRef.current.get(msg.id)
          if (resolve) { pendingSearchRef.current.delete(msg.id); resolve({ quran: msg.quran, hadith: msg.hadith }) }
        }
      }
      w.onerror = () => { workerUnavailableRef.current = true }
      workerRef.current = w
    } catch {
      workerUnavailableRef.current = true
    }
    return workerRef.current
  }

  // Main-thread fallback mirroring the worker's scoring (older WebViews / worker failure).
  const syncScan = (terms, filter, quranData, hadithCorpus) => {
    const score = (lower) => { let s = 0; for (const t of terms) if (lower && lower.includes(t)) s++; return s }
    const quran = []
    if (filter === 'both' || filter === 'quran') {
      for (let i = 0; i < quranData.length; i++) { const s = score(quranData[i]._lowerEn); if (s > 0) quran.push({ i, s }) }
      quran.sort((a, b) => b.s - a.s)
    }
    const hadith = []
    if (filter === 'both' || filter === 'hadith') {
      for (let i = 0; i < hadithCorpus.length; i++) { const s = score(hadithCorpus[i].lower); if (s > 0) hadith.push({ i, s }) }
      hadith.sort((a, b) => b.s - a.s)
    }
    return { quran: quran.slice(0, 30), hadith: hadith.slice(0, 50) }
  }

  const runSearch = (terms, filter, quranData, hadithCorpus) => {
    if (!terms.length) return Promise.resolve({ quran: [], hadith: [] })
    const w = ensureWorker()
    if (!w) return Promise.resolve(syncScan(terms, filter, quranData, hadithCorpus))

    // Ship each corpus (lowercased strings only) to the worker exactly once.
    if (quranData.length && !workerSentQuranRef.current) {
      w.postMessage({ type: 'init', quranLower: quranData.map(v => v._lowerEn || (v.en || '').toLowerCase()) })
      workerSentQuranRef.current = true
    }
    if (hadithCorpus.length && !workerSentHadithRef.current) {
      w.postMessage({ type: 'init', hadithLower: hadithCorpus.map(d => d.lower) })
      workerSentHadithRef.current = true
    }

    const id = ++searchSeqRef.current
    return new Promise(resolve => {
      pendingSearchRef.current.set(id, resolve)
      w.postMessage({ type: 'search', id, terms, filter })
      // Safety net so a stuck worker never leaves the spinner spinning.
      setTimeout(() => {
        if (pendingSearchRef.current.has(id)) {
          pendingSearchRef.current.delete(id)
          resolve(syncScan(terms, filter, quranData, hadithCorpus))
        }
      }, 4000)
    })
  }

  const performSearch = async (searchQuery, currentFilter, currentLang, expandedTerms = null) => {
    if (!searchQuery || searchQuery.trim().length < 3) {
      setResults({ quran: [], hadith: [], searching: false })
      return
    }

    setResults(prev => ({ ...prev, searching: true }))

    // Build token list: use expanded terms if provided, else tokenise query
    const baseTokens = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    const searchTerms = expandedTerms
      ? [...new Set(expandedTerms.filter(t => typeof t === 'string').map(t => t.toLowerCase().trim()).filter(t => t.length > 1))]
      : baseTokens

    logMaktaba('INFO', `Searching for: "${searchQuery}"`, { filter: currentFilter, expanded: !!expandedTerms, terms: searchTerms })

    const start = performance.now()
    let quranMatches = []
    let hadithMatches = []

    try {
      // Load only the corpora we need (cached after first call) so we can map hits → docs.
      const quranData = (currentFilter === 'both' || currentFilter === 'quran') ? await getQuranVerses() : []
      const hadithCorpus = (currentFilter === 'both' || currentFilter === 'hadith') ? await getHadithCorpus(getCollections(), currentLang) : []

      const hits = await runSearch(searchTerms, currentFilter, quranData, hadithCorpus)
      quranMatches = hits.quran.map(({ i, s }) => {
        const v = quranData[i]
        return { ...v, score: s, targetText: currentLang === 'ara' ? v.ar : (v.en || '') }
      })
      hadithMatches = hits.hadith.map(({ i, s }) => ({ ...hadithCorpus[i], score: s }))
    } catch (e) {
      logMaktaba('ERROR', 'Search failed', e)
    }

    const end = performance.now()
    logMaktaba('DEBUG', `Search completed in ${Math.round(end - start)}ms`, {
      quranResults: quranMatches.length,
      hadithResults: hadithMatches.length
    })

    // Race guard: discard if the user has since moved on to a different query
    if (searchQuery !== latestQueryRef.current) {
      logMaktaba('DEBUG', 'Stale search discarded', { searchQuery, latest: latestQueryRef.current })
      return
    }

    setResults({ quran: quranMatches, hadith: hadithMatches, searching: false, tokens: expandedTerms ? searchTerms : baseTokens, searchedFor: expandedTerms || null })
  }

  // Fetch concept suggestions from the AI (haiku, fast). The typed term is shown
  // instantly in onSearchChange; this merges in the AI concepts when they arrive.
  const fetchSuggestions = async (q) => {
    try {
      const res = await apiFetch(API_BASE + '/api/autocomplete', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: q })
      }, { timeoutMs: 12000, retries: 1 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (q !== latestQueryRef.current) return
      const api = Array.isArray(data.suggestions) ? data.suggestions : []
      setSuggestions([
        { term: q, type: 'original', searchTerms: null },
        ...api.filter(s => s.term && s.term.toLowerCase() !== q.toLowerCase())
      ])
    } catch {
      if (q === latestQueryRef.current) setSuggestions([{ term: q, type: 'original', searchTerms: null }])
    } finally {
      setIsSuggesting(false)
    }
  }

  const onSearchChange = (e) => {
    const val = e.target.value
    setQuery(val)
    latestQueryRef.current = val
    if (semantic.active) setSemantic({ active: false, concept: '', loading: false, error: null })
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (autocompleteTimerRef.current) clearTimeout(autocompleteTimerRef.current)

    // In Smart mode, expand a single-word query to its name/spelling variants
    // (Satan → Shaitan, Shaytan, Devil, Iblis…) so the literal search matches them too.
    const expansion = smartMode ? expandSynonyms(val) : null

    if (val.trim().length < 3) {
      setSuggestions([])
      setIsSuggesting(false)
      searchTimerRef.current = setTimeout(() => performSearch(val, filter, lang, expansion), 350)
      return
    }

    // Instant typed-term suggestion so the dropdown is never empty while waiting.
    setSuggestions([{ term: val, type: 'original', searchTerms: null }])
    setIsSuggesting(true)
    // Literal search fires for immediate results regardless of smart mode.
    searchTimerRef.current = setTimeout(() => performSearch(val, filter, lang, expansion), 350)
    autocompleteTimerRef.current = setTimeout(() => fetchSuggestions(val), 400)
  }

  // Tapping a concept suggestion: Smart OFF → keyword expansion; Smart ON → semantic retrieval.
  const applySuggestion = (s) => {
    setQuery(s.term)
    latestQueryRef.current = s.term
    setSuggestions([])
    if (s.type === 'original') {
      setSemantic({ active: false, concept: '', loading: false, error: null })
      performSearch(s.term, filter, lang, smartMode ? expandSynonyms(s.term) : null)
    } else if (smartMode) {
      runConceptSearch(s.term)
    } else {
      setSemantic({ active: false, concept: '', loading: false, error: null })
      performSearch(s.term, filter, lang, s.searchTerms || null)
    }
  }

  const toggleSmartMode = () => {
    const next = !smartMode
    setSmartMode(next)
    if (query.trim().length >= 3) {
      if (next) {
        runConceptSearch(query)
      } else {
        setSemantic({ active: false, concept: '', loading: false, error: null })
        performSearch(query, filter, lang)
      }
    }
  }

  // Build (once) the "s:a" → verse index used to resolve AI concept references.
  const buildQuranIndex = async () => {
    if (quranIndexRef.current) return quranIndexRef.current
    const verses = await getQuranVerses()
    const m = new Map()
    for (const v of verses) m.set(`${v.s}:${v.a}`, v)
    quranIndexRef.current = m
    return m
  }

  // Smart concept search: ask the AI for related references, then resolve them ENTIRELY
  // against local storage — Quran by verified surah:ayah, hadith by verbatim snippet match.
  const runConceptSearch = async (concept, currentFilter = filter) => {
    setSemantic({ active: true, concept, loading: true, error: null })
    setResults({ quran: [], hadith: [], searching: false })
    logMaktaba('INFO', 'Concept search', { concept, filter: currentFilter })
    try {
      const res = await apiFetch(API_BASE + '/api/related', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ concept, scope: currentFilter })
      }, { timeoutMs: 22000, retries: 1 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (concept !== latestQueryRef.current) return

      // Quran: resolve + verify each reference exists in the local corpus.
      let quranOut = []
      if (currentFilter === 'both' || currentFilter === 'quran') {
        const idx = await buildQuranIndex()
        const seen = new Set()
        for (const r of (data.quran || [])) {
          const k = `${r.s}:${r.a}`
          const v = idx.get(k)
          if (v && !seen.has(k)) { seen.add(k); quranOut.push({ ...v, targetText: v.en || '', why: r.why || '' }) }
        }
      }

      // Hadith: only show a result if the AI's snippet is actually found in stored text.
      let hadithOut = []
      if (currentFilter === 'both' || currentFilter === 'hadith') {
        const corpus = await getHadithCorpus(getCollections(), lang)
        const seen = new Set()
        for (const r of (data.hadith || [])) {
          const snip = normalizeSnippet(r.snippet)
          if (snip.length < 15) continue
          const match = corpus.find(h =>
            (!r.collection || h.bookId === r.collection) &&
            normalizeSnippet(h.text).includes(snip)
          )
          if (match) {
            const k = `${match.bookId}:${match.hadithnumber}`
            if (!seen.has(k)) { seen.add(k); hadithOut.push({ ...match, why: r.why || '' }) }
          }
        }
      }

      if (concept !== latestQueryRef.current) return
      logMaktaba('INFO', 'Concept search resolved', { quran: quranOut.length, hadith: hadithOut.length })
      setSemantic({ active: true, concept, loading: false, error: null })
      setResults({ quran: quranOut, hadith: hadithOut, searching: false })
    } catch (e) {
      logMaktaba('ERROR', 'Concept search failed', e)
      if (concept === latestQueryRef.current) {
        setSemantic({ active: true, concept, loading: false, error: 'Could not reach AI. Check your connection.' })
        showToast('Could not load related texts. Check your connection.', 'error', 4000)
      }
    }
  }

  const onFilterChange = (newFilter) => {
    setFilter(newFilter)
    latestQueryRef.current = semantic.active ? semantic.concept : query
    if (semantic.active) runConceptSearch(semantic.concept, newFilter)
    else performSearch(query, newFilter, lang)
  }



  const runAnalysis = async (item, type) => {
    const text = type === 'quran' ? item.targetText : item.text
    if (!text) return

    // Build cache key: for hadith use bookId:hadithnumber, for quran use s:a
    const cacheKey = type === 'hadith' && item.bookName && item.hadithnumber
      ? `${item.bookId || item.bookName.toLowerCase().replace(/\s+/g, '')}:${item.hadithnumber}`
      : type === 'quran' && item.s && item.a
      ? `${item.s}:${item.a}`
      : null

    setAnalyze({ open: true, loading: true, result: null, error: null, item, type })
    logMaktaba('INFO', `Analyze fired for ${type}`, { cacheKey })

    const start = performance.now()
    try {
      const res = await apiFetch(API_BASE + '/api/analyze', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text, type, cacheKey })
      }, { timeoutMs: 30000, retries: 1 })
      const data = await res.json()
      const end = performance.now()

      if (!res.ok) throw new Error(data.error || 'Analysis failed')

      logMaktaba('INFO', `Analyze response received`, { timeMs: Math.round(end - start), cached: data.cached })
      setAnalyze(prev => ({ ...prev, loading: false, result: data.analysis, cached: !!data.cached }))
    } catch (err) {
      logMaktaba('ERROR', `Analyze request failed`, err)
      setAnalyze(prev => ({ ...prev, loading: false, error: err.message }))
    }
  }

  const shareText = async (text) => {
    try {
      await Share.share({ title: 'Maktaba Analysis', text, dialogTitle: 'Share via' })
    } catch {}
  }

  if (!dataReady) {
    return (
      <div className="maktaba-container">
        <div className="maktaba-setup">
          <div className="setup-icon">📚</div>
          <h2>Loading your library...</h2>
          <p className="idle-hint">First visit writes the hadith books to local storage. This only happens once.</p>
        </div>
      </div>
    )
  }

  const searchPanel = (
    <div className="maktaba-search-panel">
      <div className="maktaba-search-row">
        <div className="autocomplete-wrapper">
          <input
            type="text"
            className="maktaba-search-bar"
            placeholder="🔍 Search Quran & Hadith..."
            value={query}
            onChange={onSearchChange}
            dir={lang === 'ara' || lang === 'urd' ? 'rtl' : 'ltr'}
            style={{ marginBottom: 0, width: '100%' }}
          />
          {suggestions.length > 0 && query.length >= 3 && (
            <div className="autocomplete-dropdown">
              {suggestions.map((s, i) => (
                <button key={i} className="autocomplete-item" onClick={() => applySuggestion(s)}>
                  <span className="autocomplete-icon">{s.type === 'original' ? '🔍' : '💡'}</span>
                  <span className="autocomplete-term">{s.term}</span>
                  <span className="autocomplete-hint">
                    {s.type === 'original' ? 'search text' : smartMode ? 'find related →' : 'expand search →'}
                  </span>
                </button>
              ))}
              {isSuggesting && <div className="autocomplete-loading">💭 finding concepts…</div>}
            </div>
          )}
        </div>
        <button
          onClick={toggleSmartMode}
          className={`maktaba-smart-btn${smartMode ? ' maktaba-smart-active' : ''}`}
          title={smartMode ? "Smart ON — matches name/spelling variants + AI concept retrieval" : "Smart OFF — concepts expand keywords"}
        >✨ Smart</button>
      </div>
      <div className="maktaba-filters">
        <div className="filter-group">
          <button className={`filter-pill ${filter === 'both' ? 'active' : ''}`} onClick={() => onFilterChange('both')}>Both</button>
          <button className={`filter-pill ${filter === 'quran' ? 'active' : ''}`} onClick={() => onFilterChange('quran')}>Quran</button>
          <button className={`filter-pill ${filter === 'hadith' ? 'active' : ''}`} onClick={() => onFilterChange('hadith')}>Hadith</button>
        </div>
        {} { /* Books ship bundled; the Reload control is gone with the download flow. */ } 
      </div>
      {isWide && (
        <div className="maktaba-wide-hint">
          <p>Tap any hadith to read in full and analyze</p>
          {results.searchedFor && (
            <p className="maktaba-searched-for" style={{ marginTop: 8 }}>
              Searched: {results.searchedFor.slice(0, 6).join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  )

  // Single source for the results list, reused by both the wide and narrow layouts.
  const renderResults = () => (
    <>
      {semantic.active && (
        <div className="maktaba-related-banner">
          <span className="maktaba-related-title">✨ Related to "{semantic.concept}"</span>
          <span className="maktaba-related-note">AI-suggested · verified against your offline books</span>
        </div>
      )}
      {semantic.active && semantic.loading && <div className="maktaba-loading">Finding related verses &amp; hadith…</div>}
      {semantic.active && semantic.error && <div className="maktaba-empty">⚠ {semantic.error}</div>}
      {semantic.active && !semantic.loading && !semantic.error && results.quran.length === 0 && results.hadith.length === 0 && (
        <div className="maktaba-empty">No related texts found for "{semantic.concept}".</div>
      )}

      {!semantic.active && results.searching && <div className="maktaba-loading">Searching…</div>}
      {!semantic.active && results.searchedFor && (
        <div className="maktaba-searched-for">
          Searched for: {results.searchedFor.slice(0, 8).join(' · ')}{results.searchedFor.length > 8 ? ' · …' : ''}
        </div>
      )}
      {!semantic.active && !results.searching && query.length >= 3 && results.quran.length === 0 && results.hadith.length === 0 && (
        <div className="maktaba-empty">No results found for "{query}"</div>
      )}

      {(filter === 'both' || filter === 'quran') && results.quran.length > 0 && (
        <div className="results-section">
          <h3 className="section-title">📖 Quran ({results.quran.length})</h3>
          {results.quran.map((v, i) => (
            <div key={`quran-${i}`} className="result-card">
              <div className="result-header">
                <span className="result-source">{v.sName} • {v.s}:{v.a}</span>
              </div>
              <div className="result-body" dir={lang === 'ara' ? 'rtl' : 'ltr'} style={{ fontSize: lang === 'ara' ? fontStyle.arabic : fontStyle.english }}>
                {highlightMatch(v.targetText, results.tokens)}
              </div>
              {lang !== 'ara' && v.ar && <div className="result-subtext" dir="rtl" style={{ marginTop: '4px', color: '#888' }}>{v.ar}</div>}
              {v.why && <div className="result-why">💡 {v.why}</div>}
              <div className="result-actions">
                <button className="btn-analyze-sm" onClick={() => runAnalysis(v, 'quran')}>✨ Analyze</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(filter === 'both' || filter === 'hadith') && results.hadith.length > 0 && (
        <div className="results-section">
          <h3 className="section-title">📚 Hadith ({results.hadith.length})</h3>
          {results.hadith.map((h, i) => (
            <div key={`hadith-${i}`} className="result-card result-card-hadith" onClick={() => setHadithModal(h)}>
              <div className="result-header">
                <span className="result-source">{h.bookName} • {h.hadithnumber}</span>
                <span className="result-header-right">
                  <GradeBadge hadith={h} />
                  <span className="result-read-more">Read more ›</span>
                </span>
              </div>
              <div className="result-body result-body-clamped" dir="ltr" style={{ fontSize: fontStyle.english }}>
                {highlightMatch(h.text, results.tokens)}
              </div>
              {h.why && <div className="result-why">💡 {h.why}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  )

  // A single hadith row, reused by the book reader and the bookmarks list.
  const HadithRow = (h, key) => {
    const bmed = isBookmarked(h.bookId, h.hadithnumber)
    return (
      <div key={key} className="hadith-read-card" onClick={() => setHadithModal(h)}>
        <div className="hadith-read-head">
          <span className="hadith-read-num">{h.bookName} • #{h.hadithnumber}</span>
          <span className="result-header-right">
            <GradeBadge hadith={h} />
            <button
              className={`hadith-bm-btn${bmed ? ' hadith-bm-active' : ''}`}
              onClick={e => { e.stopPropagation(); toggleBookmark(h) }}
              title={bmed ? 'Bookmarked' : 'Bookmark'}
            ><Icons.Bookmark /></button>
            <button
              className="hadith-analyze-btn"
              onClick={e => { e.stopPropagation(); runAnalysis(h, 'hadith') }}
              title="Analyze this hadith"
            ><Icons.Analyze /></button>
          </span>
        </div>
        <div className="hadith-read-text" dir="ltr" style={{ fontSize: fontStyle.english }}>{h.text}</div>
      </div>
    )
  }

  // Shelf: Hadith of the Day + your downloaded books + bookmarks entry.
  const renderShelf = () => (
    <div className="maktaba-shelf">
      {hadithOfDay && (
        <div className="hod-card" onClick={() => setHadithModal(hadithOfDay.hadith)}>
          <div className="hod-head">
            <span className="hod-badge">📅 Hadith of the Day</span>
            <GradeBadge hadith={hadithOfDay.hadith} />
          </div>
          <p className="hod-text">
            {(hadithOfDay.hadith.text || '').slice(0, 260)}{(hadithOfDay.hadith.text || '').length > 260 ? '…' : ''}
          </p>
          <div className="hod-foot">
            <span className="hod-src">{hadithOfDay.book.name} • #{hadithOfDay.hadith.hadithnumber}</span>
            <span className="result-read-more">Read ›</span>
          </div>
        </div>
      )}
      <div className="shelf-row-head">
        <h3 className="section-title">📚 Your Books</h3>
        <button className="shelf-bm-link" onClick={() => setMView('bookmarks')}>
          <Icons.Bookmark /> Bookmarks ({maktabaBookmarks.length})
        </button>
      </div>
      {shelfBooks.length === 0 ? (
        <div className="maktaba-empty">Loading your books…</div>
      ) : (
        <div className="shelf-grid">
          {shelfBooks.map(b => (
            <button key={b.id} className="book-card" onClick={() => openBook(b)}>
              <span className="book-name">{b.name}</span>
              <span className="book-count">{b.count.toLocaleString()} hadith</span>
            </button>
          ))}
        </div>
      )}
      <p className="shelf-hint">Tap a book to read hadith-by-hadith · one a day builds the habit</p>
    </div>
  )

  // Book reader: sequential hadiths, paginated for the large collections.
  const renderBook = () => (
    <div className="maktaba-book">
      <div className="book-reader-head">
        <button className="quran-analyze-back" onClick={() => { setMView('shelf'); setCurrentBook(null) }}>← Books</button>
        <span className="book-reader-title">{currentBook?.name}</span>
        <span style={{ width: 60 }} />
      </div>
      {bookLoading || !currentBook ? (
        <div className="maktaba-loading">Opening book…</div>
      ) : (
        <div className="hadith-reader-list">
          {currentBook.hadiths.slice(0, bookLimit).map((h, i) => HadithRow(h, `${h.bookId}:${h.hadithnumber}:${i}`))}
          {currentBook.hadiths.length > bookLimit && (
            <button className="book-more-btn" onClick={() => setBookLimit(n => n + 40)}>
              Show more ({(currentBook.hadiths.length - bookLimit).toLocaleString()} left)
            </button>
          )}
        </div>
      )}
    </div>
  )

  // Saved bookmarks list.
  const renderBookmarks = () => (
    <div className="maktaba-book">
      <div className="book-reader-head">
        <button className="quran-analyze-back" onClick={() => setMView('shelf')}>← Books</button>
        <span className="book-reader-title">Bookmarks</span>
        <span style={{ width: 60 }} />
      </div>
      {maktabaBookmarks.length === 0 ? (
        <div className="maktaba-empty">No bookmarks yet — tap the ribbon on any hadith while reading.</div>
      ) : (
        <div className="hadith-reader-list">
          {maktabaBookmarks.map((b, i) => HadithRow({
            ...b, grades: b.grade ? [{ grade: b.grade }] : [],
          }, `bm-${b.bookId}:${b.hadithnumber}:${i}`))}
        </div>
      )}
    </div>
  )

  // Search overlays everything when the user is typing; otherwise show the read layer.
  const searchActive = query.trim().length >= 3 || semantic.active
  const renderMain = () => {
    if (searchActive) return renderResults()
    if (mView === 'book') return renderBook()
    if (mView === 'bookmarks') return renderBookmarks()
    return renderShelf()
  }

  return (
    <div className={`maktaba-container${isWide ? ' maktaba-wide' : ''}`}>
      {isWide ? (
        <>
          {searchPanel}
          <div className="maktaba-results-panel">
      <div className="maktaba-results">
        {renderMain()}
      </div>
      </div> {/* maktaba-results-panel (wide only) */}
        </>
      ) : (
        <>
          <div className="maktaba-header">{searchPanel}</div>
          <div className="maktaba-results">
            {renderMain()}
          </div>
        </>
      )}

      {hadithModal && (
        <div className="modal-overlay" onClick={() => setHadithModal(null)}>
          <div className="modal hadith-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="hadith-detail-header">
              <button className="quran-analyze-back" onClick={() => setHadithModal(null)}>← Back</button>
              <div className="hadith-detail-source">
                <span className="hadith-detail-book">{hadithModal.bookName}</span>
                <span className="hadith-detail-num">#{hadithModal.hadithnumber}</span>
                <GradeBadge hadith={hadithModal} />
                <button
                  className={`hadith-bm-btn${isBookmarked(hadithModal.bookId, hadithModal.hadithnumber) ? ' hadith-bm-active' : ''}`}
                  onClick={() => toggleBookmark(hadithModal)}
                  title={isBookmarked(hadithModal.bookId, hadithModal.hadithnumber) ? 'Bookmarked' : 'Bookmark'}
                ><Icons.Bookmark /></button>
              </div>
            </div>
            <div className="hadith-detail-body">
              <p dir={lang === 'ara' || lang === 'urd' ? 'rtl' : 'ltr'} style={{ fontSize: fontStyle.english }}>
                {hadithModal.text}
              </p>
            </div>
            <div className="hadith-detail-footer">
              <button className="btn-analyze-full" onClick={() => { setHadithModal(null); runAnalysis(hadithModal, 'hadith') }}>
                ✨ Analyze this Hadith
              </button>
            </div>
          </div>
        </div>
      )}

      {analyze.open && (
        <div className="modal-overlay" onClick={() => setAnalyze(prev => ({ ...prev, open: false }))}>
          <div className="modal analyze-modal" onClick={e => e.stopPropagation()} style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="quran-analyze-header">
              <button className="quran-analyze-back" onClick={() => setAnalyze(prev => ({ ...prev, open: false }))}>← Back</button>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span className="quran-analyze-title">AI Analysis</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {analyze.cached ? '⚡ Instant — retrieved from cache' : 'AI-generated — may err. Verify with a scholar.'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {analyze.result && onSaveHistory && (
                  <button className="quran-analyze-share" onClick={() => onSaveHistory({ duration: 0, sentenceCount: 1, analysis: analyze.result })} title="Save to History">
                    <Icons.Save />
                  </button>
                )}
                {analyze.result && (
                  <button className="quran-analyze-share" onClick={() => shareText(analyze.result)} title="Share">
                    <Icons.Share />
                  </button>
                )}
              </div>
            </div>
            <div className="analyze-size-bar">
              {[['sm','A'],['md','AA'],['lg','AAA']].map(([s, label]) => (
                <button key={s} className={`analyze-size-btn${analyzeTextSize === s ? ' analyze-size-active' : ''}`} onClick={() => setAnalyzeTextSizePersist(s)}>{label}</button>
              ))}
            </div>
            <div className="quran-analyze-body" style={{ overflowY: 'auto', padding: '16px' }}>
              {analyze.loading && (
                <p className="quran-analyze-loading">Analyzing {analyze.type === 'quran' ? 'verse' : 'hadith'}…</p>
              )}
              {analyze.error && <p className="quran-analyze-error">⚠ {analyze.error}</p>}
              {analyze.result && (
                <>
                  <div style={{ padding: '16px', background: 'var(--surface)', borderRadius: '12px', marginBottom: '16px' }}>
                    <p className="context-text" dir={lang === 'ara' || lang === 'urd' ? 'rtl' : 'ltr'} style={{ fontSize: lang === 'ara' || lang === 'urd' ? fontStyle.arabic : fontStyle.english, margin: 0 }}>
                      {analyze.type === 'quran' ? analyze.item.targetText : analyze.item.text}
                    </p>
                  </div>
                  <div className="quran-analyze-result" style={{ fontSize: ANALYZE_SIZES[analyzeTextSize] }}>{renderAIContent(analyze.result, onNavigateToQuran)}</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
