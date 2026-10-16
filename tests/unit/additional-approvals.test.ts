import { describe, expect, it, vi } from "vitest";
import {
  RequestsStore,
  validApprovalResponse,
} from "../../src/features/requests/store";
import {
  fieldError,
  fieldConstraints,
  permissionSubset,
  safeElicitationUrl,
  supportedForm,
  validFormContent,
} from "../../src/features/approvals/validation";
import type { RpcNotification, RpcRequest } from "../../src/lib/rpc";
import type { ConnectionStore } from "../../src/features/connection/store";

const permissions: RpcRequest = {
  id: 1,
  method: "item/permissions/requestApproval",
  params: {
    threadId: "child",
    turnId: "turn",
    itemId: "item",
    environmentId: null,
    startedAtMs: 0,
    cwd: "/work",
    reason: null,
    permissions: {
      network: { enabled: true },
      fileSystem: {
        read: ["/work"],
        write: null,
        entries: [{ path: { type: "path", path: "/work" }, access: "read" }],
      },
    },
  },
} as RpcRequest;
const schema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const, minLength: 2 },
    age: { type: "integer" as const, minimum: 18 },
    approved: { type: "boolean" as const },
    colors: {
      type: "array" as const,
      items: { type: "string" as const, enum: ["red", "blue"] },
      minItems: 1n,
    },
  },
  required: ["name", "approved"],
};
const form: RpcRequest = {
  id: "form",
  method: "mcpServer/elicitation/request",
  params: {
    threadId: "child",
    turnId: null,
    serverName: "mcp",
    mode: "form",
    _meta: null,
    message: "Please answer",
    requestedSchema: schema,
  },
};
describe("permission and MCP approval validation", () => {
  it("explains constraints and permits empty strings as actual values", () => {
    expect(fieldConstraints({ type: "string", minLength: 3 })).toBe(
      "至少 3 个字符",
    );
    expect(fieldError({ type: "string", minLength: 3 }, "a", true)).toContain(
      "至少 3 个字符",
    );
    expect(fieldError({ type: "string" }, undefined, true)).toContain("必填");
    expect(
      validFormContent(
        {
          type: "object",
          properties: {
            choice: { type: "string", enum: [""] },
            text: { type: "string" },
          },
          required: ["choice", "text"],
        },
        { choice: "", text: "" },
      ),
    ).toBe(true);
    expect(
      supportedForm({
        type: "object",
        properties: {
          choices: {
            type: "array",
            items: { anyOf: [{ const: "x", pattern: "a" }] },
          },
        },
      }),
    ).toBe(false);
  });

  it("permits exact subsets with explicit turn/session scope and rejects expanded grants", () => {
    expect(
      validApprovalResponse(permissions, { permissions: {}, scope: "turn" }),
    ).toBe(true);
    expect(
      validApprovalResponse(permissions, {
        permissions: { network: { enabled: true } },
        scope: "session",
      }),
    ).toBe(true);
    expect(
      validApprovalResponse(permissions, {
        permissions: { fileSystem: { read: ["/"] } },
        scope: "turn",
      }),
    ).toBe(false);
    expect(
      validApprovalResponse(permissions, { permissions: {}, scope: "forever" }),
    ).toBe(false);
    expect(
      permissionSubset({ network: { enabled: true } }, { network: null }),
    ).toBe(false);
    expect(
      permissionSubset(
        { fileSystem: { entries: [{ path: "extra", access: "write" }] } },
        permissions.params,
      ),
    ).toBe(false);
  });
  it("validates primitive fields, required values and selection limits before acceptance", () => {
    expect(supportedForm(schema)).toBe(true);
    expect(
      validFormContent(
        {
          type: "object",
          properties: {
            choices: {
              type: "array",
              items: { anyOf: [{ const: "a", title: "A" }] },
            },
          },
        },
        { choices: ["a"] },
      ),
    ).toBe(true);
    const content = { name: "Ada", approved: false, age: 20, colors: ["red"] };
    expect(validFormContent(schema, content)).toBe(true);
    for (const invalid of [
      { ...content, age: 18.5 },
      { ...content, name: "A" },
      { ...content, colors: ["green"] },
      { ...content, colors: ["red", "red"] },
      { name: "Ada" },
      { ...content, surprise: true },
    ])
      expect(validFormContent(schema, invalid)).toBe(false);
    expect(
      validApprovalResponse(form, { action: "accept", content, _meta: null }),
    ).toBe(true);
    expect(
      validApprovalResponse(form, {
        action: "decline",
        content: null,
        _meta: null,
      }),
    ).toBe(true);
    expect(
      validApprovalResponse(form, { action: "cancel", content, _meta: null }),
    ).toBe(false);
  });
  it("fails unsupported schemas safely and blocks unsafe URL confirmation", () => {
    expect(
      supportedForm({
        type: "object",
        properties: { nested: { type: "object" } },
      }),
    ).toBe(false);
    expect(
      supportedForm({
        type: "object",
        properties: { name: { type: "string", pattern: "^x" } },
      }),
    ).toBe(false);
    expect(safeElicitationUrl("javascript:alert(1)")).toBeUndefined();
    const credentialUrl = new URL("https://example.com");
    credentialUrl.username = "fictional-user";
    credentialUrl.password = "fictional-password";
    expect(safeElicitationUrl(credentialUrl.href)).toBeUndefined();
    expect(safeElicitationUrl("https://example.com/confirm")).toBe(
      "https://example.com/confirm",
    );
    const url: RpcRequest = {
      id: 2,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "child",
        turnId: "turn",
        serverName: "mcp",
        mode: "url",
        _meta: null,
        message: "Confirm",
        url: "javascript:alert(1)",
        elicitationId: "e",
      },
    };
    expect(
      validApprovalResponse(url, {
        action: "accept",
        content: null,
        _meta: null,
      }),
    ).toBe(false);
    expect(
      validApprovalResponse(url, {
        action: "cancel",
        content: null,
        _meta: null,
      }),
    ).toBe(true);
  });
});
it("queues child requests, blocks invalid replies and handles resolved/disconnect lifecycle", () => {
  let onRequest!: (request: RpcRequest) => void;
  let onNotification!: (event: RpcNotification) => void;
  let onConnection!: () => void;
  let epoch = 1;
  const respond = vi.fn();
  const respondError = vi.fn();
  const connection = {
    client: {
      onRequest: (callback: typeof onRequest) => {
        onRequest = callback;
      },
      onNotification: (callback: typeof onNotification) => {
        onNotification = callback;
      },
      respond,
      respondError,
    },
    getSnapshot: () => ({ epoch }),
    subscribe: (callback: () => void) => {
      onConnection = callback;
    },
  } as unknown as ConnectionStore;
  const store = new RequestsStore(connection);
  onRequest(permissions);
  onRequest(form);
  expect(store.forThread("child")).toHaveLength(2);
  expect(respondError).not.toHaveBeenCalled();
  expect(
    store.respond(1, {
      permissions: { network: { enabled: false } },
      scope: "turn",
    }),
  ).toBe(false);
  expect(respond).not.toHaveBeenCalled();
  expect(store.respond(1, { permissions: {}, scope: "turn" })).toBe(true);
  expect(store.respond(1, { permissions: {}, scope: "turn" })).toBe(false);
  onNotification({
    method: "serverRequest/resolved",
    params: { threadId: "child", requestId: "form" },
  });
  onRequest(form);
  expect(store.getSnapshot().pending).toHaveLength(0);
  epoch++;
  onConnection();
  onRequest(form);
  expect(store.getSnapshot().pending).toHaveLength(1);
  epoch++;
  onConnection();
  expect(store.getSnapshot().pending).toHaveLength(0);
});
