import type { ThreadSourceKind } from "../../generated/v2/ThreadSourceKind";

// Explicitly include app-server sessions; the server default is CLI/VS Code only.
export const ROOT_THREAD_SOURCES: ThreadSourceKind[] = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "unknown",
];
