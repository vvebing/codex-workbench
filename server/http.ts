import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { attachBridge, type BridgeOptions } from "./bridge.js";
import type { AppServerOutput } from "./app-server.js";
import { allowedHost } from "./request-policy.js";
import { SECURITY_HEADERS } from "./security-headers.js";
import { serveCodexRelease } from "./codex-release.js";

export interface WorkbenchServerOptions extends BridgeOptions {
  staticDir?: string;
  appServerOutput?: () => AppServerOutput;
}

// Resolve assets next to the compiled server, including when launched from another cwd.
export const DEFAULT_STATIC_DIR = fileURLToPath(
  new URL(
    import.meta.url.endsWith(".ts") ? "../dist/client/" : "../client/",
    import.meta.url,
  ),
);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
};

export function createWorkbenchServer(options: WorkbenchServerOptions = {}) {
  const staticDir = resolve(options.staticDir ?? DEFAULT_STATIC_DIR);
  const server = createServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      res.setHeader(name, value);
    if (!allowedHost(server, req)) {
      res.writeHead(403).end("Forbidden host");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    if (req.url === "/app-server-output") {
      res.setHeader("Cache-Control", "no-store");
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify(
          options.appServerOutput?.() ?? {
            status: "unavailable",
            output: "此网页服务未管理本机 app-server，无法读取终端输出。",
          },
        ),
      );
      return;
    }
    if (req.url === "/codex-release") {
      await serveCodexRelease(server, req, res);
      return;
    }
    if (req.url === "/healthz") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: "ok" }));
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname,
      );
      let filename = resolve(staticDir, `.${pathname}`);
      if (filename !== staticDir && !filename.startsWith(staticDir + sep)) {
        res.writeHead(403).end();
        return;
      }
      try {
        if (!(await stat(filename)).isFile())
          filename = resolve(staticDir, "index.html");
      } catch {
        if (extname(pathname)) {
          res.writeHead(404).end();
          return;
        }
        filename = resolve(staticDir, "index.html");
      }
      const [actualRoot, actualFile] = await Promise.all([
        realpath(staticDir),
        realpath(filename),
      ]);
      if (!actualFile.startsWith(actualRoot + sep)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(actualFile);
      res.writeHead(200, {
        "Content-Type": MIME[extname(filename)] ?? "application/octet-stream",
        "Cache-Control":
          pathname.startsWith("/assets/") && /-[\w-]{8,}\.[\w]+$/.test(filename)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res
        .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
        .end(
          "UI not built. Run npm run build first, or use the Vite development server.",
        );
    }
  });
  server.on("upgrade", (req, socket) => {
    if (req.url === "/bridge" || req.url === "/environment-control") return;
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  });
  attachBridge(server, options);
  return server;
}
