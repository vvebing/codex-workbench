import { Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** Keep native visual-line movement, but commit it before controlled UI updates. */
export function navigateMessageEditor(view: EditorView, event: KeyboardEvent) {
  if (event.altKey || event.isComposing || !view.editable) return false;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const key = event.key;
  const boundary = key === "Home" || key === "End";
  const macLine =
    mac &&
    event.metaKey &&
    !event.ctrlKey &&
    (key === "ArrowLeft" || key === "ArrowRight");
  const macDocument =
    mac &&
    event.metaKey &&
    !event.ctrlKey &&
    (key === "ArrowUp" || key === "ArrowDown");
  const vertical =
    !event.metaKey &&
    !event.ctrlKey &&
    (key === "ArrowUp" || key === "ArrowDown");
  if (!boundary && !macLine && !macDocument && !vertical) return false;
  const backward = key === "Home" || key === "ArrowLeft" || key === "ArrowUp";
  const { state } = view;
  if (macDocument || (boundary && (event.ctrlKey || event.metaKey))) {
    const target = backward
      ? Selection.atStart(state.doc).from
      : Selection.atEnd(state.doc).to;
    view.dispatch(
      state.tr
        .setSelection(
          TextSelection.create(
            state.doc,
            event.shiftKey ? state.selection.anchor : target,
            target,
          ),
        )
        .scrollIntoView(),
    );
    event.preventDefault();
    return true;
  }
  const selection = view.dom.ownerDocument.getSelection();
  if (
    !selection?.focusNode ||
    !view.dom.contains(selection.focusNode) ||
    typeof selection.modify !== "function"
  )
    return false;
  selection.modify(
    event.shiftKey ? "extend" : "move",
    backward ? "backward" : "forward",
    vertical ? "line" : "lineboundary",
  );
  if (!selection.focusNode || !selection.anchorNode) return false;
  const head = view.posAtDOM(selection.focusNode, selection.focusOffset);
  const anchor = event.shiftKey ? state.selection.anchor : head;
  view.dispatch(
    state.tr
      .setSelection(
        TextSelection.between(
          state.doc.resolve(anchor),
          state.doc.resolve(head),
        ),
      )
      .scrollIntoView(),
  );
  event.preventDefault();
  return true;
}
