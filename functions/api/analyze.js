export async function onRequestPost(context) {
  const { request, env } = context
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  try {
    const { text } = await request.json()

    if (!text || text.trim().length < 50) {
      return new Response(JSON.stringify({ analysis: 'Not enough content to analyze.' }), { headers })
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured', analysis: '' }), { status: 500, headers })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: 'You are an Islamic scholar assistant. Analyze Friday khutbah translations clearly and respectfully.',
        messages: [{
          role: 'user',
          content: `Analyze this khutbah translation and provide a structured summary:\n\n${text}\n\nFormat your response exactly like this:\n\n🕌 Main Theme\n[One sentence]\n\n📌 Key Points\n• [point]\n• [point]\n• [point]\n\n📖 Quranic & Hadith References\n[List any mentioned, or "None identified"]\n\n💡 Takeaways\n[What should the congregation reflect on or act upon]`,
        }],
      }),
    })

    const data = await response.json()
    const analysis = data.content?.[0]?.text?.trim() ?? 'Analysis unavailable.'
    return new Response(JSON.stringify({ analysis }), { headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, analysis: '' }), { status: 500, headers })
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
