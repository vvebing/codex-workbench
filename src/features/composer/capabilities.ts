import type { Thread } from "../../generated/v2/Thread";
import type { ThreadAccess } from "../sessions/store";
import type { Draft } from "./drafts";

import { activeTurn, conversationExecuting } from "../conversation/activity";
export { conversationExecuting } from "../conversation/activity";

export function conversationCapabilities({
  thread,
  access = "viewing",
  draft,
  connected,
  waiting,
  sending = false,
  stopping = false,
  reading = false,
}: {
  thread?: Thread;
  access?: ThreadAccess;
  draft: Pick<Draft, "text" | "images">;
  connected: boolean;
  waiting: boolean;
  sending?: boolean;
  stopping?: boolean;
  reading?: boolean;
}) {
  const running = activeTurn(thread);
  const hasContent = !!draft.text.trim() || !!draft.images.length;
  const editable = access !== "occupied";
  const available =
    connected && access !== "activating" && !sending && !stopping;
  return {
    running,
    executing: conversationExecuting(thread),
    hasContent,
    editable,
    canSend: available && hasContent && !reading && !waiting,
    canCommand: available && editable && !reading && !waiting,
    canStop: available && access === "editable" && !!running,
    showStop:
      conversationExecuting(thread) && (!hasContent || waiting) && !sending,
  };
}

export function draftCommand(draft: Draft): string | undefined {
  const hasReferences = draft.document?.content?.some((block) =>
    block.content?.some((node) => node.type === "reference"),
  );
  // Selected references serialize to absolute paths, not slash commands.
  return hasReferences ? undefined : /^\/([^/\s]+)\s*$/.exec(draft.text)?.[1];
}
