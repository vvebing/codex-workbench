import { expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";
import { hasTransientData, protectPageExit } from "../../src/lib/page-exit";

it("protects a hidden file draft and releases the listener after discarding it", async () => {
  const runtime = createRuntime();
  const state = runtime.connection.getSnapshot();
  vi.spyOn(runtime.connection, "getSnapshot").mockReturnValue({
    ...state,
    status: "connected",
    url: "ws://files",
  });
  vi.spyOn(runtime.connection.client, "request").mockImplementation(
    async (method) =>
      method === "fs/readFile"
        ? { dataBase64: btoa("original") }
        : ({} as never),
  );
  const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const dispose = protectPageExit(
    () => [runtime],
    () => () => {},
    target,
  );
  await runtime.files.open({ path: "/project/file.txt" });
  const id = runtime.files.getSnapshot().activeId!;
  expect(target.addEventListener).not.toHaveBeenCalled();
  runtime.files.setText(id, "unsaved");
  runtime.files.setVisible(false);
  expect(hasTransientData([runtime])).toBe(true);
  expect(target.addEventListener).toHaveBeenCalledOnce();
  runtime.files.close(id);
  expect(hasTransientData([runtime])).toBe(false);
  expect(target.removeEventListener).toHaveBeenCalledOnce();
  dispose();
  vi.restoreAllMocks();
});

it("protects drafts in background sessions and inactive draft scopes, including image-only drafts", () => {
  const runtime = createRuntime();
  expect(hasTransientData([runtime])).toBe(false);
  runtime.drafts.activateScope("first");
  runtime.drafts.setText("background", "unsent");
  runtime.drafts.activateScope("second");
  expect(hasTransientData([runtime])).toBe(true);
  runtime.drafts.activateScope("first");
  runtime.drafts.remove("background");
  expect(hasTransientData([runtime])).toBe(false);
  runtime.drafts.addImage("background", {
    id: "image",
    name: "image.png",
    url: "data:image/png;base64,test",
  });
  expect(hasTransientData([runtime])).toBe(true);
});

it("attaches and removes the browser confirmation dynamically across environments", () => {
  const first = createRuntime();
  const second = createRuntime();
  let runtimes = [first];
  let environmentsChanged = () => {};
  const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const close = protectPageExit(
    () => runtimes,
    (listener) => {
      environmentsChanged = listener;
      return () => {};
    },
    target,
  );
  expect(target.addEventListener).not.toHaveBeenCalled();
  runtimes = [first, second];
  environmentsChanged();
  second.drafts.setText("hidden", "draft");
  expect(target.addEventListener).toHaveBeenCalledTimes(1);
  const handler = target.addEventListener.mock.calls[0][1] as (
    event: BeforeUnloadEvent,
  ) => void;
  const event = { preventDefault: vi.fn(), returnValue: undefined };
  handler(event as unknown as BeforeUnloadEvent);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.returnValue).toBe("");
  second.drafts.remove("hidden");
  expect(target.removeEventListener).toHaveBeenCalledWith(
    "beforeunload",
    handler,
  );
  event.preventDefault.mockClear();
  handler(event as unknown as BeforeUnloadEvent);
  expect(event.preventDefault).not.toHaveBeenCalled();
  close();
});

it("keeps the confirmation during submission even when the editor is cleared", async () => {
  const runtime = createRuntime();
  let resolve!: (id: string) => void;
  const send = vi.spyOn(runtime.sessions, "send").mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  runtime.drafts.setText("a", "being sent");
  const pending = runtime.sendDraft("a");
  runtime.drafts.remove("a");
  expect(hasTransientData([runtime])).toBe(true);
  resolve("a");
  await pending;
  expect(hasTransientData([runtime])).toBe(false);
  send.mockRestore();
});
