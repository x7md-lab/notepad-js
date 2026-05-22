/// <reference lib="webworker" />
import initSwc, { transform } from '@swc/wasm-web'

let ready: Promise<unknown> | null = null

interface Req {
  id: number
  code: string
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, code } = e.data
  if (!ready) ready = initSwc()
  try {
    await ready
    const out = await transform(code, {
      filename: 'cell.jsx',
      jsc: {
        parser: { syntax: 'ecmascript', jsx: true },
        transform: { react: { runtime: 'automatic' } },
        target: 'es2022',
      },
      isModule: true,
      module: { type: 'es6' },
    })
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({
      id,
      ok: true,
      code: out.code,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({
      id,
      ok: false,
      error: msg,
    })
  }
}
