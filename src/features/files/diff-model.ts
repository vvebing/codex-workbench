import type * as monaco from "monaco-editor/editor/editor.api.js";

export function attachDiffModel(
  editor: monaco.editor.IStandaloneDiffEditor,
  model: monaco.editor.IDiffEditorModel,
) {
  const viewModel = editor.createViewModel(model);
  editor.setModel(viewModel);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    editor.setModel(null);
    viewModel.dispose();
  };
}
