// Shared AI-content renderer — parses [QURAN:S:A] deep-link tokens in analyze
// responses and turns them into tappable buttons that navigate to the Quran tab.
//
// Extracted from App.jsx so that lazy-loaded consumers (QuranMode, ReferenceMode)
// can import it without creating a circular dependency back to App.jsx.

import React from 'react'

export const renderAIContent = (text, onNavigate) => {
  if (!text) return null
  const regex = /\[QURAN:(\d+):(\d+)\]/g
  const parts = []
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const surah = parseInt(match[1], 10)
    const ayah = parseInt(match[2], 10)
    parts.push(
      <button 
        key={match.index} 
        className="ai-deep-link" 
        onClick={() => onNavigate && onNavigate(surah, ayah)}
      >
        📖 Surah {surah}, Ayah {ayah}
      </button>
    )
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.map((part, i) => <span key={i}>{part}</span>)
}
