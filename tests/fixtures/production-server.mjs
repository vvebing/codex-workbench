import { createWorkbenchServer } from "../../dist/server/http.js";

const server = createWorkbenchServer();
server.listen(5181, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close());
