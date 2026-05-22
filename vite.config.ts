import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// COEP / COOP enable `crossOriginIsolated`, which unlocks SharedArrayBuffer.
// The bus uses SAB to mirror its CBOR-encoded snapshot when available.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
})
