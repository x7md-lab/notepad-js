import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal, useTerminal } from '@wterm/react'
import { CodeEditor } from './CodeEditor'
import { kernel, type Sink } from './kernel'
import { CELL_TYPES, type CellType } from './cellType'
import { runSql } from './sqlRunner'
import { compileJsx } from './jsx'
import { JsxOutput } from './JsxOutput'
import { bus } from './bus'
import { parsePolymath, type Block } from './polymath'
import {
  stringify as serialize,
  parse as deserialize,
  REVIVER_SOURCE,
  REPLACER_SOURCE,
} from './serialize'
import { vfs } from './vfs'

const BUS_MARKER = '__BUS:'
const FS_MARKER = '__FS:'

/** Base64-encode each VFS file once; injected as a constant table into the wrap. */
function vfsToBase64Map(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, bytes] of vfs.entries()) {
    let s = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, i + chunk)),
      )
    }
    out[path] = btoa(s)
  }
  return out
}

/** Wrap a JS block so it sees `bus` and `fs` shims and forwards mutations
 *  via stdout markers. Body is INSIDE the IIFE so `let`/`const` are
 *  function-scoped — re-runs don't trip QuickJS const-redeclaration. */
function wrapJsForBus(body: string, snapshot: Record<string, unknown>): string {
  const snapJson = serialize(snapshot)
  const files = vfsToBase64Map()
  return `(function () {
  const __reviver = ${REVIVER_SOURCE};
  const __replacer = ${REPLACER_SOURCE};
  const __snap = JSON.parse(${JSON.stringify(snapJson)}, __reviver);
  globalThis.bus = {
    send(topic, data) {
      try {
        console.log(${JSON.stringify(BUS_MARKER)} + JSON.stringify({ topic, data }, __replacer))
      } catch (e) {
        console.error('bus.send serialize failed:', e && e.message || e)
      }
    },
    last(topic) { return __snap[topic] },
    on() { return function () {} },
  };

  // ---- fs shim ----
  const __files = ${JSON.stringify(files)};
  function __b64Decode(s) {
    const bin = atob(s);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function __b64Encode(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(s);
  }
  // QuickJS doesn't ship TextEncoder/Decoder — fall back to a tiny UTF-8 codec.
  function __utf8Encode(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const c2 = s.charCodeAt(i + 1);
        const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        i++;
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return new Uint8Array(out);
  }
  function __utf8Decode(bytes) {
    let s = '';
    let i = 0;
    while (i < bytes.length) {
      const c = bytes[i++];
      if (c < 0x80) {
        s += String.fromCharCode(c);
      } else if (c < 0xe0) {
        s += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
      } else if (c < 0xf0) {
        s += String.fromCharCode(
          ((c & 0xf) << 12) |
            ((bytes[i++] & 0x3f) << 6) |
            (bytes[i++] & 0x3f),
        );
      } else {
        const cp =
          ((c & 0x7) << 18) |
          ((bytes[i++] & 0x3f) << 12) |
          ((bytes[i++] & 0x3f) << 6) |
          (bytes[i++] & 0x3f);
        const u = cp - 0x10000;
        s += String.fromCharCode(0xd800 + (u >> 10));
        s += String.fromCharCode(0xdc00 + (u & 0x3ff));
      }
    }
    return s;
  }
  const __TE = typeof TextEncoder !== 'undefined' ? new TextEncoder() : { encode: __utf8Encode };
  const __TD = typeof TextDecoder !== 'undefined' ? new TextDecoder() : { decode: __utf8Decode };
  function __emitWrite(path, bytes) {
    console.log(${JSON.stringify(FS_MARKER)} + JSON.stringify({ path, b64: __b64Encode(bytes) }));
  }
  function __toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return __TE.encode(data);
    return __TE.encode(String(data));
  }
  globalThis.fs = {
    list() { return Object.keys(__files).sort(); },
    has(path) { return Object.prototype.hasOwnProperty.call(__files, path); },
    readBytes(path) {
      const b = __files[path];
      return b === undefined ? undefined : __b64Decode(b);
    },
    readText(path) {
      const bytes = this.readBytes(path);
      return bytes === undefined ? undefined : __TD.decode(bytes);
    },
    writeBytes(path, data) {
      const bytes = __toBytes(data);
      __files[path] = __b64Encode(bytes);
      __emitWrite(path, bytes);
    },
    writeText(path, content) {
      this.writeBytes(path, __TE.encode(String(content)));
    },
  };

  // ---- user block body ----
${body}
})();`
}

export interface CellData {
  id: string
  code: string
  type: CellType
  executionCount: number | null
  status: 'idle' | 'running' | 'ok' | 'error'
  durationMs?: number
  errorMessage?: string
  /** Whether the output terminal has ever been mounted */
  hasOutput: boolean
}

interface Props {
  cell: CellData
  onChange: (patch: Partial<CellData>) => void
  onDelete: () => void
  onAddBelow: () => void
  canDelete: boolean
  registerRunner?: (id: string, fn: () => Promise<void>) => () => void
}

/** Buffers writes until the terminal is ready, then flushes. Also tracks line count. */
class TermSink {
  private buf: string[] = []
  private write: ((s: string) => void) | null = null
  lineCount = 0
  onLineCountChange: ((n: number) => void) | null = null

  attach(write: (s: string) => void) {
    this.write = write
    if (this.buf.length) {
      for (const s of this.buf) write(s)
      this.buf.length = 0
    }
  }

  detach() {
    this.write = null
  }

  push(s: string) {
    const newlines = (s.match(/\r?\n/g) || []).length
    if (newlines > 0) {
      this.lineCount += newlines
      this.onLineCountChange?.(this.lineCount)
    }
    if (this.write) this.write(s)
    else this.buf.push(s)
  }

  reset() {
    this.buf.length = 0
    this.lineCount = 0
    this.onLineCountChange?.(0)
    this.write?.('\x1b[2J\x1b[H')
  }
}

const MIN_ROWS = 3
const MAX_ROWS = 24

/** wterm cols clamped to viewport so output doesn't horizontally bleed. */
function colsForViewport(): number {
  if (typeof window === 'undefined') return 100
  const w = window.innerWidth
  if (w < 380) return 38
  if (w < 640) return 52
  if (w < 1024) return 90
  return 120
}

function useViewportCols(): number {
  const [cols, setCols] = useState(colsForViewport)
  useEffect(() => {
    const handler = () => setCols(colsForViewport())
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return cols
}

const lf = (s: string) => s.replace(/\n/g, '\r\n')

export function Cell({
  cell,
  onChange,
  onDelete,
  onAddBelow,
  canDelete,
  registerRunner,
}: Props) {
  const { ref, write } = useTerminal()
  const sinkRef = useRef<TermSink>(null as unknown as TermSink)
  if (!sinkRef.current) sinkRef.current = new TermSink()
  const writeRef = useRef(write)
  writeRef.current = write

  const [termReady, setTermReady] = useState(false)
  const [lineCount, setLineCount] = useState(0)
  const [jsxCompiled, setJsxCompiled] = useState<string | null>(null)
  const [jsxError, setJsxError] = useState<string | null>(null)

  useEffect(() => {
    sinkRef.current.onLineCountChange = setLineCount
    return () => {
      sinkRef.current.onLineCountChange = null
    }
  }, [])

  useEffect(() => {
    if (!cell.hasOutput || !termReady) return
    sinkRef.current.attach((s) => writeRef.current(s))
    return () => sinkRef.current.detach()
  }, [cell.hasOutput, termReady])

  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, lineCount))
  const cols = useViewportCols()

  const cellType: CellType = cell.type

  const run = useCallback(async () => {
    if (!cell.code.trim()) return
    onChange({ status: 'running', hasOutput: true })

    // Let the terminal mount if this is the first run
    await new Promise<void>((r) => requestAnimationFrame(() => r()))

    sinkRef.current.reset()

    const push = (s: string) => sinkRef.current.push(lf(s) + '\r\n')
    const stdout: Sink = (line) => push(line)
    const stderr: Sink = (line) =>
      sinkRef.current.push('\x1b[31m' + lf(line) + '\x1b[0m\r\n')

    /** stdout that intercepts __BUS: and __FS: markers from the JS shim. */
    const busStdout: Sink = (line) => {
      if (line.startsWith(BUS_MARKER)) {
        try {
          const { topic, data } = deserialize<{ topic: string; data: unknown }>(
            line.slice(BUS_MARKER.length),
          )
          if (typeof topic === 'string') {
            bus.send(topic, data)
            push(`\x1b[2m· bus.send('${topic}')\x1b[0m`)
            return
          }
        } catch {
          /* fall through to normal print */
        }
      }
      if (line.startsWith(FS_MARKER)) {
        try {
          const { path, b64 } = JSON.parse(line.slice(FS_MARKER.length)) as {
            path: string
            b64: string
          }
          if (typeof path === 'string' && typeof b64 === 'string') {
            const bin = atob(b64)
            const bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
            vfs.write(path, bytes)
            push(`\x1b[2m· fs.write('${path}', <${bytes.length} bytes>)\x1b[0m`)
            return
          }
        } catch {
          /* fall through */
        }
      }
      push(line)
    }

    const runBlock = async (block: Block, idx: number, total: number) => {
      const head = `\x1b[36m── [${idx + 1}/${total}] ${block.lang}${block.name ? ' ' + block.name : ''} ──\x1b[0m`
      sinkRef.current.push(head + '\r\n')

      if (block.lang === 'sql') {
        const res = await runSql(block.body)
        sinkRef.current.push(lf(res.text) + '\r\n')
        sinkRef.current.push(
          `\x1b[2m${res.rowCount} row${res.rowCount === 1 ? '' : 's'} · ${res.columnCount} col${res.columnCount === 1 ? '' : 's'}\x1b[0m\r\n`,
        )
        const topic = block.name ?? 'data'
        bus.send(topic, res.rows)
        push(`\x1b[2m· bus.send('${topic}', <${res.rowCount} rows>)\x1b[0m`)
      } else if (block.lang === 'js') {
        const wrapped = wrapJsForBus(block.body, bus.snapshot())
        const { result } = await kernel.runCell(wrapped, {
          stdout: busStdout,
          stderr,
        })
        if (result.status === 'error') {
          throw new Error(result.error ?? 'js block failed')
        }
      } else if (block.lang === 'jsx') {
        const compiled = await compileJsx(block.body)
        setJsxCompiled(compiled)
        setJsxError(null)
        push(`\x1b[2m· JSX compiled (${compiled.length} bytes) — rendering in iframe below\x1b[0m`)
      }
    }

    const type = cellType
    const body = cell.code
    const start = performance.now()
    try {
      if (type === 'polymath') {
        const blocks = parsePolymath(body)
        if (blocks.length === 0) {
          push('\x1b[33m(no blocks — add ### sql / ### js / ### jsx headers)\x1b[0m')
        }
        setJsxCompiled(null)
        for (let i = 0; i < blocks.length; i++) {
          await runBlock(blocks[i], i, blocks.length)
        }
        onChange({
          executionCount: kernel.bumpExecutionCount(),
          status: 'ok',
          durationMs: performance.now() - start,
          errorMessage: undefined,
        })
      } else if (type === 'sql') {
        const res = await runSql(body)
        sinkRef.current.push(lf(res.text) + '\r\n')
        sinkRef.current.push(
          `\x1b[2m${res.rowCount} row${res.rowCount === 1 ? '' : 's'} · ${res.columnCount} col${res.columnCount === 1 ? '' : 's'}\x1b[0m\r\n`,
        )
        onChange({
          executionCount: kernel.bumpExecutionCount(),
          status: 'ok',
          durationMs: performance.now() - start,
          errorMessage: undefined,
        })
      } else if (type === 'jsx') {
        setJsxError(null)
        try {
          const compiled = await compileJsx(body)
          setJsxCompiled(compiled)
          onChange({
            executionCount: kernel.bumpExecutionCount(),
            status: 'ok',
            durationMs: performance.now() - start,
            errorMessage: undefined,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setJsxCompiled(null)
          setJsxError(msg)
          onChange({
            executionCount: kernel.bumpExecutionCount(),
            status: 'error',
            durationMs: performance.now() - start,
            errorMessage: msg,
          })
        }
      } else {
        const { count, result } = await kernel.runCell(body, { stdout, stderr })
        onChange({
          executionCount: count,
          status: result.status,
          durationMs: result.durationMs,
          errorMessage: result.error,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sinkRef.current.push('\x1b[31m' + msg + '\x1b[0m\r\n')
      onChange({
        status: 'error',
        durationMs: performance.now() - start,
        errorMessage: msg,
      })
    }
  }, [cell.code, cellType, onChange])

  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!registerRunner) return
    return registerRunner(cell.id, () => runRef.current())
  }, [cell.id, registerRunner])

  const typeLabel: Record<CellType, string> = {
    js: '',
    sql: ' sql',
    jsx: ' jsx',
    polymath: ' poly',
  }

  const inLabel = useMemo(() => {
    const t = typeLabel[cellType]
    if (cell.status === 'running') return `In${t} [*]:`
    if (cell.executionCount == null) return `In${t} [ ]:`
    return `In${t} [${cell.executionCount}]:`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.executionCount, cell.status, cellType])

  const outLabel = useMemo(() => {
    if (cell.status === 'running') return 'Out[*]:'
    if (cell.status === 'error') return 'Err[*]:'
    if (cell.executionCount == null) return 'Out[ ]:'
    return `Out[${cell.executionCount}]:`
  }, [cell.executionCount, cell.status])

  const isRunning = cell.status === 'running'

  return (
    <article className={`cell status-${cell.status}`}>
      <div className="cell-side">
        <button
          className="run-circle"
          onClick={run}
          disabled={isRunning}
          aria-label="Run cell"
          title="Run cell (Shift-Enter)"
        >
          {isRunning ? (
            <span className="spinner" aria-hidden />
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M4.5 3.5v9l8-4.5-8-4.5z" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>

      <div className="cell-body">
        <div className="cell-section cell-input-section">
          <div className="io-label in-label">
            <span>{inLabel}</span>
            <select
              className="type-select"
              value={cellType}
              onChange={(e) =>
                onChange({ type: e.target.value as CellType })
              }
              aria-label="Cell type"
              title="Cell type"
            >
              {CELL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'js' ? 'js' : t}
                </option>
              ))}
            </select>
            {cell.status === 'ok' && cell.durationMs != null && (
              <span className="duration">
                {Math.round(cell.durationMs)} ms
              </span>
            )}
            {cell.status === 'error' && (
              <span className="err-tag">error</span>
            )}
            <div className="row-actions">
              <button onClick={onAddBelow} title="Add cell below" aria-label="Add cell below">
                +
              </button>
              <button
                onClick={onDelete}
                title="Delete cell"
                aria-label="Delete cell"
                disabled={!canDelete}
              >
                ×
              </button>
            </div>
          </div>

          <div className="cell-input">
            <CodeEditor
              value={cell.code}
              onChange={(code) => onChange({ code })}
              onRun={run}
              language={cellType}
              tsPath={`cell-${cell.id}.${cellType === 'jsx' ? 'tsx' : 'ts'}`}
            />
          </div>
        </div>

        {cell.hasOutput && (
          <div className="cell-section cell-output-section">
            <div className="io-label out-label">{outLabel}</div>
            {cellType === 'jsx' ? (
              <div className="cell-output">
                <JsxOutput compiledCode={jsxCompiled} error={jsxError} />
              </div>
            ) : (
              <>
                <div className="cell-output">
                  <Terminal
                    ref={ref}
                    cols={cols}
                    rows={rows}
                    theme="monokai"
                    onReady={() => setTermReady(true)}
                    style={{
                      borderRadius: 0,
                      boxShadow: 'none',
                      padding: '6px 10px',
                      background: 'transparent',
                    }}
                  />
                </div>
                {cellType === 'polymath' && jsxCompiled && (
                  <div className="cell-output" style={{ marginTop: 8 }}>
                    <JsxOutput
                      compiledCode={jsxCompiled}
                      error={jsxError}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
