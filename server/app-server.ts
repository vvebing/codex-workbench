import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { stripVTControlCharacters } from "node:util";

export interface AppServerOutput {
  status:
    "starting" | "running" | "external" | "unavailable" | "exited" | "stopped";
  output: string;
}

/** Bound retained terminal output independently of how long the server runs. */
export class AppServerTerminal {
  private status: AppServerOutput["status"] = "starting";
  private output = Buffer.alloc(0);
  append(text: string): void {
    this.output = Buffer.concat([this.output, Buffer.from(text)]).subarray(
      -128 * 1024,
    );
  }
  setStatus(status: AppServerOutput["status"]): void {
    this.status = status;
  }
  snapshot(): AppServerOutput {
    return {
      status: this.status,
      output: stripVTControlCharacters(this.output.toString("utf8")),
    };
  }
}

const host = "127.0.0.1";
const port = 4501;

function alreadyListening(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

/** Own only the process we launch; existing listeners belong to the user. */
export function manageAppServer(
  terminal = new AppServerTerminal(),
): () => void {
  const report = (message: string) => {
    terminal.append(message + "\n");
    console.warn(message);
  };
  let stopped = false;
  let child: ChildProcess | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  void (async () => {
    if (await alreadyListening()) {
      if (!stopped) {
        terminal.setStatus("external");
        report(
          `Codex app-server: 使用已有服务 ws://${host}:${port}，无法读取该进程的终端输出。`,
        );
      }
      return;
    }
    if (stopped) return;
    terminal.append(`$ codex app-server --listen ws://${host}:${port}\n`);
    child = spawn("codex", ["app-server", "--listen", `ws://${host}:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (text: string) => {
      terminal.append(text);
      process.stdout.write(text);
    });
    child.stderr?.on("data", (text: string) => {
      terminal.append(text);
      process.stderr.write(text);
    });
    child.once("spawn", () => terminal.setStatus("running"));
    child.once("error", (error: NodeJS.ErrnoException) => {
      terminal.setStatus("unavailable");
      report(
        error.code === "ENOENT"
          ? "未找到 codex 命令，跳过本机 app-server 启动。网页服务仍可使用；请安装 Codex CLI 并重启，或连接其他 app-server。"
          : `Codex app-server 启动失败：${error.message}。网页服务继续运行。`,
      );
    });
    child.once("exit", (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      if (!stopped) {
        terminal.setStatus("exited");
        report(
          `Codex app-server 已退出（${signal ?? code}），网页服务继续运行。请检查终端输出。`,
        );
      }
    });
  })().catch((error: unknown) => {
    terminal.setStatus("unavailable");
    report(`无法启动 Codex app-server，网页服务继续运行：${String(error)}`);
  });
  return () => {
    if (stopped) return;
    stopped = true;
    terminal.setStatus("stopped");
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child?.kill("SIGKILL"), 3000);
    killTimer.unref();
  };
}
