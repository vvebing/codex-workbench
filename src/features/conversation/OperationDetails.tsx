import { ConversationImage } from "../../components/ImagePreview";
import { OpenCurrentFile } from "../files/FileLinkContext";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { ThreadItem } from "../../generated/v2/ThreadItem";
import { IconButton, ScrollArea } from "../../components/ui";

function mediaUrl(value: unknown, kind: "image" | "audio"): string | undefined {
  if (typeof value !== "string") return;
  if (
    /^https?:\/\//i.test(value) ||
    /^blob:/i.test(value) ||
    value.startsWith(`data:${kind}/`)
  )
    return value;
}
function linkUrl(value: unknown): string | undefined {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
}
function MediaContent({ value }: { value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return (
      <pre className="whitespace-pre-wrap text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  const part = value as Record<string, unknown>;
  if (
    part.type === "text" ||
    part.type === "inputText" ||
    part.type === "input_text"
  )
    return (
      <pre className="whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">
        {String(part.text ?? "")}
      </pre>
    );
  if (
    part.type === "image" ||
    part.type === "inputImage" ||
    part.type === "input_image"
  ) {
    const url = mediaUrl(
      part.imageUrl ??
        part.image_url ??
        (typeof part.data === "string"
          ? `data:${part.mimeType};base64,${part.data}`
          : undefined),
      "image",
    );
    return url ? (
      <ConversationImage src={url} name="工具返回图片" />
    ) : (
      <p className="text-xs text-muted">
        图片地址暂不支持预览：
        {String(part.imageUrl ?? part.image_url ?? part.file_id ?? "未提供")}
      </p>
    );
  }
  if (
    part.type === "audio" ||
    part.type === "inputAudio" ||
    part.type === "input_audio"
  ) {
    const url = mediaUrl(
      part.audioUrl ??
        part.audio_url ??
        (typeof part.data === "string"
          ? `data:${part.mimeType};base64,${part.data}`
          : undefined),
      "audio",
    );
    return url ? (
      <audio src={url} controls className="my-2 max-w-full" />
    ) : (
      <p className="text-xs text-muted">
        音频地址暂不支持播放：
        {String(part.audioUrl ?? part.audio_url ?? "未提供")}
      </p>
    );
  }
  if (part.type === "encrypted_content")
    return (
      <p className="text-xs text-muted">工具返回了加密内容，无法直接预览。</p>
    );
  if (part.type === "resource_link" || part.type === "resourceLink") {
    const url = linkUrl(part.uri);
    return url ? (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-accent underline"
      >
        {String(part.title ?? part.name ?? part.uri)}
      </a>
    ) : (
      <p className="text-xs">
        {String(part.name ?? "资源")}：{String(part.uri ?? "")}
      </p>
    );
  }
  if (
    part.type === "resource" &&
    part.resource &&
    typeof part.resource === "object"
  ) {
    const resource = part.resource as Record<string, unknown>;
    const url = linkUrl(resource.uri);
    const mime = typeof resource.mimeType === "string" ? resource.mimeType : "";
    const resourceMedia =
      typeof resource.blob === "string" &&
      (mime.startsWith("image/") || mime.startsWith("audio/"))
        ? {
            type: mime.startsWith("image/") ? "image" : "audio",
            mimeType: mime,
            data: resource.blob,
          }
        : null;
    return (
      <div className="space-y-2 text-xs">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            {String(resource.uri)}
          </a>
        ) : (
          <p>{String(resource.uri ?? "资源")}</p>
        )}
        {resourceMedia ? (
          <MediaContent value={resourceMedia} />
        ) : typeof resource.text === "string" ? (
          <pre className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {resource.text}
          </pre>
        ) : (
          <p className="text-muted">
            二进制资源 · {String(resource.mimeType ?? "未知类型")}
          </p>
        )}
      </div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function OperationDetails({
  item,
  content,
  progress,
  output,
}: {
  item: ThreadItem;
  content: string;
  progress?: string[];
  output?: string;
}) {
  const [copyState, setCopyState] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const changes = item.type === "fileChange" ? item.changes : [];
  const selected =
    changes.find((change) => change.path === selectedPath) ?? changes[0];
  const media =
    item.type === "mcpToolCall"
      ? item.result?.content
      : item.type === "dynamicToolCall"
        ? item.contentItems
        : item.type === "functionCallOutput" && Array.isArray(item.output)
          ? item.output
          : item.type === "imageGeneration" && item.result
            ? [
                {
                  type: "inputImage",
                  imageUrl:
                    mediaUrl(item.result, "image") ??
                    (/^[A-Za-z0-9+/=\r\n]+$/.test(item.result) &&
                    item.result.length > 64
                      ? `data:image/png;base64,${item.result}`
                      : (item.savedPath ?? item.result)),
                },
              ]
            : null;
  const inlineContent =
    item.type === "mcpToolCall" || item.type === "dynamicToolCall"
      ? `参数\n${JSON.stringify(item.arguments, null, 2)}${item.type === "mcpToolCall" && item.error ? `\n\n${item.error.message}` : ""}`
      : media?.length
        ? item.type === "imageGeneration"
          ? (item.revisedPrompt ?? item.savedPath ?? item.status)
          : "返回结果"
        : content;
  const allContent = [
    content,
    output,
    item.type === "functionCallOutput" || item.type === "imageGeneration"
      ? `返回数据\n${JSON.stringify(item.type === "functionCallOutput" ? item.output : item.result, null, 2)}`
      : null,
    item.type === "mcpToolCall" && item.result?.structuredContent != null
      ? `结构化结果\n${JSON.stringify(item.result.structuredContent, null, 2)}`
      : null,
    item.type === "dynamicToolCall" &&
    item.contentItems?.some((part) => part.type !== "inputText")
      ? `媒体结果\n${JSON.stringify(item.contentItems, null, 2)}`
      : null,
    progress?.length ? `进度\n${progress.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const copy = () => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(allContent))
      .then(
        () => setCopyState("已复制"),
        () => setCopyState("复制失败，请重试"),
      );
  };
  return (
    <div className="relative space-y-3 py-3">
      <div className="absolute top-4 right-1 flex items-center gap-2 z-1">
        <span role="status" className="text-xs text-muted">
          {copyState}
        </span>
        <IconButton size="sm" label="复制输出" onClick={copy}>
          {copyState === "已复制" ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </div>
      {progress?.length ? (
        <div
          className="rounded-md bg-surface p-3 text-xs text-muted"
          aria-live="polite"
        >
          <p>{progress.at(-1)}</p>
          <details>
            <summary className="cursor-pointer">
              查看进度记录 ({progress.length})
            </summary>
            <ScrollArea className="mt-2 max-h-40">
              <pre className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {progress.join("\n")}
              </pre>
            </ScrollArea>
          </details>
        </div>
      ) : null}
      {changes.length ? (
        <div
          data-slot="operation-diff"
          className="rounded-md border border-border"
        >
          <div
            className="flex flex-wrap gap-1 border-b border-border p-2"
            aria-label="修改文件"
          >
            {changes.map((change) => (
              <button
                type="button"
                key={change.path}
                onClick={() => setSelectedPath(change.path)}
                aria-pressed={selected?.path === change.path}
                className={`rounded px-2 py-1 text-xs ${selected?.path === change.path ? "bg-hover text-foreground" : "text-muted"}`}
              >
                {change.path}
              </button>
            ))}
          </div>
          {selected && <OpenCurrentFile path={selected.path} />}
          <ScrollArea
            scrollChaining
            orientation="both"
            className="max-h-48"
            viewportProps={
              {
                "data-slot": "operations-output",
              } as React.HTMLAttributes<HTMLDivElement>
            }
          >
            <pre className="p-3 font-mono text-xs leading-6">
              {selected?.diff
                ? selected.diff.split("\n").map((line, index) => (
                    <span
                      key={index}
                      className={`block whitespace-pre-wrap [overflow-wrap:anywhere] ${line.startsWith("+") && !line.startsWith("+++") ? "bg-diff-added-soft text-diff-added" : line.startsWith("-") && !line.startsWith("---") ? "bg-diff-deleted-soft text-diff-deleted" : line.startsWith("@@") ? "text-accent" : ""}`}
                    >
                      {line || " "}
                    </span>
                  ))
                : "该文件未提供 diff"}
            </pre>
          </ScrollArea>
        </div>
      ) : (
        <ScrollArea
          scrollChaining
          orientation="both"
          className="max-h-40"
          viewportProps={
            {
              "data-slot": "operations-output",
            } as React.HTMLAttributes<HTMLDivElement>
          }
        >
          <pre className="rounded-md bg-surface p-3 font-mono text-xs leading-code whitespace-pre-wrap [overflow-wrap:anywhere]">
            {inlineContent || "暂无内容"}
          </pre>
        </ScrollArea>
      )}
      {output && (
        <ScrollArea
          scrollChaining
          orientation="both"
          className="max-h-40"
          viewportProps={
            {
              "data-slot": "operations-output",
            } as React.HTMLAttributes<HTMLDivElement>
          }
        >
          <pre className="whitespace-pre-wrap rounded-md bg-surface p-3 text-xs [overflow-wrap:anywhere]">
            {output}
          </pre>
        </ScrollArea>
      )}
      {media?.map((part, index) => (
        <ScrollArea
          scrollChaining
          key={index}
          orientation="both"
          className="max-h-48"
        >
          <MediaContent value={part} />
        </ScrollArea>
      ))}
      {item.type === "mcpToolCall" &&
        item.result?.structuredContent != null && (
          <ScrollArea
            scrollChaining
            orientation="both"
            className="max-h-40"
            viewportProps={
              {
                "data-slot": "operations-output",
              } as React.HTMLAttributes<HTMLDivElement>
            }
          >
            <pre className="whitespace-pre-wrap p-3 text-xs [overflow-wrap:anywhere]">
              {JSON.stringify(item.result.structuredContent, null, 2)}
            </pre>
          </ScrollArea>
        )}
    </div>
  );
}
