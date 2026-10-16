import { AppServerTerminal, manageAppServer } from "./app-server.js";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createWorkbenchServer, DEFAULT_STATIC_DIR } from "./http.js";

const port = Number(process.env.PORT ?? 5180);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be between 1 and 65535.");

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
  stopAppServer = manageAppServer(terminal);
});
server.once("close", () => stopAppServer());
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopAppServer();
    server.close();
  });
