import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftsStore } from "../../src/features/composer/drafts";
import {
  readDrafts,
  writeLocalDraftData,
} from "../../src/features/composer/draft-storage";
import {
  saveLocalSessions,
  restoreLocalSessions,
} from "../../src/features/sessions/draft-storage";
import { createDraft, initialState } from "../../src/features/sessions/state";
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("restores text and structured references, isolates scopes, and clears sent revisions", () => {
  const drafts = new DraftsStore();
  drafts.activateScope("environment+endpoint");
  drafts.setText("thread", "hello");
  drafts.addApp("thread", { id: "notes", name: "Notes" });
  const fresh = new DraftsStore();
  fresh.activateScope("other endpoint");
  expect(fresh.get("thread").text).toBe("");
  fresh.activateScope("environment+endpoint");
  expect(fresh.get("thread").document).toEqual(drafts.get("thread").document);
  expect(fresh.get("thread").text).toContain("hello");
  fresh.clearIfRevision("thread", fresh.get("thread").revision);
  expect(readDrafts("environment+endpoint")).toEqual({});
});
it("retains an explicit missing attachment warning across repeated restores without storing image bytes", () => {
  const drafts = new DraftsStore();
  drafts.activateScope("scope");
  drafts.addImage("thread", {
    id: "image",
    name: "private",
    url: "data:image/png;base64,secret",
  });
  const fresh = new DraftsStore();
  fresh.activateScope("scope");
  expect(fresh.get("thread").images).toEqual([]);
  expect(fresh.get("thread").restored?.unavailableAttachments).toBe(true);
  expect(readDrafts("scope").thread.restored?.unavailableAttachments).toBe(
    true,
  );
  expect([...storage.values()].join()).not.toContain("secret");
  fresh.remove("thread");
  expect(readDrafts("scope")).toEqual({});
});
it("restores local session identity and selection but excludes configuration credentials", () => {
  const state = createDraft(initialState(), {
    cwd: "/project",
    model: "model",
    config: { token: "secret" },
  });
  state.threads[state.selectedId!].name = "Named draft";
  state.threads[state.selectedId!].createdAt = 123;
  saveLocalSessions("scope", state);
  const fresh = restoreLocalSessions("scope", initialState());
  expect(fresh.selectedId).toBe(state.selectedId);
  expect(fresh.threads[state.selectedId!].name).toBe("Named draft");
  expect(fresh.threads[state.selectedId!].createdAt).toBe(123);
  expect(fresh.localDrafts[state.selectedId!].options).toEqual({
    cwd: "/project",
    model: "model",
  });
  expect(fresh.threads[state.selectedId!].turns).toEqual([]);
  expect([...storage.values()].join()).not.toContain("secret");
  expect(restoreLocalSessions("other", initialState()).localDrafts).toEqual({});
  saveLocalSessions("scope", initialState());
  expect(restoreLocalSessions("scope", initialState()).localDrafts).toEqual({});
});
it("degrades safely on invalid versions, oversized values and unavailable storage", () => {
  storage.set(
    "codex-workbench.drafts:scope",
    JSON.stringify({ version: 99, value: { thread: { text: "bad" } } }),
  );
  expect(readDrafts("scope")).toEqual({});
  writeLocalDraftData("drafts", "scope", {
    thread: { text: "x".repeat(2_000_001) },
  });
  expect(readDrafts("scope")).toEqual({});
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("quota");
    },
  });
  const drafts = new DraftsStore();
  drafts.activateScope("scope");
  drafts.setText("thread", "still editable");
  expect(drafts.get("thread").text).toBe("still editable");
  expect(drafts.get("thread").persistenceWarning).toContain("仅保留在当前页面");
});

it("rebuilds an offline runtime with selected unsent session and never sends recovered content", async () => {
  const { createRuntime } = await import("../../src/lib/runtime");
  const first = createRuntime({}, "environment", "ws://server:4501");
  const local = await first.sessions.create({ cwd: "/project" });
  first.drafts.setText(local.id, "unsent");
  await first.sessions.rename(local.id, "Recovered name");
  const fresh = createRuntime({}, "environment", "ws://server:4501/");
  const send = vi.spyOn(fresh.connection.client, "request");
  expect(fresh.sessions.getSnapshot().selectedId).toBe(local.id);
  expect(fresh.drafts.get(local.id).text).toBe("unsent");
  expect(fresh.sessions.getSnapshot().threads[local.id].name).toBe(
    "Recovered name",
  );
  expect(send).not.toHaveBeenCalled();
  expect(
    createRuntime({}, "other", "ws://server:4501").sessions.getSnapshot()
      .localDrafts,
  ).toEqual({});
  expect(
    createRuntime({}, "environment", "ws://other:4501").drafts.get(local.id)
      .text,
  ).toBe("");
  fresh.discardDraft(local.id);
  const deleted = createRuntime({}, "environment", "ws://server:4501");
  expect(deleted.sessions.getSnapshot().localDrafts).toEqual({});
  expect(deleted.drafts.get(local.id).text).toBe("");
});
