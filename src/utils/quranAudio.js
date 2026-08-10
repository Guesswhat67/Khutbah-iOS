// Quran.com Audio Player Utility
// Supports gapless audio recitation from Quran.com / EveryAyah streams
// Reciters: Mishary Alafasy, AbdulBaset, Al-Husary, Shatri

export const RECITERS = [
  { id: 'Alafasy_128kbps', name: 'Mishary Rashid Alafasy', sub: 'Quran.com default' },
  { id: 'Husary_128kbps', name: 'Mahmoud Khalil Al-Husary', sub: 'Teacher / Muallim' },
  { id: 'AbdulSamad_64kbps_QuranExplorer.com', name: 'AbdulBaset AbdulSamad', sub: 'Classic Mujawwad' },
  { id: 'Abu_Bakr_Ash-Shaatree_128kbps', name: 'Abu Bakr Al-Shatri', sub: 'Smooth Hadr' },
]

export function getAyahAudioUrl(surah, ayah, reciterId = 'Alafasy_128kbps') {
  const s = String(surah).padStart(3, '0')
  const a = String(ayah).padStart(3, '0')
  return `https://everyayah.com/data/${reciterId}/${s}${a}.mp3`
}

class QuranAudioPlayer {
  constructor() {
    this.audio = new Audio()
    this.currentSurah = null
    this.currentAyah = null
    this.totalAyatInSurah = 0
    this.reciterId = 'Alafasy_128kbps'
    this.isPlaying = false
    this.onStateChange = null
    this.onAyahChange = null

    this.audio.addEventListener('ended', () => this.handleEnded())
    this.audio.addEventListener('error', (e) => this.handleError(e))
  }

  setReciter(reciterId) {
    this.reciterId = reciterId
  }

  playAyah(surah, ayah, totalAyat = 0, onAyahChange = null, onStateChange = null) {
    this.currentSurah = surah
    this.currentAyah = ayah
    if (totalAyat > 0) this.totalAyatInSurah = totalAyat
    if (onAyahChange) this.onAyahChange = onAyahChange
    if (onStateChange) this.onStateChange = onStateChange

    const url = getAyahAudioUrl(surah, ayah, this.reciterId)
    this.audio.src = url
    this.audio.play().then(() => {
      this.isPlaying = true
      this.notifyState()
      if (this.onAyahChange) this.onAyahChange(surah, ayah)
    }).catch(err => {
      console.error('Audio play error:', err)
      this.isPlaying = false
      this.notifyState()
    })
  }

  pause() {
    this.audio.pause()
    this.isPlaying = false
    this.notifyState()
  }

  resume() {
    if (this.audio.src) {
      this.audio.play().then(() => {
        this.isPlaying = true
        this.notifyState()
      }).catch(() => {})
    }
  }

  stop() {
    this.audio.pause()
    this.audio.currentTime = 0
    this.isPlaying = false
    this.notifyState()
  }

  handleEnded() {
    // Gapless playback to next verse in the surah
    if (this.currentSurah && this.currentAyah < this.totalAyatInSurah) {
      this.playAyah(this.currentSurah, this.currentAyah + 1, this.totalAyatInSurah, this.onAyahChange, this.onStateChange)
    } else {
      this.isPlaying = false
      this.notifyState()
    }
  }

  handleError(e) {
    console.warn('Audio playback error', e)
    this.isPlaying = false
    this.notifyState()
  }

  notifyState() {
    if (this.onStateChange) {
      this.onStateChange({
        isPlaying: this.isPlaying,
        surah: this.currentSurah,
        ayah: this.currentAyah,
        reciterId: this.reciterId,
      })
    }
  }
}

export const quranAudio = new QuranAudioPlayer()
