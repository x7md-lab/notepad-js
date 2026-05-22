/**
 * Shared in-memory VFS used by JS (QuickJS) and SQL (DuckDB) cells.
 *
 * Conventions:
 *   - Paths are bare (no leading slash): "data.csv", "schema/users.parquet".
 *   - Contents are always stored as Uint8Array; text helpers UTF-8 encode/decode.
 *
 * Lifecycle: in-memory, session-only. No persistence.
 */

type Listener = () => void

class VFS {
  private files = new Map<string, Uint8Array>()
  private listeners = new Set<Listener>()

  list(): string[] {
    return Array.from(this.files.keys()).sort()
  }

  has(path: string): boolean {
    return this.files.has(path)
  }

  read(path: string): Uint8Array | undefined {
    return this.files.get(path)
  }

  readText(path: string): string | undefined {
    const bytes = this.files.get(path)
    return bytes ? new TextDecoder().decode(bytes) : undefined
  }

  write(path: string, bytes: Uint8Array): void {
    this.files.set(path, bytes)
    this.notify()
  }

  writeText(path: string, content: string): void {
    this.write(path, new TextEncoder().encode(content))
  }

  delete(path: string): boolean {
    const ok = this.files.delete(path)
    if (ok) this.notify()
    return ok
  }

  clear(): void {
    if (this.files.size === 0) return
    this.files.clear()
    this.notify()
  }

  entries(): IterableIterator<[string, Uint8Array]> {
    return this.files.entries()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }
}

export const vfs = new VFS()
