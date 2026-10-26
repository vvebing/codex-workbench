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

export const HELP = `Codex Workbench — Local workspace for Codex

Usage: codex-workbench [options]

  -p, --port <port>   Web port (default: PORT environment variable or 5180)
  --no-app-server    Do not automatically start or reuse a local app-server
  -h, --help         Show help
  -v, --version      Show version

Example: npx codex-workbench --port 5181
Listens only on 127.0.0.1. The web port does not change app-server port 4501.
`;
