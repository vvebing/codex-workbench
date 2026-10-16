import { attachGitGutter } from "./git-gutter";
import { attachDiffModel } from "./diff-model";
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/basic-languages/monaco.contribution.js";
import "monaco-editor/features/find/register.js";
// Register services before the first editor: later diff instances share them.
import "monaco-editor/features/documentSymbols/register.js";
import "monaco-editor/features/codelens/register.js";
import "monaco-editor/features/inlayHints/register.js";
import "monaco-editor/features/dropOrPasteInto/register.js";
import "monaco-editor/features/suggest/register.js";
import "monaco-editor/features/diffEditor/register.js";
import "monaco-editor/features/clipboard/register.js";
import "monaco-editor/features/comment/register.js";
import "monaco-editor/features/folding/register.js";
import "monaco-editor/features/bracketMatching/register.js";
import "monaco-editor/languages/features/json/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker.js?worker";
import type { FileDocument } from "./store";

(
  self as typeof self & {
    MonacoEnvironment?: { getWorker: (_: string, label: string) => Worker };
  }
).MonacoEnvironment = {
  getWorker: (_, label) =>
    label === "json" ? new JsonWorker() : new EditorWorker(),
};

function language(path: string) {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  return (
    monaco.languages
      .getLanguages()
      .find(
        (item) =>
          item.filenames?.includes(name) ||
          item.extensions?.some((extension) => name.endsWith(extension)),
      )?.id ?? "plaintext"
  );
}

export default function MonacoEditor({
  document,
  documents,
  onChange,
  onSave,
  onPosition,
  comparison,
  gitBaseline,
  onGitCompare,
}: {
  comparison?: { original: string; label: string };
  gitBaseline?: string;
  onGitCompare?: () => void;
  document: FileDocument;
  documents: FileDocument[];
  onChange: (id: string, text: string) => void;
  onSave: () => void;
  onPosition: (line: number, column: number, language: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const original = useRef<monaco.editor.ITextModel | null>(null);
  const diffModelCleanup = useRef<(() => void) | undefined>(undefined);
  const gutterCleanup = useRef<(() => void) | undefined>(undefined);
  const comparing = comparison !== undefined;
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const views = useRef(new Map<string, monaco.editor.ICodeEditorViewState>());
  const selected = useRef<string | undefined>(undefined);
  const updating = useRef(false);
  const revealed = useRef(new Map<string, number>());
  // Track the original text separately: Monaco normalizes EOLs on model creation.
  const synchronized = useRef(new Map<string, string>());
  const callbacks = useRef({ onChange, onSave, onPosition, onGitCompare });
  callbacks.current = { onChange, onSave, onPosition, onGitCompare };
  useEffect(() => {
    const viewMap = views.current;
    const theme = () =>
      monaco.editor.setTheme(
        window.document.documentElement.dataset.theme === "dark"
          ? "vs-dark"
          : "vs",
      );
    theme();
    const observer = new MutationObserver(theme);
    observer.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const options = {
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 },
      readOnly: true,
      glyphMargin: !comparing,
    };
    const diff = comparing
      ? monaco.editor.createDiffEditor(container.current!, {
          ...options,
          originalEditable: false,
          renderSideBySide: true,
        })
      : null;
    const instance = diff
      ? diff.getModifiedEditor()
      : monaco.editor.create(container.current!, options);
    diffEditor.current = diff;
    editor.current = instance;
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      callbacks.current.onSave(),
    );
    diff
      ?.getOriginalEditor()
      .addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
        callbacks.current.onSave(),
      );
    const listener = instance.onDidChangeModelContent(() => {
      if (!updating.current && selected.current) {
        const text = instance
          .getModel()!
          .getValue(monaco.editor.EndOfLinePreference.TextDefined, true);
        synchronized.current.set(selected.current, text);
        callbacks.current.onChange(selected.current, text);
      }
    });
    const cursor = instance.onDidChangeCursorPosition((event) => {
      callbacks.current.onPosition(
        event.position.lineNumber,
        event.position.column,
        instance.getModel()?.getLanguageId() ?? "plaintext",
      );
    });
    return () => {
      gutterCleanup.current?.();
      gutterCleanup.current = undefined;
      cursor.dispose();
      listener.dispose();
      observer.disconnect();
      const view = instance.saveViewState();
      if (view && selected.current) viewMap.set(selected.current, view);
      diffModelCleanup.current?.();
      diffModelCleanup.current = undefined;
      if (diff) diff.dispose();
      else instance.dispose();
      original.current?.dispose();
      original.current = null;
      diffEditor.current = null;
      selected.current = undefined;
      editor.current = null;
    };
  }, [comparing]);
  useEffect(() => {
    const modelMap = models.current;
    const viewMap = views.current;
    const revealMap = revealed.current;
    const synchronizedMap = synchronized.current;
    return () => {
      modelMap.forEach((model) => model.dispose());
      modelMap.clear();
      viewMap.clear();
      revealMap.clear();
      synchronizedMap.clear();
    };
  }, []);
  useEffect(() => {
    const instance = editor.current!;
    updating.current = true;
    let model = models.current.get(document.id);
    if (!model) {
      model = monaco.editor.createModel(document.text, language(document.path));
      models.current.set(document.id, model);
      synchronized.current.set(document.id, document.text);
    }
    if (selected.current !== document.id) {
      const view = instance.saveViewState();
      if (view && selected.current) views.current.set(selected.current, view);
      selected.current = document.id;
      if (!diffEditor.current) instance.setModel(model);
      if (diffEditor.current && comparison) {
        diffModelCleanup.current?.();
        const previousOriginal = original.current;
        original.current = monaco.editor.createModel(
          comparison.original,
          model.getLanguageId(),
        );
        diffModelCleanup.current = attachDiffModel(diffEditor.current, {
          original: original.current,
          modified: model,
        });
        previousOriginal?.dispose();
      }
      const previous = views.current.get(document.id);
      if (previous) instance.restoreViewState(previous);
      instance.focus();
    }
    if (
      original.current &&
      comparison &&
      original.current.getValue(
        monaco.editor.EndOfLinePreference.TextDefined,
        true,
      ) !== comparison.original
    ) {
      original.current.setValue(comparison.original);
    }
    if (synchronized.current.get(document.id) !== document.text) {
      const view = instance.saveViewState();
      model.setValue(document.text);
      synchronized.current.set(document.id, document.text);
      if (view) instance.restoreViewState(view);
    }
    const position = instance.getPosition();
    callbacks.current.onPosition(
      position?.lineNumber ?? 1,
      position?.column ?? 1,
      model.getLanguageId(),
    );
    const readOnly = document.readonly || document.loading || document.saving;
    instance.updateOptions({ readOnly });
    diffEditor.current?.updateOptions({ readOnly });
    updating.current = false;
    for (const [id, old] of models.current) {
      if (!documents.some((item) => item.id === id)) {
        old.dispose();
        models.current.delete(id);
        views.current.delete(id);
        revealed.current.delete(id);
        synchronized.current.delete(id);
      }
    }
  }, [document, documents, comparison, comparing]);
  useEffect(() => {
    if (
      comparing ||
      gitBaseline === undefined ||
      !editor.current ||
      document.loading
    )
      return;
    const dispose = attachGitGutter(editor.current, gitBaseline, () =>
      callbacks.current.onGitCompare?.(),
    );
    gutterCleanup.current = dispose;
    return () => {
      if (gutterCleanup.current === dispose) {
        dispose();
        gutterCleanup.current = undefined;
      }
    };
  }, [comparing, gitBaseline, document.id, document.loading]);
  useEffect(() => {
    if (!document.line || document.loading) return;
    if (revealed.current.get(document.id) === document.navigationRevision)
      return;
    revealed.current.set(document.id, document.navigationRevision);
    const line = Math.max(1, document.line);
    const model = editor.current?.getModel();
    const endLine = Math.min(
      document.endLine ?? line,
      model?.getLineCount() ?? line,
    );
    const endColumn = document.endLine
      ? (model?.getLineMaxColumn(endLine) ?? 1)
      : (document.column ?? 1);
    editor.current?.setSelection(
      new monaco.Range(line, document.column ?? 1, endLine, endColumn),
    );
    editor.current?.revealLineInCenter(line);
  }, [
    comparing,
    document.id,
    document.navigationRevision,
    document.line,
    document.column,
    document.endLine,
    document.loading,
  ]);
  return (
    <div
      className="file-monaco"
      ref={container}
      aria-label={`代码编辑器：${document.path}`}
    />
  );
}
