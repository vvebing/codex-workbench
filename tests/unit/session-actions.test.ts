import { afterEach, expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";
import { emptyDraft } from "../../src/features/composer/drafts";
import {
  draftHasContent,
  SessionActionsStore,
} from "../../src/features/navigation/session-actions";

afterEach(() => vi.restoreAllMocks());
function setup(selectedId: string | null = "thread") {
  const runtime = createRuntime();
  const connection = {
    ...runtime.connection.getSnapshot(),
    status: "connected" as const,
    url: "ws://source:4501",
    scope: 3,
  };
  vi.spyOn(runtime.connection, "getSnapshot").mockReturnValue(connection);
  const state = { ...runtime.sessions.getSnapshot(), selectedId };
  vi.spyOn(runtime.sessions, "getSnapshot").mockImplementation(() => state);
  const archive = vi
    .spyOn(runtime.sessions, "archive")
    .mockImplementation(async () => {
      if (state.selectedId === "thread") state.selectedId = null;
    });
  const refresh = vi.spyOn(runtime.sessions, "refresh").mockResolvedValue();
  const open = vi.spyOn(runtime.sessions, "open").mockResolvedValue();
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockResolvedValue({});
  return {
    runtime,
    state,
    connection,
    archive,
    refresh,
    open,
    request,
    actions: new SessionActionsStore(),
  };
}
it("keeps Undo available after the originating session row disappears and restores its selection", async () => {
  const { actions, runtime, state, request, refresh, open } = setup();
  await actions.archive(runtime, "thread", "A task");
  expect(state.selectedId).toBeNull();
  expect(actions.getSnapshot().notices).toHaveLength(1);
  await actions.undo(actions.getSnapshot().notices[0].id);
  expect(request).toHaveBeenCalledWith("thread/unarchive", {
    threadId: "thread",
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith("thread");
  expect(actions.getSnapshot().notices).toEqual([]);
});
it("does not navigate away from a session opened after archiving", async () => {
  const { actions, runtime, state, open } = setup();
  await actions.archive(runtime, "thread", "A task");
  state.selectedId = "another-thread";
  await actions.undo(actions.getSnapshot().notices[0].id);
  expect(open).not.toHaveBeenCalled();
});
it("keeps a failed Undo actionable without falsely reporting restoration", async () => {
  const { actions, runtime, request } = setup();
  await actions.archive(runtime, "thread", "A task");
  request.mockRejectedValueOnce(Error("network lost"));
  const id = actions.getSnapshot().notices[0].id;
  await actions.undo(id);
  expect(actions.getSnapshot().notices[0]).toMatchObject({
    busy: false,
    restored: false,
    error: "network lost",
  });
  await actions.undo(id);
  expect(actions.getSnapshot().notices).toEqual([]);
});
it("does not create an Undo notice for failed archiving or restore against a replaced endpoint", async () => {
  const { actions, runtime, connection, archive, request } = setup();
  archive.mockRejectedValueOnce(Error("archive refused"));
  await expect(actions.archive(runtime, "thread", "A task")).rejects.toThrow(
    "archive refused",
  );
  expect(actions.getSnapshot().notices).toEqual([]);
  await actions.archive(runtime, "thread", "A task");
  connection.url = "ws://different:4501";
  connection.scope++;
  await actions.undo(actions.getSnapshot().notices[0].id);
  expect(request).not.toHaveBeenCalled();
  expect(actions.getSnapshot().notices[0].error).toContain(
    "来源环境地址已更改",
  );
});
it("records successful restoration even if refreshing fails, preventing duplicate mutations", async () => {
  const { actions, runtime, request, refresh } = setup();
  await actions.archive(runtime, "thread", "A task");
  refresh.mockRejectedValueOnce(Error("refresh failed"));
  const id = actions.getSnapshot().notices[0].id;
  await actions.undo(id);
  expect(actions.getSnapshot().notices[0]).toMatchObject({
    restored: true,
    error: "refresh failed",
  });
  await actions.undo(id);
  expect(request).toHaveBeenCalledOnce();
});
it("requires draft deletion confirmation for text, attachments, and selected skills", () => {
  expect(draftHasContent(emptyDraft())).toBe(false);
  expect(draftHasContent({ ...emptyDraft(), text: "  " })).toBe(false);
  expect(draftHasContent({ ...emptyDraft(), text: "unfinished" })).toBe(true);
  expect(
    draftHasContent({
      ...emptyDraft(),
      images: [{ id: "img", name: "image", url: "blob:image" }],
    }),
  ).toBe(true);
  expect(
    draftHasContent({
      ...emptyDraft(),
      skills: [{ name: "skill", path: "/skill" }],
    }),
  ).toBe(true);
});

it("does not open the archived thread on a replacement endpoint after a delayed refresh", async () => {
  const { actions, runtime, connection, refresh, open, request } = setup();
  await actions.archive(runtime, "thread", "A task");
  let finishRefresh!: () => void;
  refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      }),
  );
  const id = actions.getSnapshot().notices[0].id;
  const undo = actions.undo(id);
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  connection.url = "ws://replacement:4501";
  connection.scope++;
  finishRefresh();
  await undo;
  expect(open).not.toHaveBeenCalled();
  expect(actions.getSnapshot().notices[0]).toMatchObject({
    restored: true,
    busy: false,
    error: "来源环境地址已更改，请在原环境查看恢复结果。",
  });
  await actions.undo(id);
  expect(request).toHaveBeenCalledOnce();
});
