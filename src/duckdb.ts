import * as duckdb from '@duckdb/duckdb-wasm'
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null
let conn: duckdb.AsyncDuckDBConnection | null = null

async function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    const bundle = await duckdb.selectBundle(BUNDLES)
    const worker = new Worker(bundle.mainWorker!, { type: 'module' })
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    return db
  })()
  return dbPromise
}

export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (conn) return conn
  const db = await getDb()
  conn = await db.connect()
  return conn
}

/** Get the underlying AsyncDuckDB instance (for file registration). */
export async function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  return getDb()
}

export async function resetDuckDB(): Promise<void> {
  try {
    await conn?.close()
  } catch {
    /* ignore */
  }
  conn = null
  try {
    const db = await dbPromise
    await db?.terminate()
  } catch {
    /* ignore */
  }
  dbPromise = null
}
