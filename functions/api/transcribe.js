const R2_MAX_BYTES = 8 * 1024 * 1024 * 1024  // 8 GB threshold
const R2_TARGET_BYTES = 6 * 1024 * 1024 * 1024 // delete down to 6 GB

async function cleanupAudioIfNeeded(bucket) {
  try {
    let objects = []
    let cursor
    do {
      const listed = await bucket.list({ cursor, limit: 1000 })
      objects = objects.concat(listed.objects)
      cursor = listed.truncated ? listed.cursor : undefined
    } while (cursor)

    const totalBytes = objects.reduce((sum, o) => sum + o.size, 0)
    if (totalBytes <= R2_MAX_BYTES) return

    objects.sort((a, b) => new Date(a.uploaded) - new Date(b.uploaded))

    let current = totalBytes
    for (const obj of objects) {
      if (current <= R2_TARGET_BYTES) break
      await bucket.delete(obj.key)
      current -= obj.size
    }
  } catch {}
}

export async function onRequestPost(context) {
  const { request, env } = context
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  try {
    if (!env.AI) {
      return new Response(JSON.stringify({ error: 'AI binding not configured', text: '' }), { status: 500, headers })
    }

    const url = new URL(request.url)
    const lang = url.searchParams.get('lang') || 'ar'
    const sessionToken = url.searchParams.get('session_token') || null

    const arrayBuffer = await request.arrayBuffer()

    if (!arrayBuffer || arrayBuffer.byteLength < 500) {
      return new Response(JSON.stringify({ text: '' }), { headers })
    }

    // initial_prompt primes Whisper with Islamic vocabulary, reducing hallucinations
    // and improving accuracy on Arabic religious speech (22%+ WER improvement per research)
    // Minimal prompt — enough to anchor the language without seeding hallucinations
    const initialPrompts = {
      ar: 'بسم الله الرحمن الرحيم.',
      ur: 'بسم اللہ الرحمن الرحیم۔',
      tr: 'Bismillahirrahmanirrahim.',
      id: 'Bismillahirrahmanirrahim.',
    }

    const response = await env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(arrayBuffer)],
      language: lang,
      vad_filter: 'true',
      initial_prompt: initialPrompts[lang] ?? initialPrompts.ar,
    })

    const text = response.text?.trim() ?? ''

    let audioKey = null
    if (env.DEBUG_MODE === 'true' && env.AUDIO_BUCKET && sessionToken && arrayBuffer.byteLength >= 500) {
      audioKey = `sessions/${sessionToken}/${Date.now()}.webm`
      context.waitUntil(
        env.AUDIO_BUCKET.put(audioKey, arrayBuffer, {
          httpMetadata: { contentType: 'audio/webm' },
          customMetadata: { session_token: sessionToken, lang },
        })
      )
      // ~2% chance per chunk — runs cleanup roughly once per session
      if (Math.random() < 0.02) {
        context.waitUntil(cleanupAudioIfNeeded(env.AUDIO_BUCKET))
      }
    }

    return new Response(JSON.stringify({ text, audio_key: audioKey }), { headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, text: '' }), { status: 500, headers })
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
