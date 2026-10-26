import { t } from "../../lib/i18n";
import type { CommandExecParams } from "../../generated/v2/CommandExecParams";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";

/** Read-only repository helpers. No Git mutations or sandbox escalation. */
export class GitTools {
  constructor(
    readonly root: string,
    private execute: (
      params: CommandExecParams,
    ) => Promise<CommandExecResponse>,
    private current: () => boolean = () => true,
  ) {}
  private async read(args: string[]) {
    if (!this.current()) throw new Error(t("目标环境已改变，请重试"));
    const result = await this.execute({
      command: ["git", "--no-optional-locks", ...args],
      cwd: this.root,
      timeoutMs: 30_000,
      disableOutputCap: true,
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
    if (!this.current()) throw new Error(t("目标环境已改变，请重试"));
    if (result.exitCode !== 0)
      throw new Error(result.stderr || t("无法读取 Git 工作区"));
    return result.stdout;
  }
  patch(cached: boolean) {
    return this.read([
      "diff",
      ...(cached ? ["--cached"] : []),
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
    ]);
  }
  async worktrees() {
    return (await this.read(["worktree", "list", "--porcelain", "-z"]))
      .split("\0")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice(9));
  }
}
