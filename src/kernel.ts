import { loadQuickJS, type QuickJS } from 'quickjs-wasi-reactor'
import { QUICKJS_STDLIB_SOURCE } from './quickjsStdlib'

const WASM_URL = `${import.meta.env.BASE_URL}qjs-wasi.wasm`

export type Sink = (line: string) => void

export interface CellSinks {
  stdout: Sink
  stderr: Sink
}

export interface RunResult {
  status: 'ok' | 'error'
  durationMs: number
  error?: string
}

export type KernelStatus = 'idle' | 'loading' | 'ready' | 'error' | 'busy'

type Listener = (status: KernelStatus) => void

const noopSink: Sink = () => {}

class Kernel {
  private qjs: QuickJS | null = null
  private loadingPromise: Promise<QuickJS> | null = null
  private activeStdout: Sink = noopSink
  private activeStderr: Sink = noopSink
  private status: KernelStatus = 'idle'
  private listeners = new Set<Listener>()
  private chain: Promise<unknown> = Promise.resolve()
  private executionCount = 0

  getStatus(): KernelStatus {
    return this.status
  }

  /** Shared execution counter used by all runners (JS, SQL, JSX). */
  bumpExecutionCount(): number {
    this.executionCount += 1
    return this.executionCount
  }

  peekExecutionCount(): number {
    return this.executionCount
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private setStatus(next: KernelStatus) {
    if (this.status === next) return
    this.status = next
    for (const l of this.listeners) l(next)
  }

  private async ensureLoaded(): Promise<QuickJS> {
    if (this.qjs) return this.qjs
    if (this.loadingPromise) return this.loadingPromise

    this.setStatus('loading')
    this.loadingPromise = (async () => {
      const qjs = await loadQuickJS(WASM_URL, {
        stdout: (line) => this.activeStdout(line),
        stderr: (line) => this.activeStderr(line),
      })
      qjs.init(['qjs', '--std'])
      // Seed browser-shaped Web APIs (TextEncoder/Decoder, btoa/atob, crypto).
      // Pure JS polyfills, idempotent. Runs once per kernel lifetime.
      qjs.eval(QUICKJS_STDLIB_SOURCE, false, '<stdlib>')
      this.qjs = qjs
      this.setStatus('ready')
      return qjs
    })()
    try {
      return await this.loadingPromise
    } catch (err) {
      this.setStatus('error')
      this.loadingPromise = null
      throw err
    }
  }

  /** Serialized cell execution. Returns the execution counter assigned and run result. */
  runCell(code: string, sinks: CellSinks): Promise<{ count: number; result: RunResult }> {
    const job = async () => {
      const qjs = await this.ensureLoaded()
      this.executionCount += 1
      const count = this.executionCount
      this.setStatus('busy')
      this.activeStdout = sinks.stdout
      this.activeStderr = sinks.stderr

      const start = performance.now()
      let result: RunResult
      try {
        // Plain top-level eval so `var` / function decls persist as globals
        // across cells. `let` / `const` are block-scoped per eval per ES spec
        // — use `globalThis.x = ...` for cross-cell state.
        qjs.eval(code, false, `<cell-${count}>`)
        await qjs.runLoop()
        result = { status: 'ok', durationMs: performance.now() - start }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        sinks.stderr(msg)
        result = {
          status: 'error',
          durationMs: performance.now() - start,
          error: msg,
        }
      } finally {
        this.activeStdout = noopSink
        this.activeStderr = noopSink
        this.setStatus('ready')
      }
      return { count, result }
    }

    const next = this.chain.then(job, job)
    this.chain = next.catch(() => {})
    return next
  }

  async restart(): Promise<void> {
    await this.chain.catch(() => {})
    this.qjs?.destroy()
    this.qjs = null
    this.loadingPromise = null
    this.executionCount = 0
    this.setStatus('idle')
  }
}

export const kernel = new Kernel()
