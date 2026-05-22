import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/quickjs-wasi-reactor/qjs-wasi.wasm')
const dst = resolve(root, 'public/qjs-wasi.wasm')

if (!existsSync(src)) {
  console.warn('[copy-wasm] source not found yet:', src)
  process.exit(0)
}

mkdirSync(dirname(dst), { recursive: true })
copyFileSync(src, dst)
console.log('[copy-wasm] copied qjs-wasi.wasm -> public/')
