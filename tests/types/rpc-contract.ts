import type { CodexClient } from "../../src/lib/rpc";

// Compiled by typecheck; never sends requests. Each expectation must remain an error.
export function checkRpcContract(client: CodexClient) {
  void client.request("thread/list", { limit: 10 });
  void client.request("configRequirements/read");
  void client.request("turn/start", { threadId: "t", input: [] });
  // @ts-expect-error unknown method
  void client.request("thread/lits", {});
  // @ts-expect-error params itself is required even when every field is optional
  void client.request("thread/list");
  // @ts-expect-error initialize belongs exclusively to the connection handshake
  void client.request("initialize", {});
  // @ts-expect-error required input must not be omitted
  void client.request("turn/start", { threadId: "t" });
  // @ts-expect-error parameters from another method are invalid
  void client.request("fs/readFile", { threadId: "t" });
  void client.request("thread/metadata/update", {
    threadId: "t",
    // @ts-expect-error the checked-in protocol has no persistent pin field
    isPinned: true,
  });
  // @ts-expect-error parameterless endpoints must omit params
  void client.request("account/logout", {});
}
