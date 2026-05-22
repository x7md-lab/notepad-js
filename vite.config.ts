import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// COEP / COOP enable `crossOriginIsolated`, which unlocks SharedArrayBuffer.
// On GitHub Pages we can't set headers server-side; the coi-serviceworker
// shim (loaded from index.html) synthesizes them client-side on second load.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GH Pages serves at /<repo-name>/. Local dev still uses /.
  base: command === 'build' ? '/notepad-js/' : '/',
  plugins: [react()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
}))
