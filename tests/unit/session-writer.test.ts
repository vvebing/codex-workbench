import { afterEach, expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";
import { emptyState, reduceNotification } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(["active", "inProgress"] as const)(
  "only requests a writer on send for %s history and preserves occupied drafts until explicit retry",
  async (activity) => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const connection = runtime.connection.getSnapshot();
    const snapshot = vi
      .spyOn(runtime.connection, "getSnapshot")
      .mockReturnValue({ ...connection, status: "connected" });
    const historical: Thread = reduceNotification(emptyState(), {
      method: "thread/status/changed",
      params: {
        threadId: "external",
        status:
          activity === "active"
            ? { type: "active", activeFlags: [] }
            : { type: "idle" },
      },
    }).threads.external;
    historical.turns = [
      {
        id: "turn",
        rootTurnId: null,
        items: [],
        itemsView: "full",
        status: activity === "inProgress" ? "inProgress" : "completed",
        error: null,
        startedAt: 1,
        completedAt: activity === "inProgress" ? null : 2,
        durationMs: null,
      },
    ];
    let occupied = true;
    const request = vi
      .spyOn(runtime.connection.client, "request")
      .mockImplementation(async (...[method, params]) => {
        if (method === "thread/resume" && occupied)
          throw new Error("thread external already has an active writer");
        if (method === "thread/read" || method === "thread/resume")
          return {
            thread: {
              ...historical,
              id: (params as { threadId: string }).threadId,
            },
          };
        if (method === "turn/start")
          return { turn: { ...historical.turns[0], status: "inProgress" } };
        throw new Error(`Unexpected request: ${method}`);
      });
    const resumes = () =>
      request.mock.calls.filter(([method]) => method === "thread/resume");
    try {
      await runtime.sessions.open("external");
      expect(resumes()).toHaveLength(0);
      await runtime.sessions.restoreSelected();
      await vi.advanceTimersByTimeAsync(2000);
      expect(resumes()).toHaveLength(0);
      expect(runtime.sessions.getSnapshot().threadAccess.external).toBe(
        "viewing",
      );

      runtime.drafts.setText("external", "保留这份草稿");
      const draft = runtime.drafts.get("external");
      await expect(runtime.sendDraft("external")).rejects.toThrow("草稿已保留");
      expect(resumes()).toHaveLength(1);
      expect(runtime.sessions.getSnapshot().threadAccess.external).toBe(
        "occupied",
      );
      expect(runtime.drafts.get("external")).toEqual(draft);
      expect(runtime.queue.forThread("external").items).toHaveLength(0);

      await runtime.sessions.open("other");
      await runtime.sessions.open("external");
      await runtime.sessions.restoreSelected();
      await vi.advanceTimersByTimeAsync(6000);
      expect(resumes()).toHaveLength(1);
      expect(runtime.sessions.getSnapshot().threadAccess.external).toBe(
        "occupied",
      );
      expect(runtime.drafts.get("external")).toEqual(draft);
      expect(
        request.mock.calls.filter(([method]) => method.startsWith("turn/")),
      ).toHaveLength(0);

      occupied = false;
      historical.status = { type: "idle" };
      historical.turns[0].status = "completed";
      await runtime.sessions.restoreSelected();
      expect(resumes()).toHaveLength(1);
      await runtime.sendDraft("external");
      expect(resumes()).toHaveLength(2);
      expect(runtime.sessions.getSnapshot().threadAccess.external).toBe(
        "editable",
      );
      expect(runtime.drafts.get("external").text).toBe("");
      expect(
        request.mock.calls.filter(([method]) => method === "turn/start"),
      ).toHaveLength(1);
    } finally {
      snapshot.mockRestore();
      runtime.connection.disconnect();
    }
  },
);

it.each(["same", "replacement", "occupied"] as const)(
  "activates reopened running history before direct steering: %s",
  async (outcome) => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const historical: Thread = reduceNotification(emptyState(), {
      method: "thread/status/changed",
      params: {
        threadId: "running",
        status: { type: "active", activeFlags: [] },
      },
    }).threads.running;
    historical.turns = [
      {
        id: "original",
        rootTurnId: null,
        items: [],
        itemsView: "full",
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    ];
    let finishResume!: (value: { thread: Thread }) => void;
    const resumed = new Promise<{ thread: Thread }>((resolve) => {
      finishResume = resolve;
    });
    const request = vi
      .spyOn(runtime.connection.client, "request")
      .mockImplementation(async (...[method]) => {
        if (method === "thread/read") return { thread: historical };
        if (method === "thread/resume") {
          if (outcome === "occupied")
            throw new Error("thread running already has an active writer");
          return resumed;
        }
        if (method === "turn/steer") return {};
        throw new Error(`Unexpected request: ${method}`);
      });
    try {
      await runtime.sessions.open("running");
      expect(runtime.sessions.getSnapshot().threadAccess.running).toBe(
        "viewing",
      );
      if (outcome === "same") {
        runtime.drafts.setText("running", "shortcut guidance");
        const sending = runtime.sendDraft("running", {}, "steer");
        expect(
          request.mock.calls.some(([method]) => method === "turn/steer"),
        ).toBe(false);
        finishResume({ thread: historical });
        await sending;
        expect(request).toHaveBeenLastCalledWith(
          "turn/steer",
          expect.objectContaining({
            threadId: "running",
            expectedTurnId: "original",
            input: [
              { type: "text", text: "shortcut guidance", text_elements: [] },
            ],
          }),
        );
        expect(runtime.queue.forThread("running").items).toHaveLength(0);
      } else {
        const sending = runtime.sessions.steer(
          "running",
          [{ type: "text", text: "guidance", text_elements: [] }],
          "original",
        );
        if (outcome === "replacement") {
          finishResume({
            thread: {
              ...historical,
              turns: [
                { ...historical.turns[0], status: "completed", completedAt: 2 },
                { ...historical.turns[0], id: "replacement" },
              ],
            },
          });
          await expect(sending).rejects.toThrow("消息应加入队列");
        } else {
          await expect(sending).rejects.toThrow("草稿已保留");
        }
        expect(
          request.mock.calls.some(([method]) => method.startsWith("turn/")),
        ).toBe(false);
      }
      expect(
        request.mock.calls.filter(([method]) => method === "thread/resume"),
      ).toHaveLength(1);
    } finally {
      runtime.connection.disconnect();
    }
  },
);
