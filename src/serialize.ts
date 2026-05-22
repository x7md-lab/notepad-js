/**
 * BigInt-aware JSON helpers for projecting bus state into runtimes that only
 * speak text (QuickJS sandbox eval, iframe srcDoc template).
 *
 * Tagged form for BigInt: { "__b": "123" }
 * Tagged form for Date:   { "__d": "<iso>" }
 *
 * BroadcastChannel.postMessage already supports structured clone, so this
 * is only needed at the text boundaries.
 */

export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return { __b: value.toString() }
  if (value instanceof Date) return { __d: value.toISOString() }
  return value
}

export function jsonReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>
    const keys = Object.keys(v)
    if (keys.length === 1 && typeof v.__b === 'string') return BigInt(v.__b)
    if (keys.length === 1 && typeof v.__d === 'string') return new Date(v.__d)
  }
  return value
}

export function stringify(value: unknown): string {
  return JSON.stringify(value, jsonReplacer)
}

export function parse<T = unknown>(text: string): T {
  return JSON.parse(text, jsonReviver) as T
}

/** Source for an inline reviver function (for embedding in runtime code). */
export const REVIVER_SOURCE = `function (_k, v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    var ks = Object.keys(v);
    if (ks.length === 1 && typeof v.__b === 'string') return BigInt(v.__b);
    if (ks.length === 1 && typeof v.__d === 'string') return new Date(v.__d);
  }
  return v;
}`

/** Source for an inline replacer function. */
export const REPLACER_SOURCE = `function (_k, v) {
  if (typeof v === 'bigint') return { __b: v.toString() };
  if (v instanceof Date) return { __d: v.toISOString() };
  return v;
}`
