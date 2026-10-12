import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers, placeholder as placeholderExt } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// One theme for both: colors are the design tokens (CSS variables), which switch
// with the .dark class.
const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--muted)', color: 'var(--foreground)', fontSize: '12.5px', borderRadius: '6px' },
  '&.cm-focused': { outline: '2px solid var(--ring)', outlineOffset: '0' },
  '.cm-content': {
    fontFamily: "'Fira Code', ui-monospace, monospace",
    caretColor: 'var(--foreground)',
    padding: '8px 0',
  },
  '.cm-gutters': { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--foreground) 5%, transparent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--foreground)', borderColor: 'var(--border)' },
  '.cm-panel input, .cm-panel button': { fontSize: '12px' },
  '.cm-tooltip': { backgroundColor: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--destructive)' },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '.cm-searchMatch': { backgroundColor: 'var(--warning-subtle)', outline: '1px solid var(--warning)' },
});

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--syntax-key)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--syntax-literal)' },
  { tag: [tags.punctuation, tags.separator, tags.brace, tags.squareBracket], color: 'var(--syntax-punct)' },
]);

export type CodeEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  language?: 'json' | 'text';
  readOnly?: boolean;
  /** Required: the editor's accessible name. */
  label: string;
  describedBy?: string;
  placeholder?: string;
  /** ⌘↵ / Ctrl↵ inside the editor. */
  onSubmit?: () => void;
  minHeight?: string;
  maxHeight?: string;
};

/** CodeMirror 6 (loaded with the API page): JSON highlighting and lint, search, folding. */
export default function CodeEditor({
  value,
  onChange,
  language = 'json',
  readOnly = false,
  label,
  describedBy,
  placeholder,
  onSubmit,
  minHeight = '8rem',
  maxHeight = '28rem',
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSubmit });
  // The editor is created once; it calls the latest handlers through this ref.
  useEffect(() => {
    callbacks.current = { onChange, onSubmit };
  }, [onChange, onSubmit]);
  const languageConf = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      foldGutter(),
      history(),
      bracketMatching(),
      indentOnInput(),
      highlightSelectionMatches(),
      search({ top: true }),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      EditorView.theme({ '&': { minHeight }, '.cm-scroller': { maxHeight, overflow: 'auto' } }),
      EditorView.contentAttributes.of({
        'aria-label': label,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      }),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      keymap.of([
        { key: 'Mod-Enter', run: () => (callbacks.current.onSubmit?.(), !!callbacks.current.onSubmit) },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        // Tab indents only while editing; Esc then Tab leaves the editor (no keyboard trap).
        ...(readOnly ? [] : [indentWithTab]),
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacks.current.onChange?.(update.state.doc.toString());
      }),
      languageConf.current.of(
        language === 'json' ? [json(), ...(readOnly ? [] : [linter(jsonParseLinter()), lintGutter()])] : [],
      ),
      ...(placeholder ? [placeholderExt(placeholder)] : []),
      ...(readOnly ? [] : [highlightActiveLine()]),
    ];
    view.current = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions }) });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
    // Recreated only when the editor's kind changes; value updates come below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, language, label]);

  // Outside changes (a new example, a reset) replace the document.
  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== value) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="min-w-0 overflow-hidden rounded-md border border-border" />;
}
