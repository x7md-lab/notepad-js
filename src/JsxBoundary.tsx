import {
  Component,
  Suspense,
  use,
  type ReactNode,
} from 'react'
import { JsxOutput } from './JsxOutput'
import { isJsxReady } from './jsx'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: (err: unknown) => ReactNode
  /** When this value changes, the boundary clears any captured error. */
  resetKey?: unknown
}

class JsxErrorBoundary extends Component<
  ErrorBoundaryProps,
  { error: unknown | null }
> {
  state: { error: unknown | null } = { error: null }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null })
    }
  }
  render() {
    if (this.state.error !== null) return this.props.fallback(this.state.error)
    return this.props.children
  }
}

/** Reads the compile promise; suspends while pending, throws while rejected. */
function JsxResolver({ promise }: { promise: Promise<string> }) {
  const code = use(promise)
  return <JsxOutput compiledCode={code} error={null} />
}

function JsxPending({ message }: { message: string }) {
  return (
    <div
      style={{
        background: '#1c1c1c',
        padding: '14px 12px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        color: '#9e9e9e',
        fontSize: 12,
        minHeight: 56,
      }}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.2)',
          borderTopColor: '#7c5cff',
          animation: 'spin 0.7s linear infinite',
          display: 'inline-block',
        }}
      />
      <span>{message}</span>
    </div>
  )
}

function JsxErrorPane({ error }: { error: unknown }) {
  const msg =
    error instanceof Error
      ? error.stack || error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error, null, 2)
  return (
    <pre
      style={{
        color: '#f28b82',
        whiteSpace: 'pre-wrap',
        font: '12px ui-monospace, Menlo, Consolas, monospace',
        padding: '12px',
        margin: 0,
        background: 'rgba(242,139,130,0.08)',
        borderTop: '1px solid rgba(242,139,130,0.35)',
      }}
    >
      {msg}
    </pre>
  )
}

interface Props {
  /** Promise of the compiled module; null = never compiled yet. */
  promise: Promise<string> | null
  /** Pre-resolution error (e.g. JSX block in polymath that the runner caught). */
  error?: string | null
}

/**
 * Suspense pattern for a JSX cell:
 *   - no promise yet            → idle hint ("Click Run…")
 *   - SWC wasm not yet booted   → "Booting SWC compiler (~4 MB)…"
 *   - SWC booted, compiling     → "Compiling JSX…"
 *   - rejection (compile error) → red error pane
 *   - resolved                  → iframe with the compiled module
 */
export function JsxBoundary({ promise, error }: Props) {
  if (error && !promise) {
    return <JsxErrorPane error={error} />
  }
  if (!promise) {
    return (
      <JsxPending message="Click Run to compile this JSX block." />
    )
  }
  const fallbackMsg = isJsxReady()
    ? 'Compiling JSX…'
    : 'Booting SWC compiler (~4 MB gzip)…'
  return (
    <JsxErrorBoundary
      resetKey={promise}
      fallback={(e) => <JsxErrorPane error={e} />}
    >
      <Suspense fallback={<JsxPending message={fallbackMsg} />}>
        <JsxResolver promise={promise} />
      </Suspense>
    </JsxErrorBoundary>
  )
}
