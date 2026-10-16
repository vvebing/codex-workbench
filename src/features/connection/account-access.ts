import { Store, errorMessage } from "../../lib/store";
import type { ConnectionStore } from "./store";
import type { LoginAccountParams } from "../../generated/v2/LoginAccountParams";
import type { LoginAccountResponse } from "../../generated/v2/LoginAccountResponse";
import type { AccountLoginCompletedNotification } from "../../generated/v2/AccountLoginCompletedNotification";

type Login = Extract<LoginAccountResponse, { loginId: string }>;
const empty = () => ({
  busy: false,
  login: null as Login | null,
  error: "",
  message: "",
});
export class AccountAccessStore extends Store<ReturnType<typeof empty>> {
  private generation = 0;
  private completed = new Map<string, AccountLoginCompletedNotification>();
  constructor(private connection: ConnectionStore) {
    super(empty());
    let epoch = connection.getSnapshot().epoch;
    connection.subscribe(() => {
      const next = connection.getSnapshot().epoch;
      if (next !== epoch) {
        epoch = next;
        this.generation++;
        this.completed.clear();
        this.update(empty());
      }
    });
    connection.client.onNotification((event) => {
      if (event.method !== "account/login/completed") return;
      const result = event.params;
      if (this.state.busy && result.loginId)
        this.completed.set(result.loginId, result);
      if (result.loginId && result.loginId === this.state.login?.loginId)
        this.finish(result);
    });
  }
  private finish(result: AccountLoginCompletedNotification): void {
    this.update({
      ...empty(),
      error: result.success ? "" : result.error || "登录未完成",
      message: result.success ? "登录成功" : "",
    });
    if (result.success) {
      void this.connection.loadAccount();
      void this.connection.loadRateLimits();
    }
  }
  private async action(
    task: (current: () => boolean) => Promise<void>,
  ): Promise<void> {
    if (this.state.busy || this.connection.getSnapshot().status !== "connected")
      return;
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.update({ ...this.state, busy: true, error: "", message: "" });
    try {
      await task(current);
    } catch (error) {
      if (current()) this.update({ ...this.state, error: errorMessage(error) });
    } finally {
      if (current()) this.update({ ...this.state, busy: false });
    }
  }
  start(
    params: Extract<
      LoginAccountParams,
      { type: "chatgpt" | "chatgptDeviceCode" | "apiKey" }
    >,
  ): Promise<void> {
    if (this.state.login) return Promise.resolve();
    return this.action(async (current) => {
      this.completed.clear();
      const result = await this.connection.client.request<LoginAccountResponse>(
        "account/login/start",
        params,
      );
      if (!current()) return;
      if ("loginId" in result) {
        const completed = this.completed.get(result.loginId);
        this.completed.clear();
        if (completed) this.finish(completed);
        else
          this.update({
            ...this.state,
            login: result,
            message: "请完成授权，工作台会自动更新登录状态。",
          });
      } else {
        this.finish({
          loginId: null,
          success: true,
          error: null,
          onboardingEntrypoint: null,
        });
      }
    });
  }
  cancel(): Promise<void> {
    const loginId = this.state.login?.loginId;
    if (!loginId) return Promise.resolve();
    return this.action(async (current) => {
      await this.connection.client.request("account/login/cancel", { loginId });
      if (current()) this.update({ ...empty(), message: "已取消登录" });
    });
  }
  logout(): Promise<void> {
    return this.action(async (current) => {
      await this.connection.client.request("account/logout", {});
      if (!current()) return;
      this.update({ ...empty(), message: "已退出当前环境账户" });
      await this.connection.loadAccount();
      void this.connection.loadRateLimits();
    });
  }
}
