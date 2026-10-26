import { t } from "../../lib/i18n";
import { Store } from "../../lib/store";
import { isVersion, parseStableRelease } from "../../../server/codex-version";

export async function readLatestRelease(
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher("/codex-release", {
    signal: AbortSignal.timeout(10_000),
  });
  // An older running web process serves its SPA fallback for this new route.
  // Use the public, credential-free release API without restarting live sessions.
  if (
    response.status === 404 ||
    response.headers.get("content-type")?.includes("text/html")
  ) {
    const upstream = await fetcher(
      "https://api.github.com/repos/openai/codex/releases/latest",
      {
        credentials: "omit",
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!upstream.ok)
      throw new Error(t("无法访问官方发布服务，请检查网络或稍后重试。"));
    return parseStableRelease(await upstream.json()).version;
  }
  if (!response.ok)
    throw new Error(
      t("更新服务暂时不可用（HTTP {{value0}}），请稍后重试。", {
        value0: response.status,
      }),
    );
  const data = (await response.json()) as { version?: unknown } | null;
  if (!isVersion(data?.version) || data.version.includes("-"))
    throw new Error(t("更新接口返回了无效的版本信息。"));
  return data.version;
}
interface ReleaseState {
  status: "idle" | "loading" | "ready" | "error";
  latest: string | null;
  error: string | null;
}
export class ReleaseCheckStore extends Store<ReleaseState> {
  private pending: Promise<void> | null = null;
  private checkedAt: number | null = null;
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {
    super({ status: "idle", latest: null, error: null });
  }
  check(force = false): Promise<void> {
    if (this.pending) return this.pending;
    const ttl = this.state.status === "ready" ? 300_000 : 30_000;
    if (!force && this.checkedAt !== null && this.now() - this.checkedAt < ttl)
      return Promise.resolve();
    this.update({ ...this.state, status: "loading", error: null });
    this.pending = readLatestRelease(this.fetcher)
      .then((latest) => {
        this.update({ status: "ready", latest, error: null });
      })
      .catch((error) => {
        this.update({
          status: "error",
          latest: null,
          error:
            error instanceof Error
              ? error.message
              : t("无法检查更新，请稍后重试。"),
        });
      })
      .finally(() => {
        this.checkedAt = this.now();
        this.pending = null;
      });
    return this.pending;
  }
}
export const releaseCheck = new ReleaseCheckStore();
