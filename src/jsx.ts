import JsxWorker from './jsxWorker?worker'

interface PendingMsg {
  resolve: (code: string) => void
  reject: (err: Error) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, PendingMsg>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new JsxWorker()
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; code?: string; error?: string }>) => {
    const { id, ok, code, error } = e.data
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
