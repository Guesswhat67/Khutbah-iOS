// ElevenLabs Scribe v2 Realtime — shared cloud STT for Khutbah + Quran Detect.
//
// Flow: fetch single-use token from /api/stt/token → WebSocket to ElevenLabs →
// stream PCM16 mic audio → receive committed transcripts. On native Android we also
// start RecordingService (wake lock + foreground notification) without opening a
// second native mic when using the JS getUserMedia path.

import { Capacitor } from '@capacitor/core'
import { SherpaSTT } from '../plugins/SherpaSTT'
import { filterTranscript } from './sttSanity'
import { apiFetch, apiHeaders } from './net'

const IS_NATIVE = Capacitor.isNativePlatform()
const API_BASE = IS_NATIVE ? 'https://khutbah-v2.pages.dev' : ''
const WS_BASE = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
const SAMPLE_RATE = 16000

// Silence gating. ElevenLabs bills per streamed minute, so streaming silence burns
// credits for nothing — and long stretches of silence also cause the model to
// "hallucinate" phantom transcripts. When RMS stays below SILENCE_RMS for longer
// than SILENCE_GATE_MS we stop sending audio (after one final commit to flush the
// pending segment) and resume the instant real voice returns.
const SILENCE_RMS = 0.008     // RMS below this = no voice this buffer
const SILENCE_GATE_MS = 5000  // sustained silence before we pause streaming

function float32ToPcm16(float32) {
  const out = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    out[i] = s < 0 ? s * 32768 : s * 32767
  }
  return out
}

// Linear-interpolation downsample from `inRate` to `outRate`. Critical on Android
// WebViews that ignore `new AudioContext({ sampleRate })` and run the mic at 44.1/48 kHz:
// without this, 48 kHz audio gets sent labelled as 16 kHz and ElevenLabs transcribes
// garbage (3× too fast) — the root cause of "connected, credits burn, no transcript".
function downsample(float32, inRate, outRate) {
  if (inRate === outRate) return float32
  const ratio = inRate / outRate
  const outLen = Math.floor(float32.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, float32.length - 1)
    const frac = pos - i0
    out[i] = float32[i0] * (1 - frac) + float32[i1] * frac
  }
  return out
}

function pcm16ToBase64(pcm16) {
  const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
  let bin = ''
  const step = 8192
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step))
  }
  return btoa(bin)
}

async function fetchToken() {
  // Use apiFetch so a hung token endpoint can't stall the Scribe connect UI
  // forever (e.g. flaky masjid Wi-Fi with slow TLS handshake to Cloudflare).
  // The /api/stt/token endpoint is a tiny Cloudflare Worker cached in the edge
  // — median <500ms — so an 8s timeout is generous and the 2 retries on 5xx
  // recover from a single edge-node hiccup before the user sees an error.
  const res = await apiFetch(
    `${API_BASE}/api/stt/token`,
    { headers: apiHeaders() },
    { timeoutMs: 8000, retries: 2 },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Token HTTP ${res.status}`)
  if (!data.token) throw new Error('No token returned')
  return data.token
}

export class ScribeSession {
  constructor() {
    this._ws = null
    this._stream = null
    this._audioCtx = null
    this._processor = null
    this._connected = false
    this._firstChunk = true
    this._onCommitted = null
    this._onPartial = null
    this._onError = null
    this._lang = 'ar'
    this._watchdogMs = 0
    this._lastCommitAt = 0
    this._onStatus = null
    this._msgCount = 0
    this._chunkCount = 0
    this._lastVoiceTs = 0   // last time RMS crossed the voice threshold
    this._gated = false     // true while we're skipping sends due to silence
    this._requestedDisconnect = false   // true once we ask the WS to close ourselves (so onclose doesn't fire a fake error)
  }

  get isConnected() { return this._connected }

  async connect({
    languageCode = 'ar',
    keyterms = [],
    onCommitted,
    onPartial,
    onError,
    onStatus,
    filterResults = true,
    // Safety net: if partials keep flowing but the server's VAD never commits (e.g.
    // continuous speech, or the vad commit strategy not taking effect), force a manual
    // commit every N ms so downstream consumers (Khutbah translate) still get segments.
    commitWatchdogMs = 0,
  } = {}) {
    this._onCommitted = onCommitted
    this._onPartial = onPartial
    this._onError = onError
    this._onStatus = onStatus
    this._filterResults = filterResults
    this._lang = languageCode
    this._firstChunk = true
    this._watchdogMs = commitWatchdogMs
    // Fix #2: don't pre-load _lastCommitAt to "now" — if the user stays silent
    // longer than commitWatchdogMs before any partial arrives, the very first
    // speech chunk would otherwise force an immediate commit and chop the
    // opening word. We initialize to 0 and reset at the first partial below.
    this._lastCommitAt = 0

    this._onStatus?.('fetching token')
    const token = await fetchToken()
    this._onStatus?.('token ok, opening WebSocket')

    const params = new URLSearchParams({
      model_id: 'scribe_v2_realtime',
      token,
      language_code: languageCode,
      commit_strategy: 'vad',
      audio_format: 'pcm_16000',
    })
    for (const kt of keyterms.slice(0, 20)) params.append('keyterms', kt)

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_BASE}?${params}`)
      this._ws = ws
      let settled = false

      ws.onopen = () => {
        this._connected = true
        settled = true
        this._onStatus?.('WebSocket open')
        resolve()
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          this._msgCount++
          if (this._msgCount <= 3) this._onStatus?.(`WS msg #${this._msgCount}: ${msg.message_type || 'unknown'}`)
          this._handleMessage(msg)
        } catch (e) {
          this._onError?.(e)
        }
      }

      ws.onerror = () => {
        const err = new Error('WebSocket error')
        if (!settled) { settled = true; reject(err) }
        else this._onError?.(err)
      }

      ws.onclose = (ev) => {
        this._connected = false
        const wasRequested = !!this._requestedDisconnect
        this._onStatus?.(`WebSocket closed${ev?.code ? ` (${ev.code})` : ''}${wasRequested ? ' (local)' : ''}`)
        // Server-initiated closures (e.g. idle timeout after our silence gate stops
        // sending bytes) would otherwise be invisible to callers. Surface them so the
        // UI can show "connection lost" instead of looking frozen on "listening".
        if (!wasRequested) this._onError?.(new Error(`Scribe socket closed unexpectedly (code ${ev?.code ?? '?'})`))
      }
    })

    if (IS_NATIVE) {
      try { await SherpaSTT.startForegroundSession() } catch {}
    }
  }

  _handleMessage(msg) {
    const type = msg.message_type
    if (type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') {
      this._lastCommitAt = Date.now()
      const text = (msg.text || '').replace(/\s+/g, ' ').trim()
      if (!text) return
      const out = this._filterResults ? filterTranscript(text, { lang: this._lang }) : text
      if (out) this._onCommitted?.(out)
    } else if (type === 'partial_transcript') {
      // Touch the timestamp on every partial so the watchdog measures "time since
      // the last partial/committed activity", not "time since the bogus pre-connect
      // value". This prevents the first-word-chop described above.
      if (this._lastCommitAt === 0) this._lastCommitAt = Date.now()
      // Watchdog: speech is flowing but nothing has committed for a while → force it.
      if (this._watchdogMs > 0 && Date.now() - this._lastCommitAt > this._watchdogMs) {
        this._lastCommitAt = Date.now()
        this.commit()
      }
      const text = (msg.text || '').replace(/\s+/g, ' ').trim()
      if (text) this._onPartial?.(text)
    } else if (type === 'session_started' || type === 'session_config') {
      // Handshake acknowledgements — nothing to do, but not an error.
    } else if (msg.error || msg.message || /error|invalid|exceeded|limited|throttled|overflow|exhausted|unaccepted/i.test(type || '')) {
      // Covers documented (error/auth_error/…) AND undocumented (e.g. invalid_request) rejections.
      const detail = msg.error || msg.message || 'no detail'
      this._onError?.(new Error(`${type || 'error'}: ${detail}`))
    }
  }

  _sendPcm(pcm16, commit = false) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return
    const payload = {
      message_type: 'input_audio_chunk',
      audio_base_64: pcm16ToBase64(pcm16),
      commit,
      sample_rate: SAMPLE_RATE,
    }
    this._ws.send(JSON.stringify(payload))
    this._firstChunk = false
  }

  async startMicrophone() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
      },
    })
    this._stream = stream

    // Don't force 16 kHz on the context — many Android WebViews silently ignore it and
    // run at the hardware rate. Use the real rate and downsample ourselves so what we
    // send always matches the pcm_16000 we declared to ElevenLabs.
    const ctx = new AudioContext()
    this._audioCtx = ctx
    if (ctx.state === 'suspended') {
      try { await ctx.resume() } catch (e) { this._onError?.(e) }
    }
    const inRate = ctx.sampleRate
    this._onStatus?.(`mic ${inRate} Hz → ${SAMPLE_RATE} Hz`)
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    this._processor = processor
    this._lastVoiceTs = Date.now()
    this._gated = false

    processor.onaudioprocess = (e) => {
      if (!this._connected) return
      const input = e.inputBuffer.getChannelData(0)

      // RMS on the raw (pre-downsample) buffer to decide if this chunk has voice.
      let sum = 0
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
      const rms = Math.sqrt(sum / input.length)
      const now = Date.now()
      const hasVoice = rms >= SILENCE_RMS
      if (hasVoice) this._lastVoiceTs = now

      if (this._gated) {
        // Only real voice exits gating — resume streaming with this very buffer.
        if (!hasVoice) return
        this._gated = false
        this._onStatus?.('🎙 voice — resumed')
      } else if (!hasVoice && now - this._lastVoiceTs > SILENCE_GATE_MS) {
        // Entering gated state: flush the pending segment once, then stop sending.
        this._gated = true
        this._onStatus?.('🔇 silence — paused streaming')
        this.commit()
        return
      }

      const resampled = downsample(input, inRate, SAMPLE_RATE)
      const pcm = float32ToPcm16(resampled)
      this._sendPcm(pcm, false)
      this._chunkCount++
      if (this._chunkCount === 1) this._onStatus?.('first audio chunk sent')
    }

    source.connect(processor)
    processor.connect(ctx.destination)
    this._onStatus?.(`mic streaming (ctx: ${ctx.state})`)
  }

  commit() {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return
    this._ws.send(JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: '',
      commit: true,
      sample_rate: SAMPLE_RATE,
    }))
  }

  async disconnect() {
    // Fix #4: set the "we initiated this close" flag FIRST so any synchronous
    // onclose delivery (some browsers fire it the instant the WebSocket
    // transitions) sees `_requestedDisconnect === true` and skips the spurious
    // "Scribe socket closed unexpectedly" error path. State mutation then the
    // `_ws.close()` itself follow.
    this._requestedDisconnect = true
    this._connected = false
    try { this._processor?.disconnect() } catch {}
    try { this._audioCtx?.close() } catch {}
    this._processor = null
    this._audioCtx = null
    if (this._stream) {
      for (const t of this._stream.getTracks()) t.stop()
      this._stream = null
    }
    if (this._ws) {
      try { this._ws.close() } catch {}
      this._ws = null
    }
    if (IS_NATIVE) {
      try { await SherpaSTT.stopForegroundSession() } catch {}
    }
  }
}

export { fetchToken, filterTranscript }
