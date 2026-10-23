import { threadTitle } from "../sessions/thread-title";
import type { Thread } from "../../generated/v2/Thread";

export const navigationTitle = threadTitle;
export function navigationSubtitle(thread: Pick<Thread, "name" | "preview">) {
  return thread.name?.trim() && thread.preview.trim() !== thread.name.trim()
    ? thread.preview.replace(/\s+/g, " ").trim()
    : "";
}
