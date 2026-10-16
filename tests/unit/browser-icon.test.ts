import { expect, it } from "vitest";
import {
  browserIconState,
  hasExecutingSession,
} from "../../src/features/navigation/browser-icon";
import { initialState } from "../../src/features/sessions/state";
import type { Environment } from "../../src/features/connection/environments";
import { placeholderThread } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";

function environment(
  status: string,
  threads: Thread[],
  unreadCompleted: Record<string, string> = {},
): Environment {
  return {
    runtime: {
      connection: { getSnapshot: () => ({ status }) },
      sessions: {
        getSnapshot: () => ({
          ...initialState(),
          unreadCompleted,
          threads: Object.fromEntries(
            threads.map((thread) => [thread.id, thread]),
          ),
        }),
      },
    },
  } as Environment;
}

it("includes executing background sessions in another connected environment", () => {
  const idle = placeholderThread("selected");
  const running: Thread = {
    ...placeholderThread("background"),
    status: { type: "active", activeFlags: [] },
  };
  expect(
    hasExecutingSession([
      environment("connected", [idle]),
      environment("connected", [running]),
    ]),
  ).toBe(true);
  expect(hasExecutingSession([environment("connected", [idle])])).toBe(false);
  expect(hasExecutingSession([])).toBe(false);
});

it("prioritizes unread completion over work still running in another environment", () => {
  const done = environment("connected", [placeholderThread("done")], {
    done: "turn",
  });
  const running = environment("connected", [
    {
      ...placeholderThread("running"),
      status: { type: "active", activeFlags: [] },
    },
  ]);
  expect(browserIconState([done, running])).toBe("completed");
  expect(browserIconState([running])).toBe("running");
  expect(
    browserIconState([environment("connected", [placeholderThread("read")])]),
  ).toBe("idle");
  expect(browserIconState([])).toBe("idle");
});

it("retains known unread completion after disconnect and ignores child or missing results", () => {
  expect(
    browserIconState([
      environment("disconnected", [placeholderThread("done")], {
        done: "turn",
      }),
    ]),
  ).toBe("completed");
  expect(
    browserIconState([
      environment(
        "connected",
        [{ ...placeholderThread("child"), parentThreadId: "parent" }],
        { child: "turn", missing: "turn" },
      ),
    ]),
  ).toBe("idle");
});

it("ignores stale running snapshots after disconnection", () => {
  const running: Thread = {
    ...placeholderThread("background"),
    status: { type: "active", activeFlags: [] },
  };
  expect(hasExecutingSession([environment("disconnected", [running])])).toBe(
    false,
  );
  expect(hasExecutingSession([environment("connecting", [running])])).toBe(
    false,
  );
});
