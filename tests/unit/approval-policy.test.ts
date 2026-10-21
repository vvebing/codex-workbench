import { expect, it, vi } from "vitest";
import { approvalOptions } from "../../src/features/composer/approval-policy";
import { createRuntime } from "../../src/lib/runtime";

it("omits approval policy when inheriting and preserves explicit policies", () => {
  expect(approvalOptions()).toEqual({});
  expect(approvalOptions("inherit")).toEqual({});
  for (const policy of ["never", "on-request", "untrusted"] as const)
    expect(approvalOptions(policy)).toEqual({ approvalPolicy: policy });
});

it("submits inherited and explicit approval choices without injecting a default", async () => {
  const runtime = createRuntime();
  const send = vi.spyOn(runtime.sessions, "send").mockResolvedValue("thread");
  try {
    runtime.drafts.setText("thread", "inherit");
    await runtime.sendDraft("thread", approvalOptions());
    expect(send.mock.calls[0][2]).not.toHaveProperty("approvalPolicy");
    runtime.drafts.setText("thread", "explicit");
    await runtime.sendDraft("thread", approvalOptions("never"));
    expect(send.mock.calls[1][2]).toMatchObject({ approvalPolicy: "never" });
  } finally {
    send.mockRestore();
    runtime.connection.disconnect();
  }
});
