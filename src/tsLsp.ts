import * as Comlink from 'comlink'
import type { WorkerShape } from '@valtown/codemirror-ts/worker'
import TsLspWorker from './tsLspWorker?worker'

let workerProxy: WorkerShape | null = null
let initPromise: Promise<WorkerShape> | null = null

export function getTsWorker(): Promise<WorkerShape> {
  if (workerProxy) return Promise.resolve(workerProxy)
  if (initPromise) return initPromise
  initPromise = (async () => {
    const w = new TsLspWorker()
    const proxy = Comlink.wrap<WorkerShape>(w)
    await proxy.initialize()
    workerProxy = proxy
    return proxy
  })()
  return initPromise
}
