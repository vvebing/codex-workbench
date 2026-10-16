import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileWorkspaceStore } from "../../src/features/files/store";
import {
  readGitComparison,
  type GitComparisonRequest,
} from "../../src/features/files/git-content";
import type { ConnectionStore } from "../../src/features/connection/store";

vi.mock("../../src/features/files/git-content", () => ({
  readGitComparison: vi.fn(),
}));
const snapshot = (request: GitComparisonRequest) => ({
  path: `/repo/${request.path}`,
  modified: request.path,
  comparison: {
    request,
    original: "baseline",
    originalLabel: "暂存区",
    modifiedLabel: "磁盘文件",
    canOpen: true,
  },
});
const diff = (path: string): GitComparisonRequest => ({
  cwd: "/repo",
  path,
  group: "unstaged",
});
function setup() {
  const connection = {
    getSnapshot: () => ({ url: "ws://a", epoch: 1, status: "connected" }),
    subscribe: () => () => {},
    client: {
      request: vi.fn(async () => ({ dataBase64: btoa("original") })),
      onNotification: () => () => {},
    },
  } as unknown as ConnectionStore;
  return new FileWorkspaceStore(connection);
}
describe("Git preview tabs", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    vi.mocked(readGitComparison)
      .mockReset()
      .mockImplementation(async (_client, request) => snapshot(request));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it("replaces only the preview and preserves pinned tabs and dirty working buffers", async () => {
    const files = setup();
    await files.open({ path: "/repo/draft.txt" });
    const working = files.getSnapshot().activeId!;
    files.setText(working, "draft");
    await files.openGitDiff(diff("a.txt"));
    await files.openGitDiff(diff("b.txt"));
    expect(files.getSnapshot().documents.map((doc) => doc.path)).toEqual([
      "/repo/draft.txt",
      "/repo/b.txt",
    ]);
    const pinned = files.getSnapshot().activeId!;
    files.pin(pinned);
    await files.openGitDiff(diff("c.txt"));
    expect(files.getSnapshot().documents).toHaveLength(3);
    expect(
      files.getSnapshot().documents.find((doc) => doc.id === working),
    ).toMatchObject({ text: "draft", dirty: true, preview: false });
    await files.openGitDiff(diff("b.txt"));
    expect(
      files.getSnapshot().documents.find((doc) => doc.id === pinned)?.preview,
    ).toBe(false);
    await files.reload(pinned);
    expect(
      files.getSnapshot().documents.find((doc) => doc.id === pinned)?.preview,
    ).toBe(false);
  });
  it("does not let a replaced preview's late response overwrite the new preview", async () => {
    const files = setup();
    let finish!: (result: ReturnType<typeof snapshot>) => void;
    vi.mocked(readGitComparison).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = files.openGitDiff(diff("a.txt"));
    await files.openGitDiff(diff("b.txt"));
    finish(snapshot(diff("a.txt")));
    await first;
    expect(files.getSnapshot().documents).toHaveLength(1);
    expect(files.getSnapshot().documents[0]).toMatchObject({
      path: "/repo/b.txt",
      text: "b.txt",
      preview: true,
      loading: false,
    });
  });
  it("reselects a snapshot without refetching and keeps one preview when reopening its old path", async () => {
    const files = setup();
    await files.openGitDiff(diff("a.txt"));
    await files.openGitDiff(diff("a.txt"));
    expect(readGitComparison).toHaveBeenCalledTimes(1);
    await files.openGitDiff(diff("b.txt"));
    await files.openGitDiff(diff("a.txt"));
    expect(files.getSnapshot().documents).toHaveLength(1);
    expect(files.getSnapshot().documents[0].path).toBe("/repo/a.txt");
  });
});
