const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
}

const corsHeaders = {
  ...headers,
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function onRequest(context) {
  const { request, env } = context
  const method = request.method

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 500, headers })
  }

  try {
    // GET — fetch all sessions newest first
    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM sessions ORDER BY created_at DESC'
      ).all()
      return new Response(JSON.stringify({ sessions: results ?? [] }), { headers })
    }

    // POST — save a new session
    if (method === 'POST') {
      const { date_label, duration, sentence_count, arabic_text, english_text, analysis, session_token } = await request.json()
      const result = await env.DB.prepare(
        `INSERT INTO sessions (date_label, duration, sentence_count, arabic_text, english_text, analysis, session_token)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        date_label ?? '',
        duration ?? 0,
        sentence_count ?? 0,
        (arabic_text ?? '').slice(0, 50000),
        (english_text ?? '').slice(0, 50000),
        analysis ?? null,
        session_token ?? null
      ).run()
      return new Response(JSON.stringify({ id: result.meta.last_row_id }), { headers })
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    // DELETE — remove one (with ?id) or all (without)
    if (method === 'DELETE') {
      if (id) {
        await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(Number(id)).run()
      } else {
        await env.DB.prepare('DELETE FROM sessions').run()
      }
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    // PATCH — update analysis on an existing session
    if (method === 'PATCH') {
      const { analysis } = await request.json()
      await env.DB.prepare('UPDATE sessions SET analysis = ? WHERE id = ?')
        .bind(analysis ?? null, Number(id)).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
  }
}
