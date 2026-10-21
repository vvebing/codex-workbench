import * as monaco from "monaco-editor/editor/editor.api.js";
import { readAppearance, type Appearance } from "../../lib/appearance";

export function applyEditorAppearance(
  appearance: Appearance = readAppearance(),
) {
  const name = appearance.dark ? "workbench-dark" : "workbench-light";
  monaco.editor.defineTheme(name, {
    base: appearance.dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: appearance.muted },
      { token: "keyword", foreground: appearance.accent },
      { token: "string", foreground: appearance.success },
      { token: "number", foreground: appearance.warning },
    ],
    colors: {
      "editor.background": appearance.background,
      "editor.foreground": appearance.foreground,
      "editorLineNumber.foreground": appearance.muted,
      "editorLineNumber.activeForeground": appearance.foreground,
      "editorCursor.foreground": appearance.accent,
      "editor.selectionBackground": appearance.selected,
      "editor.inactiveSelectionBackground": appearance.surface,
      "editor.lineHighlightBackground": appearance.surface,
      "editorWidget.background": appearance.elevated,
      "editorWidget.border": appearance.border,
      "editorGutter.background": appearance.background,
    },
  });
  monaco.editor.setTheme(name);
  return {
    fontSize: appearance.codeFontSize,
    fontFamily: appearance.codeFontFamily,
  };
}
