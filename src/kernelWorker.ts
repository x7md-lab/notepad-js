/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { loadQuickJS, type QuickJS } from 'quickjs-wasi-reactor'
import { QUICKJS_STDLIB_SOURCE } from './quickjsStdlib'

const WASM_URL = `${import.meta.env.BASE_URL}qjs-wasi.wasm`

let qjs: QuickJS | null = null
let loadingPromise: Promise<QuickJS> | null = null

// Per-run sink slots; replaced on each `run` call.
let activeStdout: ((line: string) => void) | null = null
let activeStderr: ((line: string) => void) | null = null

async function ensure(): Promise<QuickJS> {
  if (qjs) return qjs
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    const q = await loadQuickJS(WASM_URL, {
      stdout: (line) => activeStdout?.(line),
      stderr: (line) => activeStderr?.(line),
    })
    q.init(['qjs', '--std'])
    q.eval(QUICKJS_STDLIB_SOURCE, false, '<stdlib>')
    qjs = q
    return q
  })()
  try {
    return await loadingPromise
  } catch (err) {
    loadingPromise = null
    throw err
  }
}

export interface RunResult {
  status: 'ok' | 'error'
  durationMs: number
  error?: string
}

const api = {
  /** Force-boot the QuickJS instance + stdlib without running user code. */
  async init(): Promise<void> {
    await ensure()
  },

  /** Eval one cell. Sinks are Comlink-proxied callbacks from the main thread. */
  async run(
    code: string,
    filename: string,
    stdout: (line: string) => void,
    stderr: (line: string) => void,
  ): Promise<RunResult> {
    const q = await ensure()
    activeStdout = stdout
    activeStderr = stderr
    const start = performance.now()
    try {
      q.eval(code, false, filename)
      await q.runLoop()
      return { status: 'ok', durationMs: performance.now() - start }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try {
        stderr(msg)
      } catch {
        /* sink already torn down */
      }
      return {
        status: 'error',
        durationMs: performance.now() - start,
        error: msg,
      }
    } finally {
      activeStdout = null
      activeStderr = null
    }
  },

  /** Tear down the QuickJS instance. Worker stays alive; next `run` reboots. */
  async dispose(): Promise<void> {
    try {
      qjs?.destroy()
    } catch {
      /* best-effort */
    }
    qjs = null
    loadingPromise = null
  },
}

export type KernelWorkerApi = typeof api

Comlink.expose(api)
