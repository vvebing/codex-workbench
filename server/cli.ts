import { parseArgs } from "node:util";

export function parseCli(args: string[], envPort = process.env.PORT) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string", short: "p" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      "no-app-server": { type: "boolean" },
    },
    allowPositionals: false,
  });
  if (values.help) return { action: "help" } as const;
  if (values.version) return { action: "version" } as const;
  const rawPort = values.port ?? envPort ?? "5180";
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("Port must be an integer between 1 and 65535.");
  return {
    action: "start",
    port,
    manageAppServer: !values["no-app-server"],
  } as const;
}

export const HELP = `Codex Workbench — 本机 Codex 工作台

Usage: codex-workbench [options]

  -p, --port <port>   网页端口（默认：PORT 环境变量或 5180）
  --no-app-server    不自动启动或复用本机 app-server
  -h, --help         显示帮助
  -v, --version      显示版本

Example: npx codex-workbench --port 5181
服务仅监听 127.0.0.1。网页端口不改变 app-server 的 4501 端口。
`;
