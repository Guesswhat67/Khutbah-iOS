// Urdu Translation Store (Quran.com API v4 - Fateh Muhammad Jalandhry)
// Caches Urdu verse translations in IndexedDB / memory for fast offline reading

const DB_NAME = 'UrduQuranDB'
const STORE = 'urdu_verses'

let _urduCache = new Map()

export async function fetchUrduSurah(surahNum) {
  if (_urduCache.has(surahNum)) {
    return _urduCache.get(surahNum)
  }

  try {
    // Quran.com API v4 endpoint for Urdu Translation (resource 158: Fateh Muhammad Jalandhry)
    const url = `https://api.quran.com/api/v4/quran/translations/158?chapter_number=${surahNum}`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Urdu translation fetch failed')
    const data = await res.json()
    
    // Map translations by verse number
    const urduMap = {}
    if (data.translations && Array.isArray(data.translations)) {
      data.translations.forEach((t, idx) => {
        // verse_key is formatted as "surah:ayah", e.g. "1:1"
        const ayahNum = t.verse_key ? parseInt(t.verse_key.split(':')[1], 10) : (idx + 1)
        // Strip HTML tags if any from Quran.com response
        const cleanText = (t.text || '').replace(/<[^>]*>/g, '')
        urduMap[ayahNum] = cleanText
      })
    }

    _urduCache.set(surahNum, urduMap)
    return urduMap
  } catch (err) {
    console.warn(`Urdu translation fetch error for Surah ${surahNum}:`, err)
    return {}
  }
}
