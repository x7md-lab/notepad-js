/// <reference lib="webworker" />
import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualTypeScriptEnvironment,
} from '@typescript/vfs'
import ts from 'typescript'
import * as Comlink from 'comlink'
import { createWorker } from '@valtown/codemirror-ts/worker'

const TS_VERSION = '5.7.3'

/**
 * Minimal ambient declarations for cells. Gives autocomplete for:
 *   - React.useState / useEffect / etc and JSX intrinsic elements
 *   - ReactDOM.createRoot
 *   - console, fetch (already covered by DOM lib)
 *
 * Full @types/react is huge and brings transitive deps (csstype, prop-types);
 * this stub keeps autocomplete responsive without a multi-MB fetch.
 */
const GLOBALS_DTS = String.raw`
declare namespace React {
  type Key = string | number
  type ReactNode =
    | ReactNode[]
    | string
    | number
    | boolean
    | null
    | undefined
    | { type: any; props: any; key: Key | null }
  interface CSSProperties {
    [key: string]: string | number | undefined
  }
  interface HTMLAttributes<T> {
    children?: ReactNode
    className?: string
    id?: string
    style?: CSSProperties
    onClick?: (e: MouseEvent) => void
    onChange?: (e: Event) => void
    onInput?: (e: Event) => void
    onSubmit?: (e: Event) => void
    onMouseEnter?: (e: MouseEvent) => void
    onMouseLeave?: (e: MouseEvent) => void
    onKeyDown?: (e: KeyboardEvent) => void
    onKeyUp?: (e: KeyboardEvent) => void
    title?: string
    role?: string
    tabIndex?: number
    [key: string]: unknown
  }
  interface InputAttributes<T> extends HTMLAttributes<T> {
    value?: string | number | readonly string[]
    defaultValue?: string | number | readonly string[]
    type?: string
    placeholder?: string
    disabled?: boolean
    checked?: boolean
    name?: string
  }
  function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void]
  function useEffect(fn: () => void | (() => void), deps?: ReadonlyArray<unknown>): void
  function useLayoutEffect(fn: () => void | (() => void), deps?: ReadonlyArray<unknown>): void
  function useRef<T>(initial: T): { current: T }
  function useMemo<T>(fn: () => T, deps: ReadonlyArray<unknown>): T
  function useCallback<T extends (...args: any[]) => any>(fn: T, deps: ReadonlyArray<unknown>): T
  function useReducer<S, A>(reducer: (s: S, a: A) => S, init: S): [S, (a: A) => void]
  function useContext<T>(ctx: { __t: T }): T
  function createContext<T>(defaultValue: T): { __t: T; Provider: any; Consumer: any }
  function memo<T>(c: T): T
  function forwardRef<T, P>(fn: (props: P, ref: { current: T }) => any): any
  const Fragment: any
  const StrictMode: any
  function createElement(type: any, props?: any, ...children: any[]): any
  function cloneElement(el: any, props?: any, ...children: any[]): any
}

declare namespace JSX {
  interface IntrinsicElements {
    div: React.HTMLAttributes<HTMLDivElement>
    span: React.HTMLAttributes<HTMLSpanElement>
    p: React.HTMLAttributes<HTMLParagraphElement>
    h1: React.HTMLAttributes<HTMLHeadingElement>
    h2: React.HTMLAttributes<HTMLHeadingElement>
    h3: React.HTMLAttributes<HTMLHeadingElement>
    h4: React.HTMLAttributes<HTMLHeadingElement>
    button: React.InputAttributes<HTMLButtonElement>
    input: React.InputAttributes<HTMLInputElement>
    textarea: React.InputAttributes<HTMLTextAreaElement>
    select: React.InputAttributes<HTMLSelectElement>
    option: React.HTMLAttributes<HTMLOptionElement>
    label: React.HTMLAttributes<HTMLLabelElement>
    form: React.HTMLAttributes<HTMLFormElement>
    a: React.HTMLAttributes<HTMLAnchorElement> & { href?: string; target?: string }
    img: React.HTMLAttributes<HTMLImageElement> & { src?: string; alt?: string; width?: number | string; height?: number | string }
    ul: React.HTMLAttributes<HTMLUListElement>
    ol: React.HTMLAttributes<HTMLOListElement>
    li: React.HTMLAttributes<HTMLLIElement>
    table: React.HTMLAttributes<HTMLTableElement>
    thead: React.HTMLAttributes<HTMLTableSectionElement>
    tbody: React.HTMLAttributes<HTMLTableSectionElement>
    tr: React.HTMLAttributes<HTMLTableRowElement>
    th: React.HTMLAttributes<HTMLTableCellElement>
    td: React.HTMLAttributes<HTMLTableCellElement>
    pre: React.HTMLAttributes<HTMLPreElement>
    code: React.HTMLAttributes<HTMLElement>
    section: React.HTMLAttributes<HTMLElement>
    header: React.HTMLAttributes<HTMLElement>
    footer: React.HTMLAttributes<HTMLElement>
    nav: React.HTMLAttributes<HTMLElement>
    main: React.HTMLAttributes<HTMLElement>
    article: React.HTMLAttributes<HTMLElement>
    aside: React.HTMLAttributes<HTMLElement>
    canvas: React.HTMLAttributes<HTMLCanvasElement> & { width?: number; height?: number }
    svg: React.HTMLAttributes<SVGSVGElement> & { viewBox?: string; width?: number | string; height?: number | string }
    path: React.HTMLAttributes<SVGPathElement> & { d?: string; fill?: string; stroke?: string }
    [tag: string]: any
  }
  type Element = any
}

declare const ReactDOM: {
  createRoot(el: HTMLElement | null): {
    render(node: React.ReactNode): void
    unmount(): void
  }
}

declare module 'react' {
  export = React
}
declare module 'react-dom/client' {
  export function createRoot(el: HTMLElement | null): {
    render(node: React.ReactNode): void
    unmount(): void
  }
}
declare module 'react/jsx-runtime' {
  export function jsx(type: any, props: any, key?: any): any
  export function jsxs(type: any, props: any, key?: any): any
  export const Fragment: any
}
declare module 'recharts' {
  type Datum = Record<string, any>
  interface ChartProps {
    width?: number
    height?: number
    data?: Datum[]
    margin?: { top?: number; right?: number; bottom?: number; left?: number }
    children?: any
  }
  interface SeriesProps {
    dataKey?: string
    stroke?: string
    fill?: string
    type?: 'monotone' | 'linear' | 'step' | 'natural'
    name?: string
  }
  export const LineChart: (props: ChartProps) => any
  export const BarChart: (props: ChartProps) => any
  export const AreaChart: (props: ChartProps) => any
  export const PieChart: (props: ChartProps) => any
  export const ComposedChart: (props: ChartProps) => any
  export const ScatterChart: (props: ChartProps) => any
  export const Line: (props: SeriesProps) => any
  export const Bar: (props: SeriesProps) => any
  export const Area: (props: SeriesProps) => any
  export const Pie: (props: SeriesProps & { dataKey?: string; nameKey?: string; cx?: number | string; cy?: number | string; outerRadius?: number; innerRadius?: number }) => any
  export const Scatter: (props: SeriesProps) => any
  export const XAxis: (props: { dataKey?: string; type?: 'number' | 'category'; tick?: any; tickFormatter?: (v: any) => string }) => any
  export const YAxis: (props: { dataKey?: string; type?: 'number' | 'category'; tick?: any }) => any
  export const Tooltip: (props: { cursor?: any; content?: any; formatter?: (v: any) => string }) => any
  export const Legend: (props: { verticalAlign?: 'top' | 'middle' | 'bottom'; align?: 'left' | 'center' | 'right' }) => any
  export const CartesianGrid: (props: { strokeDasharray?: string; stroke?: string }) => any
  export const ResponsiveContainer: (props: { width?: number | string; height?: number | string; children?: any }) => any
  export const Cell: (props: { fill?: string; stroke?: string }) => any
}
declare module 'yoga-wasm-web' {
  interface YogaNode {
    setWidth(w: number | string): void
    setHeight(h: number | string): void
    setFlexDirection(d: number): void
    setJustifyContent(j: number): void
    setAlignItems(a: number): void
    setFlexGrow(n: number): void
    setFlexShrink(n: number): void
    setFlexBasis(b: number | string): void
    setMargin(edge: number, v: number): void
    setPadding(edge: number, v: number): void
    insertChild(child: YogaNode, index: number): void
    calculateLayout(width?: number, height?: number, dir?: number): void
    getComputedLeft(): number
    getComputedTop(): number
    getComputedWidth(): number
    getComputedHeight(): number
    free(): void
  }
  interface YogaModule {
    Node: { create(): YogaNode }
    FLEX_DIRECTION_ROW: number
    FLEX_DIRECTION_COLUMN: number
    JUSTIFY_FLEX_START: number
    JUSTIFY_CENTER: number
    JUSTIFY_FLEX_END: number
    JUSTIFY_SPACE_BETWEEN: number
    ALIGN_FLEX_START: number
    ALIGN_CENTER: number
    ALIGN_FLEX_END: number
    EDGE_TOP: number
    EDGE_RIGHT: number
    EDGE_BOTTOM: number
    EDGE_LEFT: number
    EDGE_ALL: number
  }
  export default function loadYoga(wasm?: ArrayBuffer | Response | string): Promise<YogaModule>
}
declare module '@chenglou/pretext' {
  export interface PreparedText {
    segments: ReadonlyArray<{ text: string; width: number; breakable: boolean }>
  }
  export interface PrepareOptions {
    font?: string
    fontSize?: number
    fontFamily?: string
  }
  export interface LayoutOptions {
    width?: number
    lineHeight?: number
    align?: 'left' | 'center' | 'right'
  }
  export interface LayoutLine {
    text: string
    width: number
    height: number
    x: number
    y: number
  }
  export interface LayoutResult {
    lines: ReadonlyArray<LayoutLine>
    width: number
    height: number
  }
  export function prepare(text: string, options?: PrepareOptions): PreparedText
  export function layout(prepared: PreparedText, options?: LayoutOptions): LayoutResult
}

// Bus exposed in every runtime via the polymath block runner
interface BusEvent<T = any> {
  topic: string
  data: T
  ts: number
}
declare const bus: {
  send<T>(topic: string, data: T): void
  on<T>(topic: string, cb: (e: BusEvent<T>) => void): () => void
  last<T>(topic: string): T | undefined
  /** Hook usable inside JSX cells: re-renders the component when topic updates. */
  use<T>(topic: string): T | undefined
}

// Shared VFS — readable from any JS / SQL cell. SQL cells access it via the
// path you write here (e.g. read_csv('data.csv')).
declare const fs: {
  list(): string[]
  has(path: string): boolean
  readBytes(path: string): Uint8Array | undefined
  readText(path: string): string | undefined
  writeBytes(path: string, data: Uint8Array | ArrayBuffer): void
  writeText(path: string, content: string): void
}
`

Comlink.expose(
  createWorker(async () => {
    const fsMap = await createDefaultMapFromCDN(
      { target: ts.ScriptTarget.ES2022 },
      TS_VERSION,
      false,
      ts,
    )
    fsMap.set('/cell-globals.d.ts', GLOBALS_DTS)

    const system = createSystem(fsMap)
    const compilerOpts: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      strict: false,
      allowJs: true,
      checkJs: false,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      // Let TS pull defaults from `target` — VFS only has the standard libs
      // fetched by createDefaultMapFromCDN(target).
    }
    return createVirtualTypeScriptEnvironment(
      system,
      ['/cell-globals.d.ts'],
      ts,
      compilerOpts,
    )
  }),
)
