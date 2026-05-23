import { useEffect, useMemo, useRef, useState } from 'react'
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
  const compilerErrorBlock = error
    ? `<pre class="__err">${escapedError}</pre>`
    : ''
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
  .__err { color: #f28b82; white-space: pre-wrap; font: 12px ui-monospace,Menlo,Consolas,monospace; padding: 12px; margin: 0; background: rgba(242,139,130,0.08); border: 1px solid rgba(242,139,130,0.35); border-radius: 6px; }
  .__loader { color: #9e9e9e; font-size: 12px; padding: 14px 12px; display: flex; gap: 10px; align-items: center; }
  .__loader .__spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); border-top-color: #689af2; animation: __spin 0.7s linear infinite; }
  @keyframes __spin { to { transform: rotate(360deg); } }
  .__hint { color: #666; font-size: 11px; padding: 14px 12px; }
</style>
</head>
<body>
${compilerErrorBlock}
<div id="root">
  <div class="__loader" id="__bootLoader">
    <span class="__spin" aria-hidden="true"></span>
    <span>Loading sandbox: react, react-dom, recharts (esm.sh)…</span>
  </div>
</div>
<script type="module">
function __showError(msg) {
  const pre = document.createElement('pre')
  pre.className = '__err'
  pre.textContent = String(msg && msg.stack ? msg.stack : msg)
  const root = document.getElementById('root')
  if (root) root.innerHTML = ''
  document.body.insertBefore(pre, document.getElementById('root'))
}

window.addEventListener('error', e => __showError(e.error || e.message))
window.addEventListener('unhandledrejection', e => __showError(e.reason))

let __React, __createRoot, __cborDecode
try {
  __React = await import('react')
  ;({ createRoot: __createRoot } = await import('react-dom/client'))
  ;({ decode: __cborDecode } = await import('cbor-x'))
} catch (err) {
  __showError(new Error('Failed to load runtime modules from esm.sh: ' + (err && err.message || err)))
  throw err
}

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

// User code at module top level — its own \`import\` statements stay valid.
let __userOk = true
try {
${compiled}
} catch (err) {
  __userOk = false
  __showError(err)
}

if (__userOk) {
  const __mount = document.getElementById('root')
  try {
    if (typeof App === 'function') {
      __mount.innerHTML = ''
      __createRoot(__mount).render(__React.createElement(App))
    } else {
      __mount.innerHTML = '<div class="__hint">No App component defined. Try: <code>function App() { return &lt;h1&gt;hi&lt;/h1&gt; }</code></div>'
    }
  } catch (err) {
    __showError(err)
  }
}

// Tell the parent we're done booting.
try { parent.postMessage({ __jsxIframeReady: true }, '*') } catch (_) {}
</script>
</body>
</html>`
}

interface JsxIframeReadyMessage {
  __jsxIframeReady: boolean
}

export function JsxOutput({ compiledCode, error, height = 320 }: Props) {
  const srcDoc = useMemo(() => {
    const snapBytes = bus.snapshotBytes()
    if (error && !compiledCode) return buildSrcDoc('', error, snapBytes)
    return buildSrcDoc(compiledCode ?? '', null, snapBytes)
  }, [compiledCode, error])

  const [ready, setReady] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // Reset when srcDoc changes (re-run). The iframe will reload.
  useEffect(() => {
    setReady(false)
  }, [srcDoc])

  // Listen for the iframe's "ready" post-message — fires after user code has
  // mounted (or errored). More accurate than iframe.onLoad for module scripts.
  useEffect(() => {
    const handler = (e: MessageEvent<JsxIframeReadyMessage>) => {
      if (
        e.source === iframeRef.current?.contentWindow &&
        e.data &&
        e.data.__jsxIframeReady
      ) {
        setReady(true)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <div
      className="jsx-iframe-wrap"
      style={{ position: 'relative', minHeight: height }}
    >
      <iframe
        ref={iframeRef}
        title="jsx preview"
        sandbox="allow-scripts allow-same-origin"
        srcDoc={srcDoc}
        onLoad={() => {
          // Fallback: some browsers fire load before module scripts resolve.
          // The postMessage handler above is the primary readiness signal;
          // this guards against environments where postMessage is blocked.
          setTimeout(() => setReady((r) => r || false), 3000)
        }}
        style={{
          width: '100%',
          height,
          border: 0,
          display: 'block',
          background: '#1c1c1c',
        }}
      />
      {!ready && (
        <div
          className="jsx-iframe-overlay"
          aria-live="polite"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            padding: '14px 12px',
            background:
              'linear-gradient(180deg, rgba(28,28,28,0.85) 0%, rgba(28,28,28,0.55) 100%)',
            color: '#9e9e9e',
            fontSize: 12,
            gap: 10,
            pointerEvents: 'none',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.2)',
              borderTopColor: '#689af2',
              animation: 'spin 0.7s linear infinite',
              display: 'inline-block',
            }}
          />
          <span>Booting preview · fetching React + recharts (esm.sh)…</span>
        </div>
      )}
    </div>
  )
}
