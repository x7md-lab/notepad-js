import { useMemo } from 'react'
import { bus } from './bus'

interface Props {
  compiledCode: string | null
  error?: string | null
  height?: number
}

const REACT_VERSION = '18.3.1'
const RECHARTS_VERSION = '3.8.1'
const YOGA_VERSION = '0.3.3'
const PRETEXT_VERSION = '0.0.7'

const ESM = 'https://esm.sh'

const CBOR_X_VERSION = '1.6.4'

const IMPORT_MAP = {
  imports: {
    react: `${ESM}/react@${REACT_VERSION}`,
    'react/': `${ESM}/react@${REACT_VERSION}/`,
    'react-dom': `${ESM}/react-dom@${REACT_VERSION}`,
    'react-dom/': `${ESM}/react-dom@${REACT_VERSION}/`,
    recharts: `${ESM}/recharts@${RECHARTS_VERSION}?deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}`,
    'yoga-wasm-web': `${ESM}/yoga-wasm-web@${YOGA_VERSION}`,
    'yoga-wasm-web/': `${ESM}/yoga-wasm-web@${YOGA_VERSION}/`,
    '@chenglou/pretext': `${ESM}/@chenglou/pretext@${PRETEXT_VERSION}`,
    'cbor-x': `${ESM}/cbor-x@${CBOR_X_VERSION}`,
  },
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack issues on large buffers.
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    )
  }
  return btoa(s)
}

function buildSrcDoc(
  compiled: string,
  error: string | null | undefined,
  snapshotBytes: Uint8Array,
): string {
  const escapedError = (error ?? '').replace(/</g, '&lt;')
  const errorBlock = error
    ? `<pre class="__err">${escapedError}</pre>`
    : ''
  // CBOR-encoded snapshot, embedded as base64. cbor-x preserves BigInt,
  // Date, Map, Set, ArrayBuffer natively — no tagging needed.
  const snapBase64 = bytesToBase64(snapshotBytes)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<script type="importmap">
${JSON.stringify(IMPORT_MAP, null, 2)}
</script>
<style>
  html, body { margin: 0; padding: 0; background: #1c1c1c; color: #e6e6e6; }
  body { font: 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 12px; }
  #root:empty::before { content: "Define a function called App to render. Example: function App() { return <h1>hi</h1> }"; color: #888; font-size: 12px; }
  .__err { color: #f28b82; white-space: pre-wrap; font: 12px ui-monospace,Menlo,Consolas,monospace; padding: 12px; margin: 0; }
</style>
</head>
<body>
${errorBlock}
<div id="root"></div>
<script type="module">
import * as __React from 'react'
import { createRoot as __createRoot } from 'react-dom/client'

// ---- Bus shim (mirrors main-thread bus via BroadcastChannel) ----
import { decode as __cborDecode } from 'cbor-x'

function __b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const __ch = new BroadcastChannel('js-terminal-bus')
const __id = 'iframe-' + Math.random().toString(36).slice(2, 8)
const __snap = __cborDecode(__b64ToBytes(${JSON.stringify(snapBase64)})) || {}
const __subs = new Map()
const __notify = (ev) => {
  __snap[ev.topic] = ev.data
  const set = __subs.get(ev.topic)
  if (set) for (const cb of set) try { cb(ev) } catch (_) {}
}
__ch.onmessage = (e) => {
  const ev = e.data
  if (!ev || typeof ev.topic !== 'string' || ev.src === __id) return
  __notify(ev)
}
window.bus = {
  send(topic, data) {
    const ev = { topic, data, ts: Date.now(), src: __id }
    __notify(ev)
    __ch.postMessage(ev)
  },
  on(topic, cb) {
    let set = __subs.get(topic)
    if (!set) { set = new Set(); __subs.set(topic, set) }
    set.add(cb)
    return () => __subs.get(topic)?.delete(cb)
  },
  last(topic) { return __snap[topic] },
  use(topic) {
    const [v, setV] = __React.useState(__snap[topic])
    __React.useEffect(() => window.bus.on(topic, (e) => setV(e.data)), [topic])
    return v
  },
}

window.addEventListener('error', e => {
  const pre = document.createElement('pre')
  pre.className = '__err'
  pre.textContent = String(e.error && e.error.stack ? e.error.stack : (e.message || e.error))
  document.body.insertBefore(pre, document.getElementById('root'))
})
window.addEventListener('unhandledrejection', e => {
  const pre = document.createElement('pre')
  pre.className = '__err'
  pre.textContent = String(e.reason && e.reason.stack ? e.reason.stack : e.reason)
  document.body.insertBefore(pre, document.getElementById('root'))
})

// User code at module top level — its own \`import\` statements stay valid.
${compiled}

// Mount after user code has executed (top-level await in user code is awaited).
const __mount = document.getElementById('root')
try {
  if (typeof App === 'function') {
    __createRoot(__mount).render(__React.createElement(App))
  } else {
    __mount.textContent = 'Define a function called App. Example: function App() { return <h1>hi</h1> }'
    __mount.style.color = '#888'
    __mount.style.fontSize = '12px'
  }
} catch (err) {
  const pre = document.createElement('pre')
  pre.className = '__err'
  pre.textContent = String(err && err.stack ? err.stack : err)
  document.body.insertBefore(pre, document.getElementById('root'))
}
</script>
</body>
</html>`
}

export function JsxOutput({ compiledCode, error, height = 320 }: Props) {
  const srcDoc = useMemo(() => {
    const snapBytes = bus.snapshotBytes()
    if (error && !compiledCode) {
      return buildSrcDoc('', error, snapBytes)
    }
    return buildSrcDoc(compiledCode ?? '', null, snapBytes)
  }, [compiledCode, error])

  return (
    <iframe
      title="jsx preview"
      sandbox="allow-scripts allow-same-origin"
      srcDoc={srcDoc}
      style={{
        width: '100%',
        height,
        border: 0,
        display: 'block',
        background: '#1c1c1c',
      }}
    />
  )
}
