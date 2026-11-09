import { DEMO_FIRST_THREAD } from "./data";

// Keep query-based routing: project Pages needs no server-side SPA fallback.
const url = new URL(window.location.href);
if (!url.searchParams.has("session") && !url.searchParams.has("env")) {
  url.searchParams.set("env", "local");
  url.searchParams.set("session", DEMO_FIRST_THREAD);
  window.history.replaceState(null, "", url);
}
void import("../main");
