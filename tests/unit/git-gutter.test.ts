import { afterEach, describe, expect, it, vi } from "vitest";
import type * as monaco from "monaco-editor/editor/editor.api.js";
import { attachGitGutter } from "../../src/features/files/git-gutter";
import { attachDiffModel } from "../../src/features/files/diff-model";

vi.mock("monaco-editor/editor/editor.api.js", () => ({
  editor: { createModel: vi.fn(), createDiffEditor: vi.fn() },
}));
import { editor as monacoEditor } from "monaco-editor/editor/editor.api.js";

function event() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: () => [...listeners].forEach((listener) => listener()),
  };
}

function setup() {
  const order: string[] = [];
  const modelDisposal = event();
  const modelChange = event();
  let modelDisposed = false;
  let cancelled = false;
  let finish!: () => void;
  const worker = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const pending = worker.then(() => {
    if (cancelled) return;
    if (modelDisposed) throw new Error("no diff result available");
  });
  const model = {
    getLanguageId: () => "json",
    isDisposed: () => modelDisposed,
    onWillDispose: modelDisposal.subscribe,
    dispose: () => {
      modelDisposal.fire();
      modelDisposed = true;
      order.push("modified disposed");
    },
  };
  const original = { dispose: vi.fn(() => order.push("original disposed")) };
  const viewModel = {
    dispose: vi.fn(() => {
      cancelled = true;
      order.push("cancelled");
    }),
  };
  let update!: () => void;
  const diff = {
    createViewModel: vi.fn(() => viewModel),
    setModel: vi.fn((value: unknown) => {
      if (!value) order.push("detached");
    }),
    onDidUpdateDiff: vi.fn((callback: () => void) => {
      update = callback;
      return { dispose: vi.fn() };
    }),
    getLineChanges: vi.fn(() => null),
    dispose: vi.fn(() => order.push("editor disposed")),
  };
  const decorations = { clear: vi.fn(), set: vi.fn() };
  const editor = {
    getModel: () => model,
    createDecorationsCollection: () => decorations,
    onMouseDown: () => ({ dispose: vi.fn() }),
    onDidChangeModel: modelChange.subscribe,
  };
  const host = { setAttribute: vi.fn(), remove: vi.fn(), className: "" };
  vi.stubGlobal("document", {
    createElement: () => host,
    body: { append: vi.fn() },
  });
  vi.mocked(monacoEditor.createModel).mockReturnValue(
    original as unknown as monaco.editor.ITextModel,
  );
  vi.mocked(monacoEditor.createDiffEditor).mockReturnValue(
    diff as unknown as monaco.editor.IStandaloneDiffEditor,
  );
  return {
    order,
    model,
    original,
    viewModel,
    diff,
    decorations,
    host,
    modelChange,
    finish,
    pending,
    update: () => update(),
    attach: () =>
      attachGitGutter(
        editor as unknown as monaco.editor.IStandaloneCodeEditor,
        '{"name":"before"}',
        vi.fn(),
      ),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Git gutter async diff lifecycle", () => {
  it("reproduces a late worker failure when only the widget is disposed", async () => {
    const state = setup();
    state.diff.dispose();
    state.original.dispose();
    state.model.dispose();
    state.finish();
    await expect(state.pending).rejects.toThrow("no diff result available");
  });

  it.each(["cleanup", "model disposal", "model switch"])(
    "cancels pending work before releasing models on %s",
    async (reason) => {
      const state = setup();
      const cleanup = state.attach();
      expect(state.diff.setModel).toHaveBeenCalledWith(state.viewModel);
      if (reason === "model disposal") state.model.dispose();
      else if (reason === "model switch") state.modelChange.fire();
      else cleanup();
      cleanup();
      expect(state.viewModel.dispose).toHaveBeenCalledTimes(1);
      expect(state.order.slice(0, 4)).toEqual([
        "detached",
        "cancelled",
        "editor disposed",
        "original disposed",
      ]);
      expect(state.original.dispose).toHaveBeenCalledTimes(1);
      expect(state.host.remove).toHaveBeenCalledTimes(1);
      state.update();
      expect(state.diff.getLineChanges).not.toHaveBeenCalled();
      state.model.dispose();
      state.finish();
      await expect(state.pending).resolves.toBeUndefined();
    },
  );

  it("explicitly cancels comparison view models on replacement", async () => {
    const state = setup();
    const detach = attachDiffModel(
      state.diff as unknown as monaco.editor.IStandaloneDiffEditor,
      {
        original: state.original,
        modified: state.model,
      } as unknown as monaco.editor.IDiffEditorModel,
    );
    detach();
    detach();
    state.model.dispose();
    state.finish();
    await expect(state.pending).resolves.toBeUndefined();
    expect(state.order).toEqual(["detached", "cancelled", "modified disposed"]);
    expect(state.viewModel.dispose).toHaveBeenCalledTimes(1);
  });
});
