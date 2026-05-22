import { encode as cborEncode, decode as cborDecode } from 'cbor-x'

/**
 * Main-thread message bus for cross-cell communication.
 *
 * - send(topic, data) — publish; remembers as "last"
 * - on(topic, cb)     — subscribe
 * - last(topic)       — sync getter
 * - snapshot()        — current full state
 * - snapshotBytes()   — CBOR-encoded snapshot (binary, BigInt/Date/Map-safe)
 * - sharedBuffer()    — SharedArrayBuffer holding the current snapshot when
 *                       crossOriginIsolated; null otherwise
 *
 * BroadcastChannel('js-terminal-bus') mirrors events to same-origin iframes
 * (structured clone handles BigInt natively, so payloads are sent as-is).
 *
 * The "protobuf-ish" part: a CBOR view of the snapshot is maintained for any
 * text-only consumer (iframe srcDoc embed, future workers without structured
 * clone). When crossOriginIsolated is true, the CBOR bytes also live in a
 * SharedArrayBuffer ring so peer contexts can read zero-copy.
 *
 * SAB layout:
 *   [0..3]   uint32  version  (currently 1)
 *   [4..7]   uint32  byteLength of CBOR payload
 *   [8..11]  uint32  writeCounter (incremented each update)
 *   [12..N]  cbor    payload
 */

export interface BusEvent<T = unknown> {
  topic: string
  data: T
  ts: number
  src?: string
}

type Sub = (e: BusEvent) => void

const CHANNEL_NAME = 'js-terminal-bus'
const SAB_HEADER_BYTES = 12
const SAB_DEFAULT_BYTES = 1 << 22 // 4 MiB ring (header + payload)

class Bus {
  private latest = new Map<string, unknown>()
  private subs = new Map<string, Set<Sub>>()
  private channel: BroadcastChannel | null = null
  readonly id = `host-${Math.random().toString(36).slice(2, 8)}`

  private sab: SharedArrayBuffer | null = null
  private sabHeader: Uint32Array | null = null
  private sabBytes: Uint8Array | null = null
  private snapshotBytesCache: Uint8Array | null = null
  private writeCounter = 0

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME)
      this.channel.onmessage = (e: MessageEvent<BusEvent>) => {
        const ev = e.data
        if (!ev || typeof ev.topic !== 'string') return
        if (ev.src === this.id) return
        this.latest.set(ev.topic, ev.data)
        this.invalidate()
        this.subs.get(ev.topic)?.forEach((cb) => cb(ev))
      }
    }

    if (
      typeof SharedArrayBuffer !== 'undefined' &&
      typeof crossOriginIsolated !== 'undefined' &&
      crossOriginIsolated
    ) {
      try {
        this.sab = new SharedArrayBuffer(SAB_DEFAULT_BYTES)
        this.sabHeader = new Uint32Array(this.sab, 0, SAB_HEADER_BYTES / 4)
        this.sabBytes = new Uint8Array(this.sab, SAB_HEADER_BYTES)
        this.sabHeader[0] = 1
      } catch {
        // SAB not available; the iframe will fall back to embedded CBOR.
        this.sab = null
      }
    }
  }

  send<T>(topic: string, data: T): void {
    const ev: BusEvent<T> = { topic, data, ts: Date.now(), src: this.id }
    this.latest.set(topic, data)
    this.invalidate()
    this.subs.get(topic)?.forEach((cb) => cb(ev))
    this.channel?.postMessage(ev)
  }

  on<T>(topic: string, cb: (e: BusEvent<T>) => void): () => void {
    let set = this.subs.get(topic)
    if (!set) {
      set = new Set()
      this.subs.set(topic, set)
    }
    set.add(cb as Sub)
    return () => {
      this.subs.get(topic)?.delete(cb as Sub)
    }
  }

  last<T>(topic: string): T | undefined {
    return this.latest.get(topic) as T | undefined
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.latest.entries())
  }

  /** CBOR-encoded snapshot bytes; cached until next send/clear. */
  snapshotBytes(): Uint8Array {
    if (this.snapshotBytesCache) return this.snapshotBytesCache
    const bytes = cborEncode(this.snapshot())
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    this.snapshotBytesCache = u8
    this.writeToSAB(u8)
    return u8
  }

  /** SharedArrayBuffer with the latest CBOR snapshot, or null if unavailable. */
  sharedBuffer(): SharedArrayBuffer | null {
    if (!this.sab) return null
    // Ensure SAB is current before handing it out.
    this.snapshotBytes()
    return this.sab
  }

  clear(): void {
    this.latest.clear()
    this.invalidate()
  }

  private invalidate(): void {
    this.snapshotBytesCache = null
  }

  private writeToSAB(payload: Uint8Array): void {
    if (!this.sab || !this.sabHeader || !this.sabBytes) return
    if (payload.byteLength > this.sabBytes.byteLength) {
      // Don't overflow; mark length as 0 to signal "use embed".
      this.sabHeader[1] = 0
      return
    }
    this.sabBytes.set(payload)
    this.sabHeader[1] = payload.byteLength
    this.writeCounter = (this.writeCounter + 1) >>> 0
    this.sabHeader[2] = this.writeCounter
  }
}

export const bus = new Bus()

// Re-export decoder for any consumer that wants symmetric ops.
export { cborEncode, cborDecode }
