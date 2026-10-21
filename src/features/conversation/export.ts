import type { Thread } from "../../generated/v2/Thread";
import type { ThreadItem } from "../../generated/v2/ThreadItem";
import type { UserInput } from "../../generated/v2/UserInput";

function inputMarkdown(input: UserInput): string {
  switch (input.type) {
    case "text":
      return input.text;
    case "image":
      return "url" in input
        ? `![图片](${input.url})`
        : `[图片：${input.fileId}]`;
    case "localImage":
      return `[本地图片：${input.path}]`;
    case "audio":
      return `[音频](${input.url})`;
    case "localAudio":
      return `[本地音频：${input.path}]`;
    case "skill":
      return `$${input.name}`;
    case "mention":
      return `@${input.name}`;
  }
}
export function conversationMarkdown(thread: Thread): string {
  const title = (thread.name || thread.preview || "新会话").replace(
    /\s+/g,
    " ",
  );
  const sections = [
    `# ${title}`,
    `Session ID: ${thread.sessionId}\n\nThread ID: ${thread.id}\n\n工作目录：${thread.cwd}`,
  ];
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type === "userMessage")
        sections.push(
          `## 用户\n\n${item.content.map(inputMarkdown).join("\n\n")}`,
        );
      else if (item.type === "agentMessage" && item.text.trim())
        sections.push(`## 助手\n\n${item.text}`);
    }
  }
  return sections.join("\n\n") + "\n";
}
export function finalSummary(thread: Thread): string | null {
  for (const turn of [...thread.turns].reverse()) {
    if (turn.status !== "completed") continue;
    const messages = turn.items.filter(
      (item): item is Extract<ThreadItem, { type: "agentMessage" }> =>
        item.type === "agentMessage" && !!item.text.trim(),
    );
    const final = [...messages]
      .reverse()
      .find((item) => item.phase === "final_answer");
    if (final) return final.text;
    const legacy = [...messages].reverse().find((item) => item.phase == null);
    if (legacy) return legacy.text;
  }
  return null;
}
export function exportFilename(thread: Thread): string {
  const title = (thread.name || thread.preview || "新会话")
    // eslint-disable-next-line no-control-regex -- Remove invalid filename characters.
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return `${title || "新会话"}-${thread.id.slice(0, 8)}.md`;
}

export async function copyFinalSummary(thread: Thread): Promise<void> {
  const text = finalSummary(thread);
  if (!text) throw new Error("此会话还没有已完成的最终总结。");
  await navigator.clipboard.writeText(text);
}

export function exportText(
  text: string,
  filename: string,
  type = "text/plain",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
