import { expect, it } from "vitest";
import {
  initialState,
  responseSettings,
} from "../../src/features/sessions/state";
import type { Thread } from "../../src/generated/v2/Thread";

const thread = { id: "thread" } as Thread;
it("caches only supplied start/resume/fork response settings without inventing complete settings", () => {
  const state = initialState();
  const next = responseSettings(state, state.threadSettings, {
    thread,
    approvalPolicy: "on-request",
    serviceTier: null,
  });
  expect(next.threadSettings.thread).toEqual({
    approvalPolicy: "on-request",
    serviceTier: null,
  });
  const refreshed = responseSettings(next, next.threadSettings, {
    thread,
    serviceTier: "priority",
  });
  expect(refreshed.threadSettings.thread).toEqual({
    approvalPolicy: "on-request",
    serviceTier: "priority",
  });
  expect(initialState().threadSettings).toEqual({});
});
it("never lets an older response overwrite settings received during its request", () => {
  const before = initialState();
  const notified = {
    ...before,
    threadSettings: {
      thread: { approvalPolicy: "never" as const, serviceTier: "priority" },
    },
  };
  expect(
    responseSettings(notified, before.threadSettings, {
      thread,
      approvalPolicy: "on-request",
      serviceTier: null,
    }),
  ).toBe(notified);
});
it("allows a later response to update previously confirmed settings", () => {
  const state = {
    ...initialState(),
    threadSettings: { thread: { serviceTier: "priority" } },
  };
  expect(
    responseSettings(state, state.threadSettings, { thread, serviceTier: null })
      .threadSettings.thread,
  ).toEqual({ serviceTier: null });
});
