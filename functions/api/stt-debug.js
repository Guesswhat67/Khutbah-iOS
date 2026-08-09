/**
 * POST /api/stt-debug
 * Receives Google STT debug logs from the Android app and stores them in D1.
 * 
 * Body: { mode, samples, raw_response, transcript, error, timestamp }
 */
export async function onRequestPost(context) {
  const { request, env } = context
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  try {
    const body = await request.json()
    const { mode, samples, raw_response, transcript, error, timestamp } = body

    if (env.DB) {
      await env.DB.prepare(
        `INSERT INTO translation_log (issue_type, source_lang, source_text, raw_response, extra, session_token)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        'stt_debug',
        mode ?? 'google',
        (transcript ?? '').slice(0, 2000),
        (raw_response ?? '').slice(0, 5000),
        JSON.stringify({ samples, error, timestamp }),
        null
      ).run()
    }

    // Also store in R2 for longer retention
    if (env.AUDIO_BUCKET) {
      const key = `stt-debug/${timestamp || Date.now()}_${mode || 'google'}.json`
      const payload = JSON.stringify({ mode, samples, raw_response, transcript, error, timestamp })
      await env.AUDIO_BUCKET.put(key, payload, {
        httpMetadata: { contentType: 'application/json' }
      })
    }

    return new Response(JSON.stringify({ ok: true }), { headers })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers })
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}