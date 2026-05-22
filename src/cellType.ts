export type CellType = 'js' | 'sql' | 'jsx' | 'polymath'

export const CELL_TYPES: CellType[] = ['js', 'sql', 'jsx', 'polymath']

export const CELL_TYPE_LABEL: Record<CellType, string> = {
  js: 'JavaScript',
  sql: 'SQL',
  jsx: 'JSX',
  polymath: 'Polymath',
}
