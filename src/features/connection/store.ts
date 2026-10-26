import { t } from "../../lib/i18n";
import {
  CodexClient,
  RpcError,
  type CodexClientOptions,
  type ConnectionStatus,
} from "../../lib/rpc";
import { Store, errorMessage } from "../../lib/store";
import type { Model } from "../../generated/v2/Model";
import type { GetAccountResponse } from "../../generated/v2/GetAccountResponse";
import type { GetAccountRateLimitsResponse } from "../../generated/v2/GetAccountRateLimitsResponse";
import type { ConsumeAccountRateLimitResetCreditParams } from "../../generated/v2/ConsumeAccountRateLimitResetCreditParams";
import type { ConsumeAccountRateLimitResetCreditResponse } from "../../generated/v2/ConsumeAccountRateLimitResetCreditResponse";
import { AccountAccessStore } from "./account-access";

export interface ConnectionNotice {
  id: number;
  message: string;
  threadId?: string | null;
}
export function sameEndpoint(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}
export interface ConnectionState {
  serverVersion: string | null;
  status: ConnectionStatus;
  epoch: number;
  scope: number;
  error: string | null;
  url: string;
  models: Model[];
  modelsLoading: boolean;
  modelsError: string | null;
  account: string;
  accountDetails: GetAccountResponse | null;
  rateLimitResetStatus:
    "idle" | "consuming" | "refreshing" | "error" | "unsupported";
  rateLimitResetCreditId: string | null;
  rateLimitResetError: string | null;
  rateLimitResetOutcome:
    ConsumeAccountRateLimitResetCreditResponse["outcome"] | null;
  rateLimits: GetAccountRateLimitsResponse | null;
  rateLimitsStatus: "unknown" | "loading" | "ready" | "error" | "unsupported";
  rateLimitsError: string | null;
  rateLimitsUpdatedAt: number | null;
  notices: ConnectionNotice[];
}
export class ConnectionStore extends Store<ConnectionState> {
  readonly client: CodexClient;
  readonly accountAccess: AccountAccessStore;
  private generation = 0;
  private accountRead = 0;
  private limitsRead = 0;
  private limitsPending: Promise<void> | null = null;
  private limitsDirty = false;
  private noticeId = 0;
  private accountVersion = 0;
  private resetKeys = new Map<string | null, string>();
  private resetDefaults() {
    return {
      rateLimitResetStatus: "idle" as const,
      rateLimitResetCreditId: null,
      rateLimitResetError: null,
      rateLimitResetOutcome: null,
    };
  }
  reconnectOnReload = false;
  constructor(options: CodexClientOptions = {}) {
    super({
      serverVersion: null,
      status: "disconnected",
      epoch: 0,
      scope: 0,
      error: null,
      url: "",
      models: [],
      modelsLoading: false,
      modelsError: null,
      account: t("未连接"),
      accountDetails: null,
      rateLimitResetStatus: "idle",
      rateLimitResetCreditId: null,
      rateLimitResetError: null,
      rateLimitResetOutcome: null,
      rateLimits: null,
      rateLimitsStatus: "unknown",
      rateLimitsError: null,
      rateLimitsUpdatedAt: null,
      notices: [],
    });
    this.client = new CodexClient(options);
    this.accountAccess = new AccountAccessStore(this);
    this.client.onStatus((status, error) =>
      this.update({
        ...this.state,
        status,
        serverVersion:
          status === "connected" ? this.client.serverVersion : null,
        ...(status === "disconnected"
          ? {
              epoch: this.state.epoch + 1,
              account: t("未连接"),
              accountDetails: null,
              ...this.resetDefaults(),
              rateLimits: null,
              rateLimitsStatus: "unknown",
              rateLimitsError: null,
              rateLimitsUpdatedAt: null,
              notices: [],
            }
          : {}),
        error: error?.message ?? null,
      }),
    );
    this.client.onNotification((event) => {
      if (this.state.status !== "connected") return;
      switch (event.method) {
        case "account/rateLimits/updated":
          // Rolling updates are sparse: re-read the authoritative account snapshot.
          // Invalidate an older read and coalesce bursts into one follow-up read.
          this.limitsRead++;
          void this.loadRateLimits(true);
          break;
        case "account/updated":
          this.accountVersion++;
          this.resetKeys.clear();
          this.limitsRead++;
          this.update({
            ...this.state,
            account: t("正在加载…"),
            accountDetails: null,
            ...this.resetDefaults(),
            rateLimits: null,
            rateLimitsStatus: "loading",
            rateLimitsError: null,
            rateLimitsUpdatedAt: null,
          });
          void this.loadAccount();
          void this.loadRateLimits(true);
          break;
        case "warning":
          this.addNotice(event.params.message, event.params.threadId);
          break;
        case "configWarning":
          this.addNotice(
            [event.params.summary, event.params.details, event.params.path]
              .filter(Boolean)
              .join(" · "),
          );
          break;
        case "deprecationNotice":
          this.addNotice(
            [event.params.summary, event.params.details]
              .filter(Boolean)
              .join(" · "),
          );
          break;
        case "model/rerouted":
          this.addNotice(
            t("模型已切换：{{value0}} → {{value1}} ({{value2}})", {
              value0: event.params.fromModel,
              value1: event.params.toModel,
              value2: event.params.reason,
            }),
            event.params.threadId,
          );
          break;
      }
    });
  }
  private addNotice(message: string, threadId?: string | null): void {
    this.update({
      ...this.state,
      notices: [
        ...this.state.notices,
        { id: ++this.noticeId, message, threadId },
      ].slice(-20),
    });
  }
  dismissNotice(id: number): void {
    this.update({
      ...this.state,
      notices: this.state.notices.filter((notice) => notice.id !== id),
    });
  }
  async loadAccount(): Promise<void> {
    const generation = this.generation,
      epoch = this.state.epoch,
      read = ++this.accountRead;
    const current = () =>
      generation === this.generation &&
      epoch === this.state.epoch &&
      read === this.accountRead;
    try {
      const details = await this.client.request<GetAccountResponse>(
        "account/read",
        {},
      );
      const { account } = details;
      if (current()) {
        if (
          this.state.accountDetails &&
          JSON.stringify(this.state.accountDetails) !== JSON.stringify(details)
        ) {
          this.accountVersion++;
          this.resetKeys.clear();
          this.limitsRead++;
          this.update({
            ...this.state,
            ...this.resetDefaults(),
            rateLimits: null,
            rateLimitsStatus: "unknown",
            rateLimitsUpdatedAt: null,
          });
        }
        this.update({
          ...this.state,
          accountDetails: details,
          account: !account
            ? t("未登录")
            : account.type === "chatgpt"
              ? (account.email ?? "ChatGPT")
              : account.type === "apiKey"
                ? "API key"
                : "Amazon Bedrock",
        });
      }
    } catch {
      if (current())
        this.update({
          ...this.state,
          account: t("账号暂时不可用"),
          accountDetails: null,
        });
    }
  }
  loadRateLimits(accountChanged = false): Promise<void> {
    if (this.limitsPending) {
      // A changed account invalidates an in-flight snapshot; ordinary readers share it.
      this.limitsDirty ||= accountChanged;
      return this.limitsPending;
    }
    const generation = this.generation;
    const pending = this.readRateLimits().finally(() => {
      if (this.limitsPending !== pending) return;
      this.limitsPending = null;
      if (this.limitsDirty && generation === this.generation) {
        this.limitsDirty = false;
        void this.loadRateLimits();
      }
    });
    this.limitsPending = pending;
    return pending;
  }
  private async readRateLimits(): Promise<void> {
    if (this.state.status !== "connected") return;
    const generation = this.generation,
      epoch = this.state.epoch,
      read = ++this.limitsRead;
    const current = () =>
      generation === this.generation &&
      epoch === this.state.epoch &&
      read === this.limitsRead &&
      this.state.status === "connected";
    this.update({
      ...this.state,
      rateLimitsStatus: "loading",
      rateLimitsError: null,
    });
    try {
      const rateLimits =
        await this.client.request<GetAccountRateLimitsResponse>(
          "account/rateLimits/read",
          {},
        );
      if (current())
        this.update({
          ...this.state,
          rateLimits,
          rateLimitsStatus: "ready",
          rateLimitsUpdatedAt: Date.now(),
        });
    } catch (error) {
      if (current())
        this.update({
          ...this.state,
          rateLimits: null,
          rateLimitsStatus:
            error instanceof RpcError && error.code === -32601
              ? "unsupported"
              : "error",
          rateLimitsError: errorMessage(error),
        });
    }
  }
  async consumeRateLimitResetCredit(creditId?: string): Promise<void> {
    const state = this.state;
    if (
      state.status !== "connected" ||
      !state.accountDetails?.account ||
      state.rateLimitsStatus !== "ready" ||
      ["consuming", "refreshing", "unsupported"].includes(
        state.rateLimitResetStatus,
      )
    )
      return;
    const summary = state.rateLimits?.rateLimitResetCredits;
    if (!summary || !(summary.availableCount > 0)) return;
    if (creditId === undefined) {
      // A missing detail list permits backend selection; an empty list does not.
      if (summary.credits !== null) return;
    } else {
      const credit = summary.credits?.find((item) => item.id === creditId);
      if (
        !credit ||
        credit.status !== "available" ||
        credit.resetType !== "codexRateLimits" ||
        (credit.expiresAt !== null && credit.expiresAt * 1000 <= Date.now())
      )
        return;
    }
    const attemptId = creditId ?? null;
    const generation = this.generation,
      epoch = state.epoch,
      accountVersion = this.accountVersion;
    const current = () =>
      generation === this.generation &&
      epoch === this.state.epoch &&
      accountVersion === this.accountVersion &&
      this.state.status === "connected";
    let key = this.resetKeys.get(attemptId);
    if (!key) {
      key = crypto.randomUUID();
      this.resetKeys.set(attemptId, key);
    }
    const params: ConsumeAccountRateLimitResetCreditParams = {
      ...(creditId === undefined ? {} : { creditId }),
      idempotencyKey: key,
    };
    this.update({
      ...this.state,
      rateLimitResetStatus: "consuming",
      rateLimitResetCreditId: creditId ?? null,
      rateLimitResetError: null,
      rateLimitResetOutcome: null,
    });
    let unsupported = false;
    try {
      const result =
        await this.client.request<ConsumeAccountRateLimitResetCreditResponse>(
          "account/rateLimitResetCredit/consume",
          params,
        );
      if (!current()) return;
      this.update({ ...this.state, rateLimitResetOutcome: result.outcome });
      this.resetKeys.delete(attemptId);
    } catch (error) {
      if (!current()) return;
      unsupported = error instanceof RpcError && error.code === -32601;
      this.update({ ...this.state, rateLimitResetError: errorMessage(error) });
    }
    if (!current()) return;
    this.update({ ...this.state, rateLimitResetStatus: "refreshing" });
    // Invalidate any read started during the mutation and request a post-mutation snapshot.
    this.limitsRead++;
    if (this.limitsPending) await this.limitsPending;
    if (!current()) return;
    await this.loadRateLimits();
    if (!current()) return;
    this.update({
      ...this.state,
      rateLimitResetStatus: unsupported
        ? "unsupported"
        : this.state.rateLimitResetError
          ? "error"
          : "idle",
    });
  }
  async loadModels(): Promise<void> {
    const epoch = this.state.epoch;
    const generation = this.generation;
    const current = () =>
      this.state.epoch === epoch && generation === this.generation;
    if (this.state.modelsLoading) return;
    this.update({ ...this.state, modelsLoading: true, modelsError: null });
    try {
      let cursor: string | null = null;
      const models: Model[] = [];
      const seen = new Set<string>();
      do {
        const page: { data: Model[]; nextCursor: string | null } =
          await this.client.request<{
            data: Model[];
            nextCursor: string | null;
          }>("model/list", cursor ? { cursor } : {});
        if (!current()) return;
        models.push(...page.data);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error(t("Model catalog repeated pagination cursor."));
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (current())
        this.update({
          ...this.state,
          models: Array.from(
            new Map(models.map((model) => [model.id, model])).values(),
          ),
          modelsLoading: false,
        });
    } catch (error) {
      if (current()) {
        this.update({
          ...this.state,
          modelsLoading: false,
          modelsError: errorMessage(error),
        });
        this.reportError(error);
      }
    }
  }
  async connect(url: string, token?: string): Promise<void> {
    this.disconnect();
    this.reconnectOnReload = true;
    const generation = ++this.generation;
    this.update({
      ...this.state,
      url,
      scope: this.state.scope + (sameEndpoint(url, this.state.url) ? 0 : 1),
      error: null,
      models: [],
      modelsLoading: false,
      modelsError: null,
      account: t("未连接"),
      accountDetails: null,
      ...this.resetDefaults(),
      rateLimits: null,
      rateLimitsStatus: "unknown",
      rateLimitsError: null,
      rateLimitsUpdatedAt: null,
      notices: [],
    });
    const epoch = this.state.epoch;
    try {
      await this.client.connect(url, token);
      if (generation !== this.generation || this.state.epoch !== epoch) return;
      await Promise.allSettled([this.loadModels(), this.loadAccount()]);
    } catch (error) {
      if (generation === this.generation) this.reportError(error);
      throw error;
    }
  }
  disconnect(): void {
    this.reconnectOnReload = false;
    this.generation++;
    this.resetKeys.clear();
    this.limitsPending = null;
    this.limitsDirty = false;
    const epoch = this.state.epoch;
    this.client.disconnect();
    if (this.state.epoch === epoch)
      this.update({
        ...this.state,
        epoch: epoch + 1,
        account: t("未连接"),
        accountDetails: null,
        ...this.resetDefaults(),
        error: null,
        modelsLoading: false,
        modelsError: null,
        rateLimits: null,
        rateLimitsStatus: "unknown",
        rateLimitsError: null,
        rateLimitsUpdatedAt: null,
        notices: [],
      });
  }
  reportError(error: unknown): void {
    this.update({ ...this.state, error: errorMessage(error) });
  }
}
