import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Cell, type CellData } from './Cell'
import { kernel } from './kernel'
import { warmupJsx } from './jsx'
import { warmupDuckDB } from './duckdb'
import type { CellType } from './cellType'

interface StarterCell {
  type: CellType
  code: string
}

const STARTERS: StarterCell[] = [
  {
    type: 'js',
    code: `// Welcome to js-terminal. Press Shift-Enter to run.\nvar greet = (name) => \`Hello, \${name}!\`\nconsole.log(greet('world'))`,
  },
  {
    type: 'js',
    code: `// var + function persist across cells. Use globalThis.x for let/const.\nvar n = 5\nfor (let i = 0; i < n; i++) console.log(i, i * i)`,
  },
  {
    type: 'sql',
    code: `-- DuckDB query.\nSELECT\n  i AS n,\n  i * i AS sq,\n  CASE WHEN i % 2 = 0 THEN 'even' ELSE 'odd' END AS parity\nFROM range(1, 6) t(i)`,
  },
  {
    type: 'jsx',
    code: `// JSX cell — SWC-compiled, rendered in a sandboxed iframe.\nimport { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts'\n\nfunction App() {\n  const rows = bus.use('series') ?? [\n    { x: 1, y: 1 }, { x: 2, y: 4 }, { x: 3, y: 9 }, { x: 4, y: 16 },\n  ]\n  return (\n    <ResponsiveContainer width="100%" height={260}>\n      <LineChart data={rows}>\n        <XAxis dataKey="x" />\n        <YAxis />\n        <Line type="monotone" dataKey="y" stroke="#7c5cff" />\n      </LineChart>\n    </ResponsiveContainer>\n  )\n}`,
  },
  {
    type: 'polymath',
    code:
      'Fenced blocks below are language-tagged. Each block runs in order.\n' +
      '\n' +
      '```sql data\n' +
      'SELECT i AS x, i * i AS y FROM range(1, 9) t(i)\n' +
      '```\n' +
      '\n' +
      '```js logic\n' +
      "const rows = bus.last('data')\n" +
      'const total = rows.reduce((s, r) => s + r.y, 0)\n' +
      "console.log('sum of y:', total)\n" +
      "bus.send('series', rows)\n" +
      '```\n' +
      '\n' +
      '```jsx view\n' +
      "import { BarChart, Bar, XAxis, YAxis } from 'recharts'\n" +
      'function App() {\n' +
      "  const data = bus.use('series') ?? []\n" +
      '  return (\n' +
      '    <div style={{ padding: 8 }}>\n' +
      '      <BarChart width={420} height={220} data={data}>\n' +
      '        <XAxis dataKey="x" />\n' +
      '        <YAxis />\n' +
      '        <Bar dataKey="y" fill="#689af2" />\n' +
      '      </BarChart>\n' +
      '    </div>\n' +
      '  )\n' +
      '}\n' +
      '```',
  },
  {
    type: 'polymath',
    code:
      'End-to-end pipeline: JS writes CSV to VFS, DuckDB queries it, recharts plots the result.\n' +
      '\n' +
      '```js seed\n' +
      "// Synthesize seven days of orders and drop into the shared VFS as a CSV.\n" +
      "const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']\n" +
      'function rev(i) { return Math.round(120 + Math.sin(i) * 40 + i * 12) }\n' +
      "let csv = 'n,day,revenue,orders\\n'\n" +
      'for (let i = 0; i < days.length; i++) {\n' +
      "  csv += i + ',' + days[i] + ',' + rev(i) + ',' + (5 + i * 2) + '\\n'\n" +
      '}\n' +
      "fs.writeText('sales.csv', csv)\n" +
      "console.log('wrote sales.csv (' + csv.length + ' bytes)')\n" +
      "console.log(fs.list())\n" +
      '```\n' +
      '\n' +
      "```sql aggregate\n" +
      "-- Read the CSV JS just wrote; carry the row index for ordering.\n" +
      'SELECT\n' +
      '  day,\n' +
      '  revenue,\n' +
      '  orders,\n' +
      '  SUM(revenue) OVER (ORDER BY n) AS cumulative\n' +
      "FROM read_csv('sales.csv', header=true)\n" +
      'ORDER BY n\n' +
      '```\n' +
      '\n' +
      '```js bridge\n' +
      "// Reshape the SQL result and publish for the JSX block.\n" +
      "const rows = bus.last('aggregate')\n" +
      'const total = rows.reduce((s, r) => s + r.revenue, 0)\n' +
      "console.log('total revenue:', total)\n" +
      "bus.send('chart', rows)\n" +
      '```\n' +
      '\n' +
      '```jsx view\n' +
      "import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'\n" +
      'function App() {\n' +
      "  const rows = bus.use('chart') ?? []\n" +
      '  return (\n' +
      "    <div style={{ padding: 8, fontFamily: 'system-ui' }}>\n" +
      "      <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#9e9e9e' }}>Daily revenue (bars) + cumulative (line)</h3>\n" +
      '      <ResponsiveContainer width="100%" height={240}>\n' +
      '        <ComposedChart data={rows}>\n' +
      '          <CartesianGrid stroke="#333" strokeDasharray="3 3" />\n' +
      '          <XAxis dataKey="day" stroke="#aaa" />\n' +
      '          <YAxis stroke="#aaa" />\n' +
      '          <Tooltip contentStyle={{ background: \'#222\', border: \'1px solid #444\' }} />\n' +
      '          <Bar dataKey="revenue" fill="#689af2" />\n' +
      '          <Line type="monotone" dataKey="cumulative" stroke="#c47cd6" strokeWidth={2} dot={false} />\n' +
      '        </ComposedChart>\n' +
      '      </ResponsiveContainer>\n' +
      '    </div>\n' +
      '  )\n' +
      '}\n' +
      '```',
  },
]

let idSeq = 0
const newId = () => `c${++idSeq}`
const makeCell = (
  code = '',
  type: CellType = 'js',
): CellData => ({
  id: newId(),
  code,
  type,
  executionCount: null,
  status: 'idle',
  hasOutput: false,
})

function useKernelStatus() {
  return useSyncExternalStore(
    (cb) => kernel.subscribe(cb),
    () => kernel.getStatus(),
    () => 'idle' as const,
  )
}

export function Notebook() {
  const [cells, setCells] = useState<CellData[]>(() =>
    STARTERS.map((s) => makeCell(s.code, s.type)),
  )
  const status = useKernelStatus()

  // Pre-warm the wasms in the background so first-run latency drops to ~0.
  // Always warm the QuickJS kernel; only warm DuckDB/SWC if the notebook
  // actually has cells that need them (polymath may have any block type).
  useEffect(() => {
    kernel.warmup().catch((err) => {
      console.warn('kernel warmup failed', err)
    })
    const needsDuckDB = cells.some(
      (c) => c.type === 'sql' || c.type === 'polymath',
    )
    const needsSwc = cells.some(
      (c) => c.type === 'jsx' || c.type === 'polymath',
    )
    if (needsDuckDB) {
      warmupDuckDB().catch((err) => {
        console.warn('duckdb warmup failed', err)
      })
    }
    if (needsSwc) {
      warmupJsx().catch((err) => {
        console.warn('swc warmup failed', err)
      })
    }
    // Only on mount — adding new cells doesn't retroactively trigger warmup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateCell = useCallback((id: string, patch: Partial<CellData>) => {
    setCells((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const addCell = useCallback((afterId?: string) => {
    setCells((cs) => {
      const fresh = makeCell()
      if (!afterId) return [...cs, fresh]
      const idx = cs.findIndex((c) => c.id === afterId)
      if (idx < 0) return [...cs, fresh]
      return [...cs.slice(0, idx + 1), fresh, ...cs.slice(idx + 1)]
    })
  }, [])

  const deleteCell = useCallback((id: string) => {
    setCells((cs) => (cs.length <= 1 ? cs : cs.filter((c) => c.id !== id)))
  }, [])

  const runnersRef = useRef(new Map<string, () => Promise<void>>())
  const registerRunner = useCallback(
    (id: string, fn: () => Promise<void>) => {
      runnersRef.current.set(id, fn)
      return () => {
        runnersRef.current.delete(id)
      }
    },
    [],
  )

  const cellsRef = useRef(cells)
  cellsRef.current = cells

  const runAll = useCallback(async () => {
    for (const c of cellsRef.current) {
      const fn = runnersRef.current.get(c.id)
      if (fn) await fn()
    }
  }, [])

  const restart = useCallback(async () => {
    await kernel.restart()
    setCells((cs) =>
      cs.map((c) => ({
        ...c,
        executionCount: null,
        status: 'idle',
        durationMs: undefined,
        errorMessage: undefined,
      })),
    )
  }, [])

  useEffect(() => {
    return () => {
      void kernel.restart()
    }
  }, [])

  return (
    <div className="notebook">
      <header className="toolbar">
        <div className="brand">
          <span className="logo-dot" />
          <span>js-terminal</span>
          <span className="brand-sep">·</span>
          <span className="brand-sub">QuickJS notebook</span>
        </div>
        <div className="toolbar-status">
          <span className={`dot status-${status}`} />
          <span className="status-label">{status}</span>
        </div>
        <div className="toolbar-actions">
          <button onClick={() => addCell()} title="Add cell at end">
            <span className="tb-icon">+</span>
            <span className="tb-label">Cell</span>
          </button>
          <button onClick={runAll} title="Run all cells top to bottom">
            <span className="tb-icon play">▶</span>
            <span className="tb-label">Run all</span>
          </button>
          <button
            onClick={restart}
            title="Destroy and re-create kernel"
            className="ghost"
          >
            <span className="tb-icon">⟳</span>
            <span className="tb-label">Restart</span>
          </button>
        </div>
      </header>

      <main className="cells">
        {cells.map((c) => (
          <Cell
            key={c.id}
            cell={c}
            onChange={(patch) => updateCell(c.id, patch)}
            onDelete={() => deleteCell(c.id)}
            onAddBelow={() => addCell(c.id)}
            canDelete={cells.length > 1}
            registerRunner={registerRunner}
          />
        ))}
      </main>

      <footer className="notebook-footer">
        <span>
          Shift-Enter / ⌘Enter to run · cells share kernel state
        </span>
      </footer>
    </div>
  )
}
