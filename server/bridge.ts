import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { allowedHost, allowedOrigin } from "./request-policy.js";

export interface BridgeOptions {
  connectTimeoutMs?: number;
}

const MAX_BUFFER = 16 * 1024 * 1024;

/** Attach the relay to the existing HTTP listener; no additional port. */
export function attachBridge(
  server: Server,
  options: BridgeOptions = {},
): void {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_BUFFER,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.url === "/environment-control") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    if (req.url !== "/bridge") return; // Leave Vite HMR upgrades to Vite.
    if (!allowedHost(server, req) || !allowedOrigin(server, req)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(req, socket, head, (client) =>
      sockets.emit("connection", client, req),
    );
  });
  sockets.on("connection", (client) => {
    let upstream: WebSocket | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let alive = true;
    let started = false;
    let failed = false;
    const fail = (message: string) => {
      if (failed) return;
      failed = true;
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "bridge/error", message }));
        client.close(1011, "Bridge disconnected");
      }
      upstream?.terminate();
    };
    const timer = setTimeout(
      () => fail("Connection handshake timed out."),
      options.connectTimeoutMs ?? 10_000,
    );
    client.on("error", () => upstream?.terminate());
    client.on("close", () => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      upstream?.terminate();
    });
    client.on("message", (data, binary) => {
      if (binary) {
        fail("Only JSON text frames are supported.");
        return;
      }
      if (!started) {
        started = true;
        try {
          const config = JSON.parse(data.toString()) as {
            type?: string;
            url?: string;
            token?: string;
          };
          if (config.type !== "connect")
            throw new Error("First message must be a connect request.");
          const url = new URL(config.url || "ws://127.0.0.1:4501");
          if (
            !["ws:", "wss:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.hash
          )
            throw new Error(
              "Use a ws:// or wss:// endpoint without credentials or fragments.",
            );
          if (
            config.token !== undefined &&
            (typeof config.token !== "string" || /[\r\n]/.test(config.token))
          )
            throw new Error("Invalid bearer token.");
          upstream = new WebSocket(url, {
            // A fresh Node connection intentionally has no browser Origin header.
            headers: config.token
              ? { Authorization: `Bearer ${config.token}` }
              : undefined,
            handshakeTimeout: options.connectTimeoutMs ?? 10_000,
            maxPayload: MAX_BUFFER,
            perMessageDeflate: false,
            followRedirects: false,
          });
          upstream.on("open", () => {
            clearTimeout(timer);
            if (client.readyState === WebSocket.OPEN)
              client.send(JSON.stringify({ type: "bridge/ready" }));
            else upstream?.terminate();
            heartbeat = setInterval(() => {
              if (!alive) {
                fail(
                  "App-server stopped responding. Check your SSH tunnel and reconnect.",
                );
                return;
              }
              alive = false;
              if (upstream?.readyState === WebSocket.OPEN) upstream.ping();
            }, 30_000);
            heartbeat.unref();
          });
          upstream.on("pong", () => {
            alive = true;
          });
          upstream.on("error", () =>
            fail(
              "Unable to connect to app-server. Check the endpoint, SSH tunnel, and bearer token.",
            ),
          );
          upstream.on("close", () => {
            clearTimeout(timer);
            clearInterval(heartbeat);
            fail("App-server connection closed. Reconnect to continue.");
          });
          upstream.on("message", (message, isBinary) => {
            if (isBinary) {
              fail("App-server sent an unsupported binary frame.");
              return;
            }
            if (client.bufferedAmount > MAX_BUFFER) {
              fail("Client cannot keep up with app-server messages.");
              return;
            }
            if (client.readyState === WebSocket.OPEN)
              client.send(message, { binary: false });
          });
        } catch (error) {
          fail(
            error instanceof Error
              ? error.message
              : "Invalid connection settings.",
          );
        }
        return;
      }
      if (upstream?.readyState !== WebSocket.OPEN) {
        fail("App-server is not ready.");
        return;
      }
      if (upstream.bufferedAmount > MAX_BUFFER) {
        fail("App-server cannot keep up with requests.");
        return;
      }
      // Preserve request IDs, notifications, approval replies, and frame contents exactly.
      // A disconnected mutation is never automatically replayed.
      upstream.send(data, { binary: false });
    });
  });
  // Terminate upgraded connections so server.close() can complete during shutdown/tests.
  const originalClose = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    for (const client of sockets.clients) client.terminate();
    sockets.close();
    return originalClose(callback);
  }) as typeof server.close;
}
