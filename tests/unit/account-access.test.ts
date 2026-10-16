import { describe, expect, it, vi } from "vitest";
import { ConnectionStore } from "../../src/features/connection/store";
import type { RpcNotification } from "../../src/lib/rpc";

function setup() {
  const connection = new ConnectionStore();
  const client = connection.client as unknown as {
    setStatus(status: string): void;
    notifications: Set<(event: RpcNotification) => void>;
  };
  client.setStatus("connected");
  const request = vi.spyOn(connection.client, "request").mockResolvedValue({});
  vi.spyOn(connection, "loadAccount").mockResolvedValue();
  vi.spyOn(connection, "loadRateLimits").mockResolvedValue();
  return {
    connection,
    request,
    access: connection.accountAccess,
    notify: (event: RpcNotification) =>
      client.notifications.forEach((listener) => listener(event)),
  };
}
const login = {
  type: "chatgptDeviceCode",
  loginId: "login-1",
  verificationUrl: "https://auth.openai.com",
  userCode: "ABCD",
};
const completed = (loginId: string, success = true): RpcNotification => ({
  method: "account/login/completed",
  params: {
    loginId,
    success,
    error: success ? null : "Denied",
    onboardingEntrypoint: null,
  },
});
describe("account access", () => {
  it("correlates login completion and refreshes account", async () => {
    const { access, request, notify, connection } = setup();
    request.mockResolvedValueOnce(login);
    await access.start({ type: "chatgptDeviceCode" });
    notify(completed("other"));
    expect(access.getSnapshot().login).toEqual(login);
    notify(completed("login-1"));
    expect(access.getSnapshot()).toMatchObject({
      login: null,
      message: "登录成功",
    });
    expect(connection.loadAccount).toHaveBeenCalledOnce();
  });
  it("handles completion before the start response", async () => {
    const { access, request, notify } = setup();
    request.mockImplementationOnce(async () => {
      notify(completed("login-1", false));
      return login;
    });
    await access.start({ type: "chatgptDeviceCode" });
    expect(access.getSnapshot()).toMatchObject({
      login: null,
      error: "Denied",
      busy: false,
    });
  });
  it("discards a pending login response after disconnect", async () => {
    const { access, request, connection } = setup();
    let resolve!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = access.start({ type: "chatgptDeviceCode" });
    connection.disconnect();
    resolve(login);
    await pending;
    expect(access.getSnapshot()).toMatchObject({
      login: null,
      error: "",
      busy: false,
    });
  });
  it("serializes actions, cancels by login id, and does not retain API keys", async () => {
    const { access, request } = setup();
    request.mockResolvedValueOnce(login);
    await access.start({ type: "chatgptDeviceCode" });
    await access.start({ type: "apiKey", apiKey: "secret" });
    expect(request).toHaveBeenCalledTimes(1);
    await access.cancel();
    expect(request).toHaveBeenLastCalledWith("account/login/cancel", {
      loginId: "login-1",
    });
    request.mockResolvedValueOnce({ type: "apiKey" });
    await access.start({ type: "apiKey", apiKey: "secret" });
    expect(JSON.stringify(access.getSnapshot())).not.toContain("secret");
  });
});
