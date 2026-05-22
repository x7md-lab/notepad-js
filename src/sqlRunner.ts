import { getConnection, getDuckDB } from './duckdb'
import { vfs } from './vfs'

export interface SqlResult {
  text: string
  rowCount: number
  columnCount: number
  columns: string[]
  rows: Array<Record<string, unknown>>
}

const TRUNC = 30

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

function truncate(s: string, max = TRUNC): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

/** Render an Arrow result as a pretty text table with box-drawing borders. */
export function formatTable(
  cols: string[],
  rows: Array<Record<string, unknown>>,
): string {
  if (cols.length === 0) return '(no columns)'
  if (rows.length === 0) {
    return `(0 rows · columns: ${cols.join(', ')})`
  }

  const data = rows.map((r) => cols.map((c) => truncate(cellToString(r[c]))))
  const widths = cols.map((c, i) =>
    Math.max(c.length, ...data.map((r) => r[i].length)),
  )

  const horiz = (l: string, m: string, r: string) =>
    l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r
  const rowLine = (cells: string[]) =>
    '│ ' + cells.map((c, i) => c.padEnd(widths[i])).join(' │ ') + ' │'

  const lines: string[] = []
  lines.push(horiz('┌', '┬', '┐'))
  lines.push(rowLine(cols))
  lines.push(horiz('├', '┼', '┤'))
  for (const r of data) lines.push(rowLine(r))
  lines.push(horiz('└', '┴', '┘'))
  return lines.join('\n')
}

const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER)
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/** Coerce BigInt values within ±2^53 to Number so user arithmetic doesn't
 *  trip "Cannot mix BigInt and other types". Larger BigInts pass through. */
function softenBigInt(v: unknown): unknown {
  if (typeof v === 'bigint') {
    if (v >= MIN_SAFE && v <= MAX_SAFE) return Number(v)
    return v
  }
  return v
}

/** Mirror the host VFS into DuckDB so SQL can read shared files by name. */
async function syncVfsToDuckDB(): Promise<void> {
  const db = await getDuckDB()
  for (const [path, bytes] of vfs.entries()) {
    try {
      await db.registerFileBuffer(path, bytes)
    } catch {
      /* file already registered with same contents — ignore */
    }
  }
}

export async function runSql(sql: string): Promise<SqlResult> {
  const conn = await getConnection()
  await syncVfsToDuckDB()
  const result = await conn.query(sql)

  const cols = result.schema.fields.map((f) => f.name)
  const rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < result.numRows; i++) {
    const row = result.get(i)
    if (!row) continue
    const raw = row.toJSON() as Record<string, unknown>
    const cleaned: Record<string, unknown> = {}
    for (const k of Object.keys(raw)) cleaned[k] = softenBigInt(raw[k])
    rows.push(cleaned)
  }

  const text = formatTable(cols, rows)
  return {
    text,
    rowCount: result.numRows,
    columnCount: cols.length,
    columns: cols,
    rows,
  }
}
