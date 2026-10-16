import { ReferenceNode } from "./reference-node";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { UndoRedo, Placeholder } from "@tiptap/extensions";
import { EditorState } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import type { Draft } from "./drafts";
import {
  documentSkills,
  documentText,
  textDocument,
  type Reference,
} from "./editor-document";
import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import "./editor.css";

export interface MessageEditorHandle {
  replaceCompletion: (
    length: number,
    value: string,
    reference?: Reference,
  ) => void;
}
interface Props {
  ref: Ref<MessageEditorHandle>;
  draft: Draft;
  disabled: boolean;
  placeholder: string;
  completionId?: string;
  hasCompletions: boolean;
  onChange: (
    document: JSONContent,
    text: string,
    skills: { name: string; path: string }[],
  ) => void;
  onCaret: (caret: number) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onFiles: (files: File[]) => void;
  onOpenFile?: (path: string) => void;
}

function completionCaret(editor: Editor) {
  const { selection, doc } = editor.state;
  if (!selection.empty || selection.$from.nodeBefore?.type.name === "reference")
    return -1;
  return documentText(doc, selection.from).length;
}

export function MessageEditor(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      ReferenceNode,
      UndoRedo,
      Placeholder.configure({ placeholder: () => latest.current.placeholder }),
    ],
    content: props.draft.document || textDocument(props.draft.text),
    editable: !props.disabled,
    editorProps: {
      attributes: {
        id: "message-input",
        role: "textbox",
        "aria-label": "消息输入框",
        "aria-multiline": "true",
        "aria-autocomplete": "list",
        class: "composer-editor",
        "aria-disabled": String(props.disabled),
        ...(props.hasCompletions
          ? { "aria-controls": "composer-completions" }
          : {}),
        ...(props.completionId
          ? { "aria-activedescendant": props.completionId }
          : {}),
      },
      handleKeyDown: (view, event) => {
        if (!view.editable) return true;
        if (view.composing || event.isComposing || event.keyCode === 229)
          return false;
        latest.current.onKeyDown(event);
        return event.defaultPrevented;
      },
      handleClickOn: (_view, _pos, node, _nodePos, event, direct) => {
        if (
          direct &&
          (event.metaKey || event.ctrlKey) &&
          node.type.name === "reference" &&
          node.attrs.kind === "file" &&
          node.attrs.path &&
          latest.current.onOpenFile
        ) {
          event.preventDefault();
          latest.current.onOpenFile(node.attrs.path);
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        if (!view.editable) return true;
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length) return false;
        event.preventDefault();
        latest.current.onFiles(files);
        const text = event.clipboardData?.getData("text/plain");
        if (text) {
          const content = view.state.schema.nodeFromJSON(textDocument(text));
          view.dispatch(
            view.state.tr.replaceSelection(
              // Let ProseMirror fit paragraphs and line breaks into the selection.
              content.slice(0, content.content.size),
            ),
          );
        }
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      latest.current.onChange(
        editor.getJSON(),
        documentText(editor.state.doc),
        documentSkills(editor.state.doc),
      );
      latest.current.onCaret(completionCaret(editor));
    },
    onSelectionUpdate: ({ editor }) => {
      latest.current.onCaret(completionCaret(editor));
    },
  });

  useImperativeHandle(
    props.ref,
    () => ({
      replaceCompletion(length, value, reference) {
        if (!editor || !editor.isEditable) return;
        const { from, to } = editor.state.selection;
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            closeHistory(tr);
            return true;
          })
          .insertContentAt(
            { from: Math.max(1, from - length), to },
            reference
              ? [
                  { type: "reference", attrs: reference },
                  { type: "text", text: " " },
                ]
              : { type: "text", text: value },
          )
          .run();
      },
    }),
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!props.disabled, false);
  }, [
    editor,
    props.disabled,
    props.hasCompletions,
    props.completionId,
    props.placeholder,
  ]);

  useEffect(() => {
    if (!editor) return;
    const document = props.draft.document || textDocument(props.draft.text);
    if (JSON.stringify(document) === JSON.stringify(editor.getJSON())) return;
    editor.commands.setContent(document, { emitUpdate: false });
    // External resets (successful send / slash command) start a fresh history;
    // undo must not resurrect an already submitted message.
    editor.view.updateState(
      EditorState.create({
        doc: editor.state.doc,
        schema: editor.schema,
        plugins: editor.state.plugins,
      }),
    );
    latest.current.onCaret(0);
  }, [editor, props.draft.document, props.draft.text]);

  useEffect(() => {
    if (props.draft.restored?.id && editor?.isEditable)
      editor.commands.focus("end");
  }, [editor, props.draft.restored?.id]);

  return <EditorContent editor={editor} />;
}
