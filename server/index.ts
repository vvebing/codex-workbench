#!/usr/bin/env node
import { AppServerTerminal, manageAppServer } from "./app-server.js";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createWorkbenchServer, DEFAULT_STATIC_DIR } from "./http.js";
import { HELP, parseCli } from "./cli.js";

let options;
try {
  options = parseCli(process.argv.slice(2));
} catch (error) {
  console.error(
    `Codex Workbench: ${(error as Error).message}\nUse --help for usage.`,
  );
  process.exit(1);
}
if (options.action === "help") {
  console.log(HELP);
  process.exit(0);
}
if (options.action === "version") {
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  console.log(pkg.version);
  process.exit(0);
}
const { port } = options;

const entrypoint = join(DEFAULT_STATIC_DIR, "index.html");
try {
  if (!(await stat(entrypoint)).isFile())
    throw new Error("UI entrypoint must be a file.");
} catch {
  throw new Error(
    `UI build is missing or unavailable at ${entrypoint}. Run npm run build before npm start.`,
  );
}

const terminal = new AppServerTerminal();
const server = createWorkbenchServer({
  appServerOutput: () => terminal.snapshot(),
});
let stopAppServer = () => {};
server.listen(port, "127.0.0.1", () => {
  console.log(`Codex Workbench: http://127.0.0.1:${port}`);
  if (options.manageAppServer) stopAppServer = manageAppServer(terminal);
});
server.once("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Choose another port with --port.`
      : `Codex Workbench: ${error.message}`,
  );
  process.exitCode = 1;
});
server.once("close", () => stopAppServer());
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopAppServer();
    server.close();
  });
