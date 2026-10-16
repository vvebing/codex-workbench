import type { IncomingMessage, Server } from "node:http";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function allowedHost(server: Server, req: IncomingMessage) {
  try {
    const host = new URL(`http://${req.headers.host}`);
    const address = server.address();
    return (
      LOOPBACK.has(host.hostname) &&
      typeof address === "object" &&
      address !== null &&
      Number(host.port || 80) === address.port
    );
  } catch {
    return false;
  }
}

export function allowedOrigin(server: Server, req: IncomingMessage) {
  if (!req.headers.origin) return false;
  try {
    const origin = new URL(req.headers.origin);
    const address = server.address();
    return (
      origin.protocol === "http:" &&
      LOOPBACK.has(origin.hostname) &&
      typeof address === "object" &&
      address !== null &&
      Number(origin.port || 80) === address.port
    );
  } catch {
    return false;
  }
}
