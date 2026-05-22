import type { CellType } from './cellType'

export type BlockLang = Exclude<CellType, 'polymath'>

export interface Block {
  lang: BlockLang
  /** Optional name from the header (e.g. ```sql data → "data"). */
  name?: string
  body: string
  /** 1-based start line of the block's CONTENT (i.e. line after the header). */
  startLine: number
}

/**
 * Polymath cell bodies support two header styles for ergonomics:
 *
 *   Markdown fences (preferred — pairs with CodeMirror's lang-markdown
 *   mixed highlighting):
 *     ```sql data
 *     SELECT 1
 *     ```
 *
 *   ATX-ish headers (legacy / quick to type — no closing marker, runs until
 *   the next header or EOF):
 *     ### sql data
 *     SELECT 1
 *     ### js logic
 *     ...
 *
 * Mixing both in one cell is fine; they're scanned in document order.
 * Prose between blocks is ignored by the runner.
 *
 * If no headers exist and the body is non-empty, treat it as a single
 * implicit `js` block so old/free-form cells still run.
 */
const FENCE_OPEN_RE = /^(\s*)(```|~~~)([a-zA-Z][\w-]*)(?:\s+([a-zA-Z_][\w-]*))?\s*$/
const ATX_RE = /^###\s+(sql|js|jsx)(?:\s+([a-zA-Z_][\w-]*))?\s*$/

const KNOWN: ReadonlySet<string> = new Set(['sql', 'js', 'jsx'])

export function parsePolymath(code: string): Block[] {
  const lines = code.split('\n')
  const blocks: Block[] = []

  let i = 0
  // current ATX-open block (no explicit closer; closes at next header or EOF)
  let atxOpen: { lang: BlockLang; name?: string; startLine: number; buf: string[] } | null = null

  const flushAtx = () => {
    if (!atxOpen) return
    blocks.push({
      lang: atxOpen.lang,
      name: atxOpen.name,
      body: atxOpen.buf.join('\n').replace(/\s+$/u, ''),
      startLine: atxOpen.startLine,
    })
    atxOpen = null
  }

  while (i < lines.length) {
    const line = lines[i]

    // Markdown fence open?
    const fenceOpen = line.match(FENCE_OPEN_RE)
    if (fenceOpen && KNOWN.has(fenceOpen[3].toLowerCase())) {
      flushAtx()
      const indent = fenceOpen[1]
      const fence = fenceOpen[2]
      const lang = fenceOpen[3].toLowerCase() as BlockLang
      const name = fenceOpen[4]
      const contentStart = i + 1

      let j = contentStart
      let close = -1
      while (j < lines.length) {
        const m = lines[j].match(/^(\s*)(```|~~~)\s*$/)
        if (m && m[1] === indent && m[2] === fence) {
          close = j
          break
        }
        j++
      }
      const end = close === -1 ? lines.length : close
      blocks.push({
        lang,
        name,
        body: lines.slice(contentStart, end).join('\n'),
        startLine: contentStart + 1,
      })
      i = close === -1 ? lines.length : close + 1
      continue
    }

    // ATX-style header?
    const atx = line.match(ATX_RE)
    if (atx) {
      flushAtx()
      atxOpen = {
        lang: atx[1] as BlockLang,
        name: atx[2],
        startLine: i + 2,
        buf: [],
      }
      i++
      continue
    }

    if (atxOpen) atxOpen.buf.push(line)
    i++
  }
  flushAtx()

  if (blocks.length === 0 && code.trim()) {
    return [{ lang: 'js', body: code, startLine: 1 }]
  }
  return blocks
}
