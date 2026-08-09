export async function onRequestPost(context) {
  const { request, env } = context
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  try {
    const body = await request.json()
    const { issue_type, source_lang, source_text, raw_response, extra, session_token } = body

    if (!issue_type) {
      return new Response(JSON.stringify({ ok: false, error: 'issue_type required' }), { status: 400, headers })
    }

    if (env.DB) {
      await env.DB.prepare(
        `INSERT INTO translation_log (issue_type, source_lang, source_text, raw_response, extra, session_token)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        issue_type,
        source_lang ?? null,
        (source_text ?? '').slice(0, 2000),
        (raw_response ?? '').slice(0, 2000),
        extra ? JSON.stringify(extra) : null,
        session_token ?? null
      ).run()
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
