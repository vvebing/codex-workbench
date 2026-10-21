import { expect, it } from "vitest";
import { CapabilityStore } from "../../src/lib/capabilities";
it("recognizes generated camel-case error variants without guessing missing methods", () => {
  const capabilities = new CapabilityStore();
  for (const [info, state] of [
    ["unauthorized", "authentication"],
    ["sandboxError", "policy"],
    [{ httpConnectionFailed: { httpStatusCode: 401 } }, "authentication"],
    [{ responseStreamConnectionFailed: { httpStatusCode: 403 } }, "policy"],
    [{ httpConnectionFailed: { httpStatusCode: 503 } }, "temporary"],
  ] as const) {
    capabilities.record("command/exec", {
      code: -32000,
      data: { codexErrorInfo: info },
    });
    expect(capabilities.getSnapshot()["command/exec"]?.state).toBe(state);
  }
});
