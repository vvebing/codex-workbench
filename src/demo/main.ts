import { DEMO_ENDPOINT, DEMO_FIRST_THREAD } from "./data";

// Each page gets a fresh virtual service. Discard only its obsolete terminal
// records; real environment history, drafts, and appearance preferences remain.
try {
  const prefix = "codex-terminals:v1:";
  const keys = Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index),
  );
  for (const key of keys) {
    if (!key?.startsWith(prefix)) continue;
    try {
      const entry: unknown = JSON.parse(key.slice(prefix.length));
      if (
        Array.isArray(entry) &&
        typeof entry[1] === "string" &&
        new URL(entry[1]).href === new URL(DEMO_ENDPOINT).href
      )
        localStorage.removeItem(key);
    } catch {
      // Ignore unrelated or malformed local records.
    }
  }
} catch {
  // The demo also works when browser storage is unavailable.
}

// Keep query-based routing: project Pages needs no server-side SPA fallback.
const url = new URL(window.location.href);
if (!url.searchParams.has("session") && !url.searchParams.has("env")) {
  url.searchParams.set("env", "local");
  url.searchParams.set("session", DEMO_FIRST_THREAD);
  window.history.replaceState(null, "", url);
}
void import("../main");
