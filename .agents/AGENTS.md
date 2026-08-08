# Project Rules

### 1. Apple Speech-to-Text standard
- **Constraint**: When integrating or maintaining STT on this iOS project, always prioritize native Apple Speech-to-Text via `@capacitor-community/speech-recognition` rather than falling back to ElevenLabs or relying on Android/Sherpa models.
- **Pattern**: `plugins/AppleSTT.js` is the standard wrapper mimicking the expected streaming event interface.

### 2. iPad UI Optimization standard
- **Constraint**: All new UI components must gracefully scale to iPad sizes using the `@media (min-width: 768px)` breakpoint.
- **Pattern**: Avoid stretched single-column layouts on iPads; use CSS Grid for side-by-side (`grid-template-columns: 1fr 1fr`) or multi-column card layouts, and increase `font-size` and touch target padding globally.
