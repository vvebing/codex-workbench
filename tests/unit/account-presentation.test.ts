import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountStatus } from "../../src/features/connection/AccountStatus";
import { ConnectionStore } from "../../src/features/connection/store";
import { planLabel } from "../../src/features/connection/account-presentation";

vi.mock("../../src/components/hooks", async (original) => ({
  ...(await original<object>()),
  useStore: (store: { getSnapshot: () => unknown }) => store.getSnapshot(),
}));

describe("account provider and workspace presentation", () => {
  it("shows Google Cloud in the summary and account details instead of Bedrock", async () => {
    const connection = new ConnectionStore();
    vi.spyOn(connection.client, "request").mockResolvedValue({
      account: { type: "gcp" },
      requiresOpenaiAuth: false,
    });
    await connection.loadAccount();
    expect(connection.getSnapshot().account).toBe("Google Cloud");
    const html = renderToStaticMarkup(
      createElement(AccountStatus, { connection }),
    );
    expect(html).toContain("Google Cloud");
    expect(html).not.toContain("Amazon Bedrock");
  });

  it("identifies the selected ChatGPT workspace and preserves unfamiliar plan values", async () => {
    const connection = new ConnectionStore();
    vi.spyOn(connection.client, "request").mockResolvedValue({
      account: {
        type: "chatgpt",
        email: "person@example.com",
        planType: "sci_plus",
        workspaceName: "Research workspace",
      },
      requiresOpenaiAuth: true,
    });
    await connection.loadAccount();
    const html = renderToStaticMarkup(
      createElement(AccountStatus, { connection }),
    );
    expect(html).toContain("person@example.com");
    expect(html).toContain("Research workspace");
    expect(html).toContain("sci_plus");
    expect(planLabel("sci")).toBe("sci");
  });

  it("does not invent a workspace for older account responses", async () => {
    const connection = new ConnectionStore();
    vi.spyOn(connection.client, "request").mockResolvedValue({
      account: { type: "chatgpt", email: null, planType: "plus" },
      requiresOpenaiAuth: true,
    });
    await connection.loadAccount();
    const html = renderToStaticMarkup(
      createElement(AccountStatus, { connection }),
    );
    expect(html).toContain("ChatGPT");
    expect(html).not.toContain('<dt class="text-muted">工作区</dt>');
  });
});
