import JsxWorker from './jsxWorker?worker'

interface PendingMsg {
  resolve: (code: string) => void
  reject: (err: Error) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, PendingMsg>()

export type JsxStatus = 'idle' | 'loading' | 'ready' | 'error'
let status: JsxStatus = 'idle'
let firstReady: Promise<void> | null = null
let resolveFirstReady: (() => void) | null = null

export function getJsxStatus(): JsxStatus {
  return status
}

/** True after the first successful compile, i.e. SWC wasm is in memory. */
export function isJsxReady(): boolean {
  return status === 'ready'
}

function getWorker(): Worker {
  if (worker) return worker
  status = 'loading'
  firstReady = new Promise<void>((r) => {
    resolveFirstReady = r
  })
  worker = new JsxWorker()
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; code?: string; error?: string }>) => {
    const { id, ok, code, error } = e.data
    if (status !== 'ready' && ok) {
      status = 'ready'
      resolveFirstReady?.()
    }
    const slot = pending.get(id)
    if (!slot) return
    pending.delete(id)
    if (ok && typeof code === 'string') slot.resolve(code)
    else slot.reject(new Error(error ?? 'jsx compile failed'))
  }
  return worker
}

export function compileJsx(code: string): Promise<string> {
  const w = getWorker()
  const id = nextId++
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, code })
  })
}

void firstReady // exported via getter pattern; suppress unused warning
