import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { parseStableRelease, type CodexRelease } from "./codex-version.js";
import { allowedHost } from "./request-policy.js";

export function createReleaseChecker(
  fetcher: typeof fetch = fetch,
  now = Date.now,
) {
  let cached: CodexRelease | undefined;
  let failureUntil = 0;
  let pending: Promise<CodexRelease> | undefined;
  return async (): Promise<CodexRelease> => {
    if (cached && now() - cached.checkedAt < 5 * 60_000) return cached;
    if (failureUntil > now()) throw new Error("Release check unavailable");
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetcher(
          "https://api.github.com/repos/openai/codex/releases/latest",
          {
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "codex-workbench",
            },
            signal: AbortSignal.timeout(8_000),
            redirect: "error",
          },
        );
        if (!response.ok) throw new Error("Release check failed");
        cached = parseStableRelease(await response.json(), now());
        return cached;
      } catch (error) {
        failureUntil = now() + 30_000;
        throw error;
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };
}
const checkRelease = createReleaseChecker();
export async function serveCodexRelease(
  server: Server,
  req: IncomingMessage,
  res: ServerResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  if (!allowedHost(server, req)) {
    res.writeHead(403).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  try {
    const release = await checkRelease();
    res
      .writeHead(200)
      .end(req.method === "HEAD" ? undefined : JSON.stringify(release));
  } catch {
    res
      .writeHead(503)
      .end(
        req.method === "HEAD"
          ? undefined
          : JSON.stringify({ error: "暂时无法检查更新，请稍后重试。" }),
      );
  }
}
