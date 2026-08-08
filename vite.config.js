import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// PLAN-026: Sentry source-map upload.
// The plugin auto-uploads JS sourcemaps after `vite build`, tagged with the
// current package.json release. We gate the upload on `VITE_SENTRY_AUTH_TOKEN`
// so dev/CI builds without the auth token stay local-only — no upload attempt
// is made when the token is missing.
const SENTRY_AUTH_TOKEN = (process.env.VITE_SENTRY_AUTH_TOKEN || '').trim()
const SENTRY_ORG = (process.env.VITE_SENTRY_ORG || '').trim()
const SENTRY_PROJECT = (process.env.VITE_SENTRY_PROJECT || '').trim()
const APP_VERSION = (process.env.VITE_APP_VERSION || 'noor-ios@1.0.0+1').trim()

const sentryPlugins = (SENTRY_AUTH_TOKEN && SENTRY_ORG && SENTRY_PROJECT)
  ? [sentryVitePlugin({
      authToken: SENTRY_AUTH_TOKEN,
      org: SENTRY_ORG,
      project: SENTRY_PROJECT,
      release: { name: APP_VERSION, cleanArtifacts: true },
      // Sourcemap upload should not block vite's normal exit — the plugin
      // is a post-build hook, not a load-time transformer.
      sourcemaps: { assets: ['./dist/**/*'] },
      inject: false,           // Don't auto-import the Sentry SDK into bundle
      telemetry: false,        // Don't phone home about plugin usage
      debug: false,
    })]
  : []

export default defineConfig({
  // Both hidden-source-map and Sentry's plugin need `.map` files emitted.
  // `hidden` strips the "//# sourceMappingURL=" comment so users / Sentry
  // still get maps but the comment isn't public.
  build: { sourcemap: 'hidden' },
  plugins: [react(), ...sentryPlugins],
  server: {
    proxy: {
      '/api': 'http://localhost:8788'
    }
  }
})
