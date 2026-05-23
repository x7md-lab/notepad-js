import * as Comlink from 'comlink'
import KernelWorker from './kernelWorker?worker'
import type { KernelWorkerApi, RunResult } from './kernelWorker'

export type Sink = (line: string) => void

export interface CellSinks {
  stdout: Sink
  stderr: Sink
}

export type KernelStatus = 'idle' | 'loading' | 'ready' | 'error' | 'busy'

type Listener = (status: KernelStatus) => void

/**
 * Main-thread proxy for the QuickJS kernel that runs in a Web Worker.
 * - Streams stdout/stderr via Comlink.proxy callbacks (one postMessage per line)
 * - Execution counter lives here so JS / SQL / JSX cells share one sequence
 * - restart() terminates the worker; next run spawns a fresh one
 */
class Kernel {
  private worker: Worker | null = null
  private api: Comlink.Remote<KernelWorkerApi> | null = null
  private initPromise: Promise<void> | null = null

  private status: KernelStatus = 'idle'
  private listeners = new Set<Listener>()
  private chain: Promise<unknown> = Promise.resolve()
  private executionCount = 0

  getStatus(): KernelStatus {
    return this.status
  }

  /** Fire-and-forget warmup: kicks off the wasm load + stdlib eval so the
   *  first user-triggered run doesn't pay the cold-load cost. Safe to call
   *  multiple times; subsequent calls return the cached init promise. */
  warmup(): Promise<void> {
    return this.ensure()
  }

  bumpExecutionCount(): number {
    return ++this.executionCount
  }

  peekExecutionCount(): number {
    return this.executionCount
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private setStatus(next: KernelStatus): void {
    if (this.status === next) return
    this.status = next
    for (const l of this.listeners) l(next)
  }

  private getApi(): Comlink.Remote<KernelWorkerApi> {
    if (!this.api) {
      this.worker = new KernelWorker()
      this.api = Comlink.wrap<KernelWorkerApi>(this.worker)
    }
    return this.api
  }

  private async ensure(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.setStatus('loading')
    const a = this.getApi()
    this.initPromise = a
      .init()
      .then(() => {
        this.setStatus('ready')
      })
      .catch((err) => {
        this.setStatus('error')
        this.initPromise = null
        throw err
      })
    return this.initPromise
  }

  runCell(
    code: string,
    sinks: CellSinks,
  ): Promise<{ count: number; result: RunResult }> {
    const job = async () => {
      await this.ensure()
      const count = ++this.executionCount
      this.setStatus('busy')
      const a = this.getApi()
      const stdoutProxy = Comlink.proxy(sinks.stdout)
      const stderrProxy = Comlink.proxy(sinks.stderr)
      try {
        const result = await a.run(
          code,
          `<cell-${count}>`,
          stdoutProxy,
          stderrProxy,
        )
        return { count, result }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        try {
          sinks.stderr(msg)
        } catch {
          /* ignore */
        }
        return {
          count,
          result: { status: 'error', durationMs: 0, error: msg } as RunResult,
        }
      } finally {
        this.setStatus('ready')
      }
    }

    const next = this.chain.then(job, job)
    this.chain = next.catch(() => {})
    return next
  }

  async restart(): Promise<void> {
    await this.chain.catch(() => {})
    if (this.worker) {
      try {
        this.worker.terminate()
      } catch {
        /* ignore */
      }
    }
    this.worker = null
    this.api = null
    this.initPromise = null
    this.executionCount = 0
    this.setStatus('idle')
  }
}

export const kernel = new Kernel()
