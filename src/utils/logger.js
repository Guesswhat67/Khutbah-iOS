import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { apiFetch, apiHeaders } from './net'

const IS_NATIVE = Capacitor.isNativePlatform()
const API_BASE = IS_NATIVE ? 'https://khutbah-v2.pages.dev' : ''

let isInitialized = false

const getTimestamp = () => new Date().toISOString()

const getSettings = () => {
  try {
    const s = localStorage.getItem('khutbah-settings')
    if (s) return JSON.parse(s)
  } catch {}
  return {}
}

const safeStringify = (arg) => {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack || arg.message
  try {
    return JSON.stringify(arg)
  } catch {
    return '[Unserializable]'
  }
}

let isLogging = false
let memLogs = []

try {
  const existing = localStorage.getItem('app_local_logs')
  if (existing) {
    memLogs = JSON.parse(existing)
  }
} catch {}

const saveLogsToStorage = () => {
  try {
    if (memLogs.length > 2000) {
      memLogs = memLogs.slice(memLogs.length - 2000)
    }
    localStorage.setItem('app_local_logs', JSON.stringify(memLogs))
  } catch {}
}

// `opts.noRemote` suppresses ONLY the D1/network write (local mem-log + console
// path is untouched). Used by the Quran detect debug lines so verbose detection
// traces never reach D1 unless Developer Options is on. See QuranMode dbg().
const writeLog = (tab, level, args, opts = {}) => {
  if (isLogging) return

  const settings = getSettings()
  const mode = settings.loggingMode || 'off'
  const isDebug = !!settings.debugMode

  if (mode === 'off') return

  // Filter out debug logs if debug mode is off
  if (level === 'DEBUG' && !isDebug) return

  const message = args.map(safeStringify).join(' ')

  isLogging = true
  try {
    // Format: [TIMESTAMP] [TAB] [LEVEL] Message
    const line = `[${getTimestamp()}] [${tab}] [${level}] ${message}`

    if (mode === 'local' || mode === 'both') {
      memLogs.push(line)
      saveLogsToStorage()
    }

    if ((mode === 'cloud' || mode === 'both') && !opts.noRemote) {
      // Best-effort log POST — cap hang at 8s so a slower masjid connection
      // can't stall the JS event loop. Single retry on 5xx is plenty: dropped
      // log entries are a debug-quality-of-life concern, not a correctness one.
      apiFetch(API_BASE + '/api/log', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          issue_type: level,
          source_lang: tab, // Using source_lang to hold the tab name
          source_text: message,
        }),
      }, { timeoutMs: 8000, retries: 1 }).catch(() => {})
    }
  } finally {
    isLogging = false
  }
}

// Export custom tab loggers
export const logKhutbah = (level, ...args) => writeLog('KHUTBAH', level, args)
export const logQuran = (level, ...args) => writeLog('QURAN', level, args)
// Like logQuran but never writes to D1 (local/console only). For gated debug traces.
export const logQuranLocal = (level, ...args) => writeLog('QURAN', level, args, { noRemote: true })
export const logMaktaba = (level, ...args) => writeLog('MAKTABA', level, args)
export const logApp = (level, ...args) => writeLog('APP', level, args)

export const initLogger = () => {
  if (isInitialized) return
  isInitialized = true

  const origLog = console.log
  const origWarn = console.warn
  const origInfo = console.info
  const origError = console.error
  const origDebug = console.debug

  console.log = (...args) => {
    origLog(...args)
    writeLog('APP', 'INFO', args)
  }
  console.info = (...args) => {
    origInfo(...args)
    writeLog('APP', 'INFO', args)
  }
  console.warn = (...args) => {
    origWarn(...args)
    writeLog('APP', 'WARN', args)
  }
  console.error = (...args) => {
    origError(...args)
    writeLog('APP', 'ERROR', args)
  }
  console.debug = (...args) => {
    origDebug(...args)
    writeLog('APP', 'DEBUG', args)
  }
}

export const getMemLogs = () => memLogs

export const clearLocalLogs = async () => {
  memLogs = []
  localStorage.removeItem('app_local_logs')
}

export const getLocalLogUri = async () => {
  if (!IS_NATIVE) return null
  if (memLogs.length === 0) return null

  try {
    const chunk = memLogs.join('\n')
    await Filesystem.writeFile({
      path: 'export_app_logs.txt',
      data: chunk,
      directory: Directory.Cache,
      encoding: Encoding.UTF8
    })
    
    const res = await Filesystem.getUri({
      path: 'export_app_logs.txt',
      directory: Directory.Cache
    })
    return res.uri
  } catch {
    return null
  }
}
