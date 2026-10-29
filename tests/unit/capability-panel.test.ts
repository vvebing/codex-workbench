import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CapabilityPanel } from "../../src/features/settings/CapabilityPanel";
import { EnvironmentTools } from "../../src/features/settings/EnvironmentTools";
import { ConnectionStore } from "../../src/features/connection/store";
import { RpcError } from "../../src/lib/rpc";
vi.mock("../../src/components/hooks", async (original) => ({
  ...(await original<object>()),
  useStore: (store: { getSnapshot: () => unknown }) => store.getSnapshot(),
}));
it("renders observed support, timestamp, version, unknowns and explicit reset actions", () => {
  const connection = new ConnectionStore();
  connection.client.capabilities.record(
    "skills/list",
    new RpcError("missing", -32601),
  );
  const html = renderToStaticMarkup(
    createElement(CapabilityPanel, { connection }),
  );
  expect(html).toContain("服务器版本：未知");
  expect(html).toContain("服务端未提供此接口");
  expect(html).toContain("未知（尚无调用记录）");
  expect(html).toContain("清除记录以重新验证 skills/list");
  expect(html).toMatch(/datetime=/i);
});
it("disables only unsupported action methods, not authentication errors", () => {
  const connection = new ConnectionStore();
  vi.spyOn(connection, "getSnapshot").mockReturnValue({
    ...connection.getSnapshot(),
    status: "connected",
  });
  connection.client.capabilities.record(
    "config/mcpServer/reload",
    new RpcError("missing", -32601),
  );
  let html = renderToStaticMarkup(
    createElement(EnvironmentTools, { connection, group: "integrations" }),
  );
  expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>重新加载 MCP 配置/);
  connection.client.capabilities.record(
    "config/mcpServer/reload",
    new RpcError("login", 401),
  );
  html = renderToStaticMarkup(
    createElement(EnvironmentTools, { connection, group: "integrations" }),
  );
  expect(html).toMatch(
    /<button(?![^>]*\sdisabled(?:\s|=|>))[^>]*>重新加载 MCP 配置/,
  );
});
