import { Node } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";

// Keep a reference as a leaf node: selection, replacement and history are
// handled by ProseMirror, rather than by tracking offsets in a textarea.
export const ReferenceNode = Node.create({
  name: "reference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return Object.fromEntries(
      ["kind", "label", "value", "name", "path"].map((name) => [
        name,
        {
          default: "",
          parseHTML: (element: HTMLElement) =>
            element.getAttribute(`data-reference-${name}`) || "",
          renderHTML: (attrs: Record<string, string>) => ({
            [`data-reference-${name}`]: attrs[name],
          }),
        },
      ]),
    );
  },
  parseHTML() {
    return [{ tag: "span[data-composer-reference]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        "data-composer-reference": node.attrs.kind,
        class: "composer-reference",
        title:
          node.attrs.kind === "file"
            ? `${node.attrs.path} · ⌘ / Ctrl 点击打开文件`
            : node.attrs.path,
        contenteditable: "false",
      },
      `${node.attrs.kind === "skill" ? "$" : "@"}${node.attrs.label}`,
    ];
  },
  renderText({ node }) {
    return node.attrs.value;
  },
  addKeyboardShortcuts() {
    const remove = (backward: boolean) => {
      if (!this.editor.isEditable) return false;
      const { state, view } = this.editor;
      const { selection } = state;
      if (
        selection instanceof NodeSelection &&
        selection.node.type.name === this.name
      ) {
        view.dispatch(closeHistory(state.tr).deleteSelection());
        return true;
      }
      if (!selection.empty) return false;
      const node = backward
        ? selection.$from.nodeBefore
        : selection.$from.nodeAfter;
      if (node?.type.name !== this.name) return false;
      const from = backward ? selection.from - node.nodeSize : selection.from;
      view.dispatch(closeHistory(state.tr).delete(from, from + node.nodeSize));
      return true;
    };
    return { Backspace: () => remove(true), Delete: () => remove(false) };
  },
});
