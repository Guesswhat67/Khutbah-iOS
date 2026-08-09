// Lines starting with these are Claude meta-commentary, not translation
const COMMENTARY_STARTS = [
  'note:', '*note:', 'i recognize', 'i cannot', 'i am unable', "i'm ready", "i'm unable",
  'the text appears', 'the input', 'the phrase appears', 'the terms', 'the sentence',
  'this text', 'this input', 'literal translation', 'a clearer', 'recognizable fragments',
  'please', 'to provide', 'if you', 'i apologize', 'i would need',
  'based on the recogni', 'the recogni', 'the following recogni', 'the following words',
  'the letter', 'the overall', 'the surrounding',
  'however,', 'unfortunately,', 'without a clearer', 'without more context',
  'the arabic text', 'the provided text', 'this appears', 'this seems',
  'here are', 'here is the', 'below is', 'breaking down',
]

// Phrases anywhere in a paragraph or sentence that mark it as refusal/commentary
const KILL_PHRASES = [
  'cannot provide', 'cannot translate', 'i cannot', 'unable to translate', 'unable to provide',
  'please verify', 'please provide', 'could provide', 'if you could',
  'resubmit', 'does not form coherent', 'does not form a', 'does not form complete',
  'cannot be reliably', 'not clearly decipherable', 'not standard arabic',
  'appears to be corrupted', 'appears to be incomplete', 'appears garbled',
  'i must acknowledge', 'i need to acknowledge',
  'more coherent rendition', 'seems intended', 'what seems to be',
  'text seems fragmented', 'text is fragmented', 'text appears fragmented',
  'full, clear arabic', 'full arabic text', 'original arabic text',
  'i would be able to provide', 'accurate and complete translation',
  'please note that', 'it should be noted',
  'recognisable words', 'recognizable words', 'recognisable fragments', 'recognizable fragments',
  'partial translation', 'translatable portions', 'decipherable portions',
  'what i can', 'the parts i', 'the words i',
]

// Pull out just the translation, stripping all Claude commentary blocks
function extractTranslation(raw) {
  // Strip bold markers (**) but preserve single *asterisks* used for italic uncertainty markers
  let t = raw.replace(/\*{2,}/g, '')
  // Remove [Note: ...] and [sentence appears...] bracket blocks
  t = t.replace(/\[[\s\S]*?\]/g, '')
  // Remove trailing parenthetical asides like (Literal translation of...)
  t = t.replace(/\((?:literal|note:|the phrase|a clearer|translation|recogni)[^)]*\)/gi, '')

  // Pass 1: drop entire paragraphs containing a kill phrase
  const paragraphs = t.split(/\n{2,}/)
  const cleanParas = paragraphs.filter(para => {
    const p = para.toLowerCase()
    return !KILL_PHRASES.some(phrase => p.includes(phrase))
  })

  // Pass 2: drop commentary lines (line-start match)
  const lines = cleanParas.join('\n').split('\n').filter(line => {
    const l = line.toLowerCase().trim()
    if (!l) return false
    return !COMMENTARY_STARTS.some(s => l.startsWith(s))
  })

  // Pass 3: sentence-level — split on ". " and drop any sentence with a kill phrase
  const joined = lines.join(' ').replace(/\s+/g, ' ').trim()
  const sentences = joined.split(/(?<=\.)\s+/)
  const cleanSentences = sentences.filter(s => {
    const sl = s.toLowerCase()
    return !KILL_PHRASES.some(phrase => sl.includes(phrase))
  })

  return cleanSentences.join(' ').trim()
}

async function writeLog(env, fields) {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `INSERT INTO translation_log (issue_type, source_lang, source_text, raw_response, extra, session_token)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      fields.issue_type,
      fields.source_lang ?? null,
      (fields.source_text ?? '').slice(0, 2000),
      (fields.raw_response ?? '').slice(0, 2000),
      fields.extra ? JSON.stringify(fields.extra) : null,
      fields.session_token ?? null
    ).run()
  } catch {}
}

async function writeUtterance(env, sessionToken, sourceLang, arabicText, englishText, refusalDetected, audioKey) {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `INSERT INTO utterances (session_token, source_lang, arabic_text, english_text, refusal_detected, audio_key)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      sessionToken,
      sourceLang ?? null,
      arabicText.slice(0, 5000),
      (englishText ?? '').slice(0, 5000),
      refusalDetected ? 1 : 0,
      audioKey ?? null
    ).run()
  } catch {}
}

export async function onRequestPost(context) {
  const { request, env } = context

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  try {
    const body = await request.json()
    const { text, session_token, source_lang, audio_key, previous_context } = body

    if (!text || text.trim().length < 3) {
      return new Response(JSON.stringify({ translation: '' }), { headers })
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured', translation: '' }),
        { status: 500, headers }
      )
    }

    // Build context from previous translated sentences for continuity
    let contextBlock = ''
    if (previous_context && Array.isArray(previous_context) && previous_context.length > 0) {
      contextBlock = '\n\nPreviously you translated:\n' +
        previous_context.map((c, i) =>
          `${i + 1}. Arabic: "${c.arabic}" → English: "${c.english}"`
        ).join('\n') +
        '\n\nNow translate this next utterance naturally, keeping pronouns and references consistent with what came before:'
    }

    const langContext = {
      ar: 'The source text is Arabic.',
      ur: 'The source text is Urdu — it may mix Urdu and Arabic phrases.',
      tr: 'The source text is Turkish — it may mix Turkish and Arabic phrases.',
      id: 'The source text is Indonesian (Bahasa) — it may mix Indonesian and Arabic phrases.',
    }
    const langHint = langContext[source_lang] || ''

    const systemPrompt = `You are a live khutbah (Friday sermon) translator. Produce a literal English translation of every input. No exceptions.

ABSOLUTE RULES — never break these:
- Output ONLY the English translation. No labels, no colons, no preamble, no meta-commentary.
- NEVER refuse. NEVER ask questions. NEVER explain what you are doing.
- NEVER output phrases like "the recognisable words", "partial translation", "I can only translate", "the following words", or any similar commentary.
- If text is partially garbled: output the translation of recognisable words and transliteration of the rest, wrapping ONLY the uncertain/transliterated parts in single *asterisks* like *this*. Confident translations are NOT wrapped.
- If input is already English, output it unchanged.

Context — the speaker is an imam giving a Friday sermon. Common topics: Quranic verses, hadith, prophets (Dawud, Ibrahim, Musa, Isa, Shu'ayb, Lut), Islamic virtues, prayer, fasting, dhikr.

Preserve exactly: Alhamdulillah, SubhanAllah, Allahu Akbar, Salah, Taqwa, Ummah, Deen, Hadith, Sunnah, Jumu'ah, Zakat, Hijab, Halal, Haram, Inshallah, Bismillah, Salawat, Rasulullah, Sallallahu alayhi wa sallam.

If you recognise a Quranic ayah, append its reference in brackets e.g. [Al-Imran 3:37]. If uncertain, do not add anything.`

    const userMessage = text + contextBlock

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    const data = await response.json()
    const rawTranslation = data.content?.[0]?.text?.trim() ?? ''

    // Extract just the translation — strip all [Note:] blocks and commentary lines
    const translation = extractTranslation(rawTranslation)
    const wasRefusal = !translation || translation.length < 2

    if (env.DEBUG_MODE === 'true' && session_token) {
      context.waitUntil(
        writeUtterance(env, session_token, source_lang ?? null, text, wasRefusal ? '' : translation, wasRefusal, audio_key ?? null)
      )
    }

    if (wasRefusal) {
      context.waitUntil(
        writeLog(env, {
          issue_type: 'claude_refusal',
          source_lang,
          source_text: text,
          raw_response: rawTranslation,
          session_token,
        })
      )
      return new Response(JSON.stringify({ translation: '' }), { headers })
    }

    return new Response(JSON.stringify({ translation }), { headers })
  } catch (err) {
    context.waitUntil(
      writeLog(env, { issue_type: 'api_error', raw_response: err.message })
    )
    return new Response(
      JSON.stringify({ error: err.message, translation: '' }),
      { status: 500, headers }
    )
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
