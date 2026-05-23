import * as Comlink from 'comlink'
import type { JsxWorkerApi } from './jsxWorker'
import JsxWorker from './jsxWorker?worker'

export type JsxStatus = 'idle' | 'loading' | 'ready' | 'error'

let worker: Worker | null = null
let api: Comlink.Remote<JsxWorkerApi> | null = null
let status: JsxStatus = 'idle'

export function getJsxStatus(): JsxStatus {
  return status
}

export function isJsxReady(): boolean {
  return status === 'ready'
}

function getApi(): Comlink.Remote<JsxWorkerApi> {
  if (api) return api
  status = 'loading'
  worker = new JsxWorker()
  api = Comlink.wrap<JsxWorkerApi>(worker)
  return api
}

export async function compileJsx(code: string): Promise<string> {
  const a = getApi()
  try {
    const out = await a.compile(code)
    status = 'ready'
    return out
  } catch (err) {
    if (status !== 'ready') status = 'error'
    throw err
  }
}

/** Pre-load the SWC wasm so the first JSX cell doesn't wait on cold start. */
export async function warmupJsx(): Promise<void> {
  const a = getApi()
  try {
    await a.warmup()
    status = 'ready'
  } catch (err) {
    if (status !== 'ready') status = 'error'
    throw err
  }
}
