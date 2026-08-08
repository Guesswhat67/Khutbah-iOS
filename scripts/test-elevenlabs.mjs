// Live ElevenLabs Scribe transcription test — feeds REAL Quran recitation audio through the
// EXACT realtime path the app uses (mint token from the deployed /api/stt/token → WebSocket
// scribe_v2_realtime, pcm_16000, commit_strategy=vad → stream 16kHz PCM → collect committed
// transcripts) and compares the result to the known ayah text.
//
//   node scripts/test-elevenlabs.mjs            # default clip set (Alafasy)
//   RECITER=Husary_128kbps node scripts/test-elevenlabs.mjs
//
// Reads VITE_APP_TOKEN from .env.local (gitignored). No secret is printed or committed.
// Requires: Node 24+ (native fetch + WebSocket), ffmpeg on PATH, network.

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { norm } from '../src/utils/quranStore.js'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const verses = JSON.parse(fs.readFileSync(path.join(__dir, '..', 'public', 'quran.json'), 'utf8').replace(/^﻿/, ''))
const byKey = new Map(); for (const v of verses) byKey.set(`${v.s}:${v.a}`, v)

const APP_TOKEN = (fs.readFileSync(path.join(__dir, '..', '.env.local'), 'utf8').match(/VITE_APP_TOKEN\s*=\s*(.+)/) || [])[1]?.trim().replace(/^["']|["']$/g, '')
if (!APP_TOKEN) { console.error('No VITE_APP_TOKEN in .env.local'); process.exit(1) }
const TOKEN_URL = 'https://khutbah-v2.pages.dev/api/stt/token'
const WS_BASE = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
const RECITER = process.env.RECITER || 'Alafasy_128kbps'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ell-'))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const pad3 = n => String(n).padStart(3, '0')
const ALEF = 0x0627, LAM = 0x0644
const stripAl = w => (w.length > 4 && w.charCodeAt(0) === ALEF && w.charCodeAt(1) === LAM) ? w.slice(2) : w
const toks = t => norm(t).split(' ').filter(w => w.length > 1)

// 20 clips: short surahs, long ayat (Kursi), mid-surah, varied phonetics.
const CLIPS = [
  [1, 1], [1, 2], [1, 4], [1, 7], [112, 1], [112, 3], [113, 1], [114, 1],
  [108, 1], [105, 1], [2, 255], [2, 1], [2, 2], [36, 1], [55, 1], [67, 1],
  [78, 1], [109, 1], [103, 1], [36, 9],
]

// LCS-based recall: fraction of expected words matched in order.
function recall(expWords, gotWords) {
  if (!expWords.length) return 1
  const m = expWords.length, n = gotWords.length
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = expWords[i - 1] === gotWords[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  return dp[m][n] / m
}

async function mintToken() {
  const res = await fetch(TOKEN_URL, { headers: { 'x-app-token': APP_TOKEN } })
  const j = await res.json().catch(() => ({}))
  if (!j.token) throw new Error('token mint failed: ' + res.status)
  return j.token
}

function fetchPcm(s, a) {
  const url = `https://everyayah.com/data/${RECITER}/${pad3(s)}${pad3(a)}.mp3`
  const mp3 = path.join(TMP, `${s}_${a}.mp3`), raw = path.join(TMP, `${s}_${a}.raw`)
  const dl = spawnSync('curl', ['-sL', '--max-time', '30', '-o', mp3, url])
  if (dl.status !== 0 || !fs.existsSync(mp3) || fs.statSync(mp3).size < 500) return null
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', mp3, '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', raw])
  if (ff.status !== 0 || !fs.existsSync(raw)) return null
  return fs.readFileSync(raw)
}

async function transcribe(pcm) {
  const token = await mintToken()
  const params = new URLSearchParams({ model_id: 'scribe_v2_realtime', token, language_code: 'ar', commit_strategy: 'vad', audio_format: 'pcm_16000' })
  const ws = new WebSocket(`${WS_BASE}?${params}`)
  const committed = []; let partials = 0, errored = null
  await new Promise((resolve) => {
    let done = false; const finish = () => { if (done) return; done = true; try { ws.close() } catch {} resolve() }
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data) } catch { return }
      if (m.message_type === 'committed_transcript') committed.push(m.text || '')
      else if (m.message_type === 'partial_transcript') partials++
      else if (m.error || /error|invalid|exceed|limit/i.test(m.message_type || '')) errored = m.error || m.message_type
    }
    ws.onerror = () => { errored = errored || 'ws error'; finish() }
    ws.onclose = () => finish()
    ws.onopen = async () => {
      const CH = 8192  // 4096 samples = 256ms @16kHz, like the app's ScriptProcessor
      for (let off = 0; off < pcm.length && !done; off += CH) {
        ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: pcm.subarray(off, off + CH).toString('base64'), commit: false, sample_rate: 16000 }))
        await sleep(110)   // ~2.3x realtime — streamed, not batched
      }
      ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16000 }))
      await sleep(3500)    // let the final committed transcript arrive
      finish()
    }
    setTimeout(finish, 90000)
  })
  return { transcript: committed.join(' ').trim(), partials, errored }
}

console.log(`ElevenLabs Scribe live test — reciter ${RECITER}, ${CLIPS.length} clips\n`)
let sumExact = 0, sumAl = 0, ran = 0, badAudio = 0
const rows = []
for (const [s, a] of CLIPS) {
  const v = byKey.get(`${s}:${a}`); if (!v) continue
  const pcm = fetchPcm(s, a)
  if (!pcm) { badAudio++; console.log(`${s}:${a}  ⚠ audio download/decode failed`); continue }
  const secs = (pcm.length / 2 / 16000).toFixed(1)
  let r
  try { r = await transcribe(pcm) } catch (e) { console.log(`${s}:${a}  ✗ ${e.message}`); continue }
  const exp = toks(v.ar), got = toks(r.transcript)
  const exact = recall(exp, got)
  const alRec = recall(exp.map(stripAl), got.map(stripAl))
  sumExact += exact; sumAl += alRec; ran++
  rows.push({ sa: `${s}:${a}`, secs, exact, alRec, exp: exp.join(' '), got: got.join(' '), err: r.errored, partials: r.partials })
  console.log(`${(`${s}:${a}`).padEnd(7)} ${secs}s  exact ${(exact * 100).toFixed(0).padStart(3)}%  ال-insens ${(alRec * 100).toFixed(0).padStart(3)}%${r.errored ? '  ⚠ ' + r.errored : ''}`)
}

console.log('\n────────── per-clip detail (normalized) ──────────')
for (const r of rows) {
  console.log(`\n${r.sa}  (exact ${(r.exact * 100).toFixed(0)}% / ال-insens ${(r.alRec * 100).toFixed(0)}%)`)
  console.log('  expected: ' + r.exp)
  console.log('  got     : ' + (r.got || '(empty)'))
}
console.log('\n══════════ SUMMARY ══════════')
console.log(`clips transcribed: ${ran}${badAudio ? ` (${badAudio} audio failures)` : ''}`)
if (ran) {
  console.log(`avg exact-word recall     : ${(sumExact / ran * 100).toFixed(1)}%`)
  console.log(`avg ال-insensitive recall : ${(sumAl / ran * 100).toFixed(1)}%  ← what the tracker effectively sees`)
}
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
