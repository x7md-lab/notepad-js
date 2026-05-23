/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import initSwc, { transform } from '@swc/wasm-web'

let initPromise: Promise<unknown> | null = null

const api = {
  async compile(code: string): Promise<string> {
    if (!initPromise) initPromise = initSwc()
    await initPromise
    const out = await transform(code, {
      filename: 'cell.jsx',
      jsc: {
        parser: { syntax: 'ecmascript', jsx: true },
        transform: { react: { runtime: 'automatic' } },
        target: 'es2022',
      },
      isModule: true,
      module: { type: 'es6' },
    })
    return out.code
  },
}

export type JsxWorkerApi = typeof api

Comlink.expose(api)
