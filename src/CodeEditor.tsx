import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
  indentOnInput,
} from '@codemirror/language'
import { autocompletion } from '@codemirror/autocomplete'
import { LanguageDescription } from '@codemirror/language'
import { javascript, javascriptLanguage, jsxLanguage } from '@codemirror/lang-javascript'
import { sql, StandardSQL } from '@codemirror/lang-sql'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  tsFacetWorker,
  tsSyncWorker,
  tsAutocompleteWorker,
  tsHoverWorker,
  tsLinterWorker,
} from '@valtown/codemirror-ts'
import type { CellType } from './cellType'
import { getTsWorker } from './tsLsp'

interface Props {
  value: string
  onChange: (next: string) => void
  onRun: () => void
  language?: CellType
  tsPath?: string
  readOnly?: boolean
  autoFocus?: boolean
}

const polymathCodeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'js',
    alias: ['javascript', 'mjs'],
    async load() {
      return javascript({ jsx: false, typescript: false })
    },
  }),
  LanguageDescription.of({
    name: 'jsx',
    alias: ['tsx'],
    async load() {
      return javascript({ jsx: true, typescript: false })
    },
  }),
  LanguageDescription.of({
    name: 'sql',
    alias: ['duckdb'],
    async load() {
      return sql({ dialect: StandardSQL })
    },
  }),
]

function langExt(lang: CellType): Extension {
  switch (lang) {
    case 'sql':
      return sql()
    case 'jsx':
      return javascript({ jsx: true, typescript: false })
    case 'polymath':
      return markdown({
        codeLanguages: polymathCodeLanguages,
        defaultCodeLanguage: javascriptLanguage,
      })
    case 'js':
    default:
      return javascript({ jsx: false, typescript: false })
  }
}

// Reference exports so unused-imports analyzer doesn't flag them.
void jsxLanguage

const editorTheme = EditorView.theme(
  {
    '&': {
      fontSize: '14px',
      backgroundColor: 'transparent',
    },
    '.cm-scroller': {
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
      lineHeight: '1.55',
    },
    '.cm-content': {
      padding: '12px 0',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: '1px solid #2a2a2e',
      color: '#5a5a5e',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255,255,255,0.025)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: '#9a9a9e',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-line': {
      padding: '0 12px',
    },
    '.cm-tooltip': {
      background: '#1e1e22',
      border: '1px solid #3d3d3d',
      borderRadius: '4px',
      color: '#d4d4d4',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      background: 'rgba(104, 154, 242, 0.18)',
      color: '#fff',
    },
  },
  { dark: true },
)

export function CodeEditor({
  value,
  onChange,
  onRun,
  language = 'js',
  tsPath,
  readOnly,
  autoFocus,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyCompartment = useRef(new Compartment())
  const languageCompartment = useRef(new Compartment())
  const tsCompartment = useRef(new Compartment())
  const onRunRef = useRef(onRun)
  const onChangeRef = useRef(onChange)
  onRunRef.current = onRun
  onChangeRef.current = onChange

  const [, setTsReady] = useState(false)

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      viewRef.current?.destroy()
      viewRef.current = null
      hostRef.current = null
      return
    }
    hostRef.current = el

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        languageCompartment.current.of(langExt(language)),
        tsCompartment.current.of([autocompletion()]),
        oneDark,
        editorTheme,
        readOnlyCompartment.current.of(EditorState.readOnly.of(!!readOnly)),
        keymap.of([
          {
            key: 'Shift-Enter',
            preventDefault: true,
            run: () => {
              onRunRef.current()
              return true
            },
          },
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              onRunRef.current()
              return true
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
        }),
      ],
    })

    const view = new EditorView({ state, parent: el })
    viewRef.current = view
    if (autoFocus) view.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      })
    }
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(!!readOnly),
      ),
    })
  }, [readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: languageCompartment.current.reconfigure(langExt(language)),
    })
  }, [language])

  // Wire TS LSP only for JS / JSX cells. Polymath has mixed langs per block,
  // so we skip whole-file TS analysis there.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (language === 'sql' || language === 'polymath' || !tsPath) {
      view.dispatch({
        effects: tsCompartment.current.reconfigure([autocompletion()]),
      })
      return
    }

    let cancelled = false
    void getTsWorker().then((worker) => {
      if (cancelled || !viewRef.current) return
      const exts: Extension[] = [
        tsFacetWorker.of({ worker, path: tsPath }),
        tsSyncWorker(),
        tsLinterWorker(),
        autocompletion({
          override: [tsAutocompleteWorker()],
          activateOnTyping: true,
          closeOnBlur: false,
        }),
        tsHoverWorker(),
      ]
      viewRef.current.dispatch({
        effects: tsCompartment.current.reconfigure(exts),
      })
      setTsReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [language, tsPath])

  return <div ref={containerRef} className="code-editor" />
}
