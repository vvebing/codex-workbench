import type { InitializeParams } from "../generated/InitializeParams";
import { appServerVersion } from "../../server/codex-version";
import type { ServerNotification } from "../generated/ServerNotification";
import type { ServerRequest } from "../generated/ServerRequest";
import type { ClientRequest } from "../generated/ClientRequest";
import { CapabilityStore } from "./capabilities";

export type RpcMethod = Exclude<ClientRequest["method"], "initialize">;
export type RpcParams<M extends RpcMethod> = Extract<
  ClientRequest,
  { method: M }
>["params"];
/** A union of tuples preserves the method/parameter relationship. */
export type RpcCall<M extends RpcMethod = RpcMethod> = M extends RpcMethod
  ? undefined extends RpcParams<M>
    ? [method: M, params?: RpcParams<M>]
    : [method: M, params: RpcParams<M>]
  : never;

export type ConnectionStatus = "disconnected" | "connecting" | "connected";
export type RpcNotification = ServerNotification;
export type RpcRequest = ServerRequest;
export type RpcId = string | number;

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/** Minimal browser socket interface, also suitable for a test transport. */
export interface SocketLike {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}
export interface CodexClientOptions {
  bridgeUrl?: string;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  webSocketFactory?: (url: string) => SocketLike;
}
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};
type StatusListener = (status: ConnectionStatus, error?: Error) => void;

function bridgeAddress(): string {
  const url = new URL("/bridge", globalThis.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isId(value: unknown): value is RpcId {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
function emit<T extends unknown[]>(
  listeners: Set<(...args: T) => void>,
  ...args: T
) {
  for (const listener of listeners) {
    try {
      listener(...args);
    } catch (error) {
      console.error("Codex listener failed", error);
    }
  }
}

/** One initialized app-server session. Mutating requests are never replayed. */
export class CodexClient {
  readonly capabilities = new CapabilityStore();
  private socket?: SocketLike;
  private nextId = 1;
  private pending = new Map<RpcId, Pending>();
  private notifications = new Set<(message: RpcNotification) => void>();
  private requests = new Set<(message: RpcRequest) => void>();
  private statuses = new Set<StatusListener>();
  private cancelConnect?: (error: Error) => void;
  private currentStatus: ConnectionStatus = "disconnected";
  private currentServerVersion: string | null = null;

  get serverVersion(): string | null {
    return this.currentServerVersion;
  }

  constructor(private readonly options: CodexClientOptions = {}) {}

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  connect(url: string, token?: string): Promise<void> {
    this.disconnect();
    this.capabilities.reset();
    let target: URL;
    try {
      target = new URL(url);
      if (
        !["ws:", "wss:"].includes(target.protocol) ||
        target.username ||
        target.password
      ) {
        throw new Error(
          "Use a ws:// or wss:// app-server URL without embedded credentials.",
        );
      }
    } catch (error) {
      return Promise.reject(asError(error));
    }
    this.setStatus("connecting");
    return new Promise<void>((resolve, reject) => {
      let socket: SocketLike;
      try {
        socket = (
          this.options.webSocketFactory ?? ((address) => new WebSocket(address))
        )(this.options.bridgeUrl ?? bridgeAddress());
      } catch (error) {
        this.setStatus("disconnected", asError(error));
        reject(asError(error));
        return;
      }
      this.socket = socket;
      let initializing = false;
      const timer = setTimeout(
        () => this.terminate(new Error("Connection timed out.")),
        this.options.connectTimeoutMs ?? 20_000,
      );
      this.cancelConnect = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      socket.onopen = () => {
        if (this.socket !== socket) return;
        try {
          this.send({
            type: "connect",
            url: target.href,
            ...(token ? { token } : {}),
          });
        } catch (error) {
          this.terminate(asError(error));
        }
      };
      socket.onerror = () => {
        if (this.socket === socket)
          this.terminate(new Error("WebSocket connection failed."));
      };
      socket.onclose = (event) => {
        if (this.socket === socket)
          this.terminate(new Error(event.reason || "Connection closed."));
      };
      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        let message: unknown;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          this.terminate(new Error("Invalid JSON received from app-server."));
          return;
        }
        if (!isRecord(message)) {
          this.terminate(new Error("Invalid app-server message."));
          return;
        }
        if (
          message.type === "bridge/error" ||
          message.method === "bridge/error"
        ) {
          const detail = isRecord(message.params)
            ? message.params.message
            : message.message;
          this.terminate(
            new Error(
              typeof detail === "string" ? detail : "Bridge connection failed.",
            ),
          );
          return;
        }
        if (
          message.type === "bridge/ready" ||
          message.method === "bridge/ready"
        ) {
          if (initializing) return;
          initializing = true;
          const params: InitializeParams = {
            clientInfo: {
              name: "codex_web",
              title: "Codex Web",
              version: "0.1.0",
            },
            // App discovery and other explicitly exposed tools require this capability.
            capabilities: { experimentalApi: true, requestAttestation: false },
          };
          void this.dispatch("initialize", params)
            .then((result) => {
              if (this.socket !== socket) return;
              this.currentServerVersion = appServerVersion(
                isRecord(result) ? result.userAgent : null,
              );
              this.send({ method: "initialized", params: {} });
              clearTimeout(timer);
              this.cancelConnect = undefined;
              this.setStatus("connected");
              resolve();
            })
            .catch((error: unknown) => {
              if (this.socket === socket) this.terminate(asError(error));
            });
          return;
        }
        this.receive(message);
      };
    });
  }

  disconnect(): void {
    this.terminate(new Error("Disconnected."));
  }

  request<T>(...[method, params]: RpcCall): Promise<T> {
    if (this.status !== "connected")
      return Promise.reject(new Error("Not connected to app-server."));
    if (this.capabilities.getSnapshot()[method]?.state === "unsupported")
      return Promise.reject(
        new RpcError(
          "当前连接的服务端未提供此接口；可在接口能力面板清除记录后重试。",
          -32601,
        ),
      );
    const socket = this.socket;
    return this.dispatch<T>(method, params).then(
      (result) => {
        if (this.socket === socket) this.capabilities.record(method);
        return result;
      },
      (error: unknown) => {
        if (this.socket === socket) this.capabilities.record(method, error);
        throw error;
      },
    );
  }

  respond(id: RpcId, result: unknown): void {
    if (this.status !== "connected")
      throw new Error("Not connected to app-server.");
    this.send({ id, result });
  }

  respondError(id: RpcId, code: number, message: string): void {
    if (this.status !== "connected")
      throw new Error("Not connected to app-server.");
    this.send({ id, error: { code, message } });
  }

  onNotification(listener: (message: RpcNotification) => void): () => void {
    this.notifications.add(listener);
    return () => {
      this.notifications.delete(listener);
    };
  }
  onRequest(listener: (message: RpcRequest) => void): () => void {
    this.requests.add(listener);
    return () => {
      this.requests.delete(listener);
    };
  }
  onStatus(listener: StatusListener): () => void {
    this.statuses.add(listener);
    return () => {
      this.statuses.delete(listener);
    };
  }

  private dispatch<T>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const command =
        method === "command/exec" && isRecord(params) ? params : undefined;
      const timeout =
        command?.disableTimeout === true
          ? undefined
          : typeof command?.timeoutMs === "number" &&
              Number.isFinite(command.timeoutMs) &&
              command.timeoutMs >= 0
            ? Math.min(command.timeoutMs + 5000, 2_147_483_647)
            : (this.options.requestTimeoutMs ?? 60_000);
      const timer =
        timeout === undefined
          ? undefined
          : setTimeout(() => {
              this.pending.delete(id);
              reject(
                new Error(
                  `${method} timed out. Its outcome is unknown; refresh before retrying.`,
                ),
              );
            }, timeout);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(asError(error));
      }
    });
  }

  private send(message: unknown): void {
    if (this.socket?.readyState !== 1)
      throw new Error("WebSocket is not open.");
    this.socket.send(JSON.stringify(message));
  }

  private receive(message: Record<string, unknown>): void {
    if (typeof message.method === "string") {
      if (isId(message.id)) emit(this.requests, message as RpcRequest);
      else if (!("id" in message))
        emit(this.notifications, message as RpcNotification);
      return;
    }
    if (!isId(message.id)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (isRecord(message.error)) {
      pending.reject(
        new RpcError(
          typeof message.error.message === "string"
            ? message.error.message
            : "App-server request failed.",
          typeof message.error.code === "number"
            ? message.error.code
            : undefined,
          message.error.data,
        ),
      );
    } else if ("result" in message) pending.resolve(message.result);
    else
      pending.reject(
        new Error("Invalid app-server response: missing result or error."),
      );
  }

  private setStatus(status: ConnectionStatus, error?: Error): void {
    this.currentStatus = status;
    emit(this.statuses, status, error);
  }

  private terminate(error: Error): void {
    this.currentServerVersion = null;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
    this.cancelConnect?.(error);
    this.cancelConnect = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (this.status !== "disconnected") this.setStatus("disconnected", error);
  }
}
