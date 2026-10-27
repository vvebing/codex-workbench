import { t } from "../../lib/i18n";
import * as monaco from "monaco-editor/editor/editor.api.js";
import { diffQuitEarly } from "./diff-status";
import { DEFAULT_FILE_LIMITS } from "./file-limits";
import { attachDiffModel } from "./diff-model";

/** One offscreen diff instance for the active editor, using Monaco's worker. */
export function attachGitGutter(
  editor: monaco.editor.IStandaloneCodeEditor,
  baseline: string,
  onCompare: () => void,
  normalBytes = DEFAULT_FILE_LIMITS.normalBytes,
) {
  const model = editor.getModel();
  if (!model) return () => {};
  const host = document.createElement("div");
  host.className = "file-git-diff-engine";
  host.setAttribute("aria-hidden", "true");
  document.body.append(host);
  const original = monaco.editor.createModel(baseline, model.getLanguageId());
  const diff = monaco.editor.createDiffEditor(host, {
    dimension: { width: 600, height: 100 },
    readOnly: true,
    originalEditable: false,
    renderSideBySide: false,
    minimap: { enabled: false },
    ignoreTrimWhitespace: false,
    maxComputationTime: 1000,
    maxFileSize: normalBytes / (1024 * 1024),
    renderOverviewRuler: false,
    accessibilitySupport: "off",
  });
  const decorations = editor.createDecorationsCollection();
  const update = diff.onDidUpdateDiff(() => {
    if (disposed || model.isDisposed() || editor.getModel() !== model) return;
    const changes = diff.getLineChanges();
    if (!changes || diffQuitEarly(diff)) {
      decorations.clear();
      return;
    }
    decorations.set(
      changes.map((change) => {
        const added = baseline === "" || change.originalEndLineNumber === 0;
        const deleted =
          model.getValueLength() === 0 || change.modifiedEndLineNumber === 0;
        const kind = added ? "added" : deleted ? "deleted" : "modified";
        const start = Math.min(
          model.getLineCount(),
          Math.max(1, change.modifiedStartLineNumber),
        );
        const end = deleted
          ? start
          : Math.min(model.getLineCount(), change.modifiedEndLineNumber);
        const before = added
          ? ""
          : original.getValueInRange(
              new monaco.Range(
                change.originalStartLineNumber,
                1,
                change.originalEndLineNumber,
                original.getLineMaxColumn(change.originalEndLineNumber),
              ),
            );
        const hover: monaco.IMarkdownString = {
          value:
            t("Git {{value0}} · 相对暂存区（含未保存草稿）。点击查看差异。", {
              value0: added ? t("新增") : deleted ? t("删除") : t("修改"),
            }) +
            (before
              ? "\n\n" +
                before
                  .slice(0, 4000)
                  .split("\n")
                  .map((line) => "    " + line)
                  .join("\n")
              : ""),
          isTrusted: false,
        };
        return {
          range: new monaco.Range(start, 1, Math.max(start, end), 1),
          options: {
            isWholeLine: true,
            glyphMarginClassName: `git-gutter-${kind}${deleted && change.modifiedStartLineNumber === 0 ? " git-gutter-before" : ""}`,
            glyphMarginHoverMessage: hover,
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        };
      }),
    );
  });
  const click = editor.onMouseDown((event) => {
    if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN)
      return;
    const line = event.target.position?.lineNumber;
    if (
      line &&
      decorations
        .getRanges()
        .some(
          (range) =>
            line >= range.startLineNumber && line <= range.endLineNumber,
        )
    ) {
      editor.setPosition({ lineNumber: line, column: 1 });
      onCompare();
    }
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    modelDisposal.dispose();
    modelChange.dispose();
    click.dispose();
    update.dispose();
    decorations.clear();
    detach();
    diff.dispose();
    original.dispose();
    host.remove();
  };
  const modelDisposal = model.onWillDispose(dispose);
  const modelChange = editor.onDidChangeModel(dispose);
  const detach = attachDiffModel(diff, { original, modified: model });
  return dispose;
}
