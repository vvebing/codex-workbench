import { t } from "../../lib/i18n";
import { RpcError } from "../../lib/rpc";
import { Store, errorMessage } from "../../lib/store";
import type { ConnectionStore } from "../connection/store";
import type { ThreadUsage } from "../../generated/v2/ThreadUsage";
import type { GetAccountTokenUsageResponse } from "../../generated/v2/GetAccountTokenUsageResponse";
import type { FeedbackSaveResponse } from "../../generated/v2/FeedbackSaveResponse";
import type { FsReadFileResponse } from "../../generated/v2/FsReadFileResponse";
import { MAX_TRANSFER_BYTES } from "../files/file-transfer";

export function diagnosticPath(value: string): string {
  const path = value.trim();
  if (
    !/^(?:\/|[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+\\)/i.test(path) ||
    /[\0\r\n]/.test(path) ||
    !/\.zip$/i.test(path)
  )
    throw new Error(t("请输入当前环境中尚未使用的绝对 ZIP 路径。"));
  return path;
}

interface InsightsState {
  usage: ThreadUsage | null;
  usageLoaded: boolean;
  usageBusy: boolean;
  usageError: string | null;
  usageUpdatedAt: number | null;
  saveBusy: boolean;
  saveError: string | null;
  attemptedPath: string | null;
  savedPath: string | null;
  uncertain: boolean;
  downloadBusy: boolean;
  downloadError: string | null;
}

/** Read on demand. Diagnostic writes are explicit and are never replayed. */
export class ThreadInsightsStore extends Store<InsightsState> {
  private active = false;
  private generation = 0;
  private attempted = new Set<string>();
  private observedEpoch: number;
  private observedAccount: string;
  private usageRevision = 0;
  constructor(
    readonly threadId: string,
    private connection: ConnectionStore,
    private scope = connection.getSnapshot().scope,
  ) {
    super({
      usage: null,
      usageLoaded: false,
      usageBusy: false,
      usageError: null,
      usageUpdatedAt: null,
      saveBusy: false,
      saveError: null,
      attemptedPath: null,
      savedPath: null,
      uncertain: false,
      downloadBusy: false,
      downloadError: null,
    });
    this.observedEpoch = connection.getSnapshot().epoch;
    this.observedAccount = JSON.stringify(
      connection.getSnapshot().accountDetails?.account ?? null,
    );
  }
  start() {
    this.active = true;
    const invalidate = () => {
      const next = this.connection.getSnapshot();
      const account = JSON.stringify(next.accountDetails?.account ?? null);
      const connectionChanged =
        next.epoch !== this.observedEpoch || next.scope !== this.scope;
      if (!connectionChanged && account === this.observedAccount) return;
      this.observedEpoch = next.epoch;
      this.observedAccount = account;
      this.usageRevision++;
      if (connectionChanged) this.generation++;
      this.update({
        ...this.state,
        usage: null,
        usageLoaded: false,
        usageBusy: false,
        usageError: null,
        usageUpdatedAt: null,
        ...(connectionChanged
          ? {
              saveBusy: false,
              uncertain: this.state.uncertain || this.state.saveBusy,
              downloadBusy: false,
            }
          : {}),
      });
    };
    invalidate();
    const off = this.connection.subscribe(invalidate);
    return () => {
      this.active = false;
      this.generation++;
      // Preserve an unconfirmed write if this store is restarted by StrictMode.
      this.update({
        ...this.state,
        uncertain: this.state.uncertain || this.state.saveBusy,
        saveBusy: false,
        usageBusy: false,
        downloadBusy: false,
      });
      off();
    };
  }
  private current(generation = this.generation) {
    const state = this.connection.getSnapshot();
    return (
      this.active &&
      generation === this.generation &&
      state.scope === this.scope &&
      state.status === "connected"
    );
  }
  async loadUsage() {
    if (!this.current() || this.state.usageBusy) return;
    const generation = this.generation;
    const revision = ++this.usageRevision;
    const current = () =>
      this.current(generation) && revision === this.usageRevision;
    this.update({ ...this.state, usageBusy: true, usageError: null });
    try {
      const response =
        await this.connection.client.request<GetAccountTokenUsageResponse>(
          "account/usage/read",
          { threadId: this.threadId },
        );
      if (current()) {
        if (
          response.threadUsage &&
          response.threadUsage.threadId !== this.threadId
        )
          throw new Error(t("返回的用量不属于当前会话，请刷新重试。"));
        this.update({
          ...this.state,
          usage: response.threadUsage ?? null,
          usageLoaded: true,
          usageUpdatedAt: Date.now(),
        });
      }
    } catch (error) {
      if (current())
        this.update({ ...this.state, usageError: errorMessage(error) });
    } finally {
      if (current()) this.update({ ...this.state, usageBusy: false });
    }
  }
  async save(pathValue: string, includeLogs: boolean, reason: string) {
    if (!this.current() || this.state.saveBusy || this.state.downloadBusy)
      return;
    let path: string;
    try {
      path = diagnosticPath(pathValue);
      if (this.attempted.has(path))
        throw new Error(t("此路径已用于导出，请更换新路径以避免重复写入。"));
    } catch (error) {
      this.update({ ...this.state, saveError: errorMessage(error) });
      return;
    }
    const generation = this.generation;
    this.attempted.add(path);
    this.update({
      ...this.state,
      saveBusy: true,
      saveError: null,
      attemptedPath: path,
      savedPath: null,
      uncertain: false,
      downloadError: null,
    });
    try {
      const response =
        await this.connection.client.request<FeedbackSaveResponse>(
          "feedback/save",
          {
            savePath: path,
            classification: "bug",
            reason: reason.trim() || undefined,
            threadId: this.threadId,
            includeLogs,
          },
        );
      if (this.current(generation))
        this.update({ ...this.state, savedPath: response.savedPath });
    } catch (error) {
      if (this.current(generation)) {
        const uncertain = !(error instanceof RpcError);
        if (!uncertain) this.attempted.delete(path);
        this.update({
          ...this.state,
          saveError: errorMessage(error),
          uncertain,
        });
      }
    } finally {
      if (this.current(generation))
        this.update({ ...this.state, saveBusy: false });
    }
  }
  async download(): Promise<{ dataBase64: string; name: string } | null> {
    const path =
      this.state.savedPath ??
      (this.state.uncertain ? this.state.attemptedPath : null);
    if (
      !path ||
      !this.current() ||
      this.state.downloadBusy ||
      this.state.saveBusy
    )
      return null;
    const generation = this.generation;
    this.update({ ...this.state, downloadBusy: true, downloadError: null });
    try {
      const response = await this.connection.client.request<FsReadFileResponse>(
        "fs/readFile",
        { path },
      );
      if (!this.current(generation)) return null;
      if (response.dataBase64.length > Math.ceil(MAX_TRANSFER_BYTES / 3) * 4)
        throw new Error(t("诊断包超过 8 MB，请从环境主机取回文件。"));
      this.update({ ...this.state, savedPath: path, uncertain: false });
      return {
        dataBase64: response.dataBase64,
        name: path.split(/[\\/]/).at(-1)!,
      };
    } catch (error) {
      if (this.current(generation))
        this.update({ ...this.state, downloadError: errorMessage(error) });
      return null;
    } finally {
      if (this.current(generation))
        this.update({ ...this.state, downloadBusy: false });
    }
  }
}

// The project panel remounts on reconnect and tab navigation. Keep unconfirmed
// diagnostic paths with the connection, never with another environment or page.
const insightStores = new WeakMap<
  ConnectionStore,
  Map<string, ThreadInsightsStore>
>();
export function threadInsightsFor(
  connection: ConnectionStore,
  threadId: string,
  scope = connection.getSnapshot().scope,
) {
  let stores = insightStores.get(connection);
  if (!stores) {
    stores = new Map();
    insightStores.set(connection, stores);
  }
  const key = JSON.stringify([scope, threadId]);
  let store = stores.get(key);
  if (!store) {
    store = new ThreadInsightsStore(threadId, connection, scope);
    stores.set(key, store);
  }
  return store;
}
