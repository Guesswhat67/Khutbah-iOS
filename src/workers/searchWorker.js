// Off-main-thread Maktaba search. The Quran (~6.2k verses) and the full Hadith
// corpus (tens of thousands of entries) are scanned here so typing in the search
// box never janks the UI. The main thread sends pre-lowercased strings once, then
// only sends query terms; we return matching indices + scores for it to render.

let quran = []   // array of lowercased English verse strings
let hadith = []  // array of lowercased English hadith strings

function scoreAgainst(lower, terms) {
  let score = 0
  for (const term of terms) {
    if (lower.includes(term)) score++
  }
  return score
}

function scan(corpus, terms, limit) {
  const hits = []
  for (let i = 0; i < corpus.length; i++) {
    const s = scoreAgainst(corpus[i], terms)
    if (s > 0) hits.push({ i, s })
  }
  hits.sort((a, b) => b.s - a.s)
  return hits.slice(0, limit)
}

self.onmessage = (e) => {
  const msg = e.data || {}

  if (msg.type === 'init') {
    if (Array.isArray(msg.quranLower)) quran = msg.quranLower
    if (Array.isArray(msg.hadithLower)) hadith = msg.hadithLower
    self.postMessage({ type: 'ready', quranCount: quran.length, hadithCount: hadith.length })
    return
  }

  if (msg.type === 'search') {
    const { id, terms, filter, quranLimit = 30, hadithLimit = 50 } = msg
    const quranHits = (filter === 'both' || filter === 'quran') ? scan(quran, terms, quranLimit) : []
    const hadithHits = (filter === 'both' || filter === 'hadith') ? scan(hadith, terms, hadithLimit) : []
    self.postMessage({ type: 'result', id, quran: quranHits, hadith: hadithHits })
  }
}
