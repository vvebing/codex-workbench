import { ConversationImage } from "../../components/ImagePreview";
import { OpenCurrentFile } from "../files/FileLinkContext";
import { useState } from "react";
import { Copy, Check, ChevronRight } from "lucide-react";
import type { ThreadItem } from "../../generated/v2/ThreadItem";
import { ErrorNotice, IconButton, ScrollArea } from "../../components/ui";
import { ToolText } from "./ToolText";
import { LocalMessageImage } from "./MessageImage";
import { executionStatusLabel } from "./model";
import { AnimatedDisclosure } from "./AnimatedDisclosure";

function StructuredResult({ value }: { value: unknown }) {
  return (
    <ScrollArea scrollChaining className="mt-2 max-h-48">
      <ToolText
        text={JSON.stringify(value, null, 2) ?? ""}
        mimeType="application/json"
      />
    </ScrollArea>
  );
}

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
    return <ToolText text={JSON.stringify(value, null, 2) ?? ""} />;
  const part = value as Record<string, unknown>;
  if (
    part.type === "text" ||
    part.type === "inputText" ||
    part.type === "input_text"
  )
    return (
      <ToolText
        text={String(part.text ?? "")}
        mimeType={typeof part.mimeType === "string" ? part.mimeType : undefined}
      />
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
    const mime =
      typeof resource.mimeType === "string"
        ? resource.mimeType.split(";")[0].trim().toLowerCase()
        : "";
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
      <div className="min-w-0 space-y-2 text-xs [overflow-wrap:anywhere]">
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
          <ToolText text={resource.text} mimeType={mime} />
        ) : (
          <p className="text-muted">
            二进制资源 · {String(resource.mimeType ?? "未知类型")}
          </p>
        )}
      </div>
    );
  }
  return <ToolText text={JSON.stringify(value, null, 2)} />;
}

/** Build the full copy only on demand, including results returned with errors. */
function contentText(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const part = value as Record<string, unknown>;
    if (typeof part.text === "string") return part.text;
    if (
      part.type === "resource" &&
      part.resource &&
      typeof part.resource === "object"
    ) {
      const resource = part.resource as Record<string, unknown>;
      if (typeof resource.text === "string")
        return `${JSON.stringify({ ...part, resource: { ...resource, text: undefined } }, null, 2)}\n${resource.text}`;
    }
  }
  return JSON.stringify(value, null, 2) ?? "";
}

export function OperationDetails({
  item,
  status,
  content,
  progress,
  output,
}: {
  item: ThreadItem;
  status: string;
  content: string;
  progress?: string[];
  output?: string;
}) {
  const [copyState, setCopyState] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [structuredOpen, setStructuredOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const tool = item.type === "mcpToolCall" || item.type === "dynamicToolCall";
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
          : null;
  const error =
    item.type === "mcpToolCall"
      ? item.error?.message
      : item.type === "dynamicToolCall" && status === "failed"
        ? "工具执行失败"
        : null;
  const structured =
    item.type === "mcpToolCall" ? item.result?.structuredContent : null;
  const richText =
    item.type === "functionCallOutput" ||
    item.type === "enteredReviewMode" ||
    item.type === "exitedReviewMode" ||
    item.type === "hookPrompt";
  const copy = () => {
    const allContent = [
      tool ? `参数\n${JSON.stringify(item.arguments, null, 2)}` : content,
      media?.map(contentText).join("\n\n"),
      error,
      output,
      item.type === "imageGeneration"
        ? `返回数据\n${JSON.stringify({ result: item.result, savedPath: item.savedPath, failure: item.failure }, null, 2)}`
        : null,
      structured != null
        ? `结构化结果\n${JSON.stringify(structured, null, 2)}`
        : null,
      item.type === "webSearch"
        ? `搜索数据\n${JSON.stringify({ action: item.action, results: item.results }, null, 2)}`
        : null,
      progress?.length ? `进度\n${progress.join("\n")}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(allContent))
      .then(
        () => setCopyState("已复制"),
        () => setCopyState("复制失败，请重试"),
      );
  };
  return (
    <div className="relative min-w-0 space-y-3 py-3 text-foreground [overflow-wrap:anywhere]">
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
          <p className="pr-12">{progress.at(-1)}</p>
          <AnimatedDisclosure
            open={progressOpen}
            summary={
              <summary
                aria-expanded={progressOpen}
                className="flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden"
                onClick={(event) => {
                  event.preventDefault();
                  setProgressOpen((open) => !open);
                }}
              >
                <ChevronRight
                  size={14}
                  aria-hidden="true"
                  className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${progressOpen ? "rotate-90" : ""}`}
                />
                查看进度记录 ({progress.length})
              </summary>
            }
          >
            <ScrollArea className="mt-2 max-h-40">
              <pre className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {progress.join("\n")}
              </pre>
            </ScrollArea>
          </AnimatedDisclosure>
        </div>
      ) : null}
      {tool ? (
        <section className="space-y-2">
          <p className="flex min-h-6 items-center pr-10 text-xs text-muted max-[900px]:min-h-10">
            参数
          </p>
          <ScrollArea scrollChaining className="max-h-40">
            <ToolText
              text={JSON.stringify(item.arguments, null, 2)}
              mimeType="application/json"
            />
          </ScrollArea>
          {error && <ErrorNotice>{error}</ErrorNotice>}
          {!media?.length && structured == null && !error && (
            <p className="text-xs text-muted">
              {status === "inProgress" ||
              status === "in_progress" ||
              status === "waiting"
                ? "等待工具返回结果"
                : status === "failed"
                  ? "工具执行失败，未返回详细信息"
                  : "工具未返回内容"}
            </p>
          )}
        </section>
      ) : changes.length ? (
        <div
          data-slot="operation-diff"
          className="rounded-md border border-border"
        >
          <div
            className="flex flex-wrap gap-1 border-b border-border p-2 pr-12"
            aria-label="修改文件"
          >
            {changes.map((change) => (
              <button
                type="button"
                key={change.path}
                onClick={() => setSelectedPath(change.path)}
                aria-pressed={selected?.path === change.path}
                className={`min-w-0 max-w-full rounded px-2 py-1 text-left text-xs [overflow-wrap:anywhere] ${selected?.path === change.path ? "bg-hover text-foreground" : "text-muted"}`}
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
      ) : item.type === "collabAgentToolCall" ? (
        <div className="space-y-3">
          {item.prompt && (
            <section className="space-y-2">
              <p className="flex min-h-6 items-center pr-10 text-xs text-muted max-[900px]:min-h-10">
                任务
              </p>
              <ScrollArea scrollChaining className="max-h-48">
                <ToolText text={item.prompt} />
              </ScrollArea>
            </section>
          )}
          {Object.entries(item.agentsStates).map(([id, state]) => (
            <section key={id} className="space-y-2">
              <p className="flex min-h-6 items-center pr-10 text-xs text-muted max-[900px]:min-h-10">
                {id} · {executionStatusLabel(state?.status ?? "unknown")}
              </p>
              {state?.message && (
                <ScrollArea scrollChaining className="max-h-48">
                  <ToolText text={state.message} />
                </ScrollArea>
              )}
            </section>
          ))}
        </div>
      ) : item.type === "imageView" || item.type === "imageGeneration" ? (
        <section className="space-y-2 pr-10">
          {item.type === "imageView" ? (
            <>
              <p className="text-xs text-muted">{item.path}</p>
              <LocalMessageImage path={item.path} name="工具查看图片" />
            </>
          ) : (
            <>
              {item.revisedPrompt && (
                <ScrollArea scrollChaining className="max-h-40">
                  <ToolText text={item.revisedPrompt} />
                </ScrollArea>
              )}
              {item.failure ? (
                <ErrorNotice>
                  图片生成额度已用尽（{item.failure.limitId}）
                  {item.failure.resetsAt != null
                    ? `，重置时间：${new Date(item.failure.resetsAt * 1000).toLocaleString()}`
                    : ""}
                </ErrorNotice>
              ) : item.result || item.savedPath ? (
                mediaUrl(item.result, "image") ? (
                  <ConversationImage src={item.result} name="工具生成图片" />
                ) : /^[A-Za-z0-9+/=\r\n]+$/.test(item.result) &&
                  item.result.length > 64 ? (
                  <ConversationImage
                    src={`data:image/png;base64,${item.result}`}
                    name="工具生成图片"
                  />
                ) : (
                  <LocalMessageImage
                    path={item.savedPath || item.result}
                    name="工具生成图片"
                  />
                )
              ) : (
                <p className="text-xs text-muted">
                  {status === "failed"
                    ? "图片生成失败"
                    : status === "inProgress" || status === "in_progress"
                      ? "正在生成图片"
                      : "未返回图片"}
                </p>
              )}
              {item.savedPath && (
                <p className="text-xs text-muted">{item.savedPath}</p>
              )}
            </>
          )}
        </section>
      ) : (
        !media?.length && (
          <div className="space-y-2">
            {richText && (
              <p className="flex min-h-6 items-center pr-10 text-xs text-muted max-[900px]:min-h-10">
                返回结果
              </p>
            )}
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
              {richText ? (
                <ToolText text={content || "工具未返回内容"} />
              ) : (
                <pre className="rounded-md bg-surface p-3 pr-10 font-mono text-xs leading-code whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {content || "暂无内容"}
                </pre>
              )}
            </ScrollArea>
          </div>
        )
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
      {!!media?.length && (
        <section className="space-y-2">
          <p className="flex min-h-6 items-center pr-10 text-xs text-muted max-[900px]:min-h-10">
            返回结果
          </p>
          {media.map((part, index) => (
            <ScrollArea scrollChaining key={index} className="max-h-48">
              <MediaContent value={part} />
            </ScrollArea>
          ))}
        </section>
      )}
      {item.type === "webSearch" && !!item.results?.length && (
        <section className="space-y-2">
          <p className="text-xs text-muted">搜索结果</p>
          <ScrollArea scrollChaining className="max-h-48">
            <ToolText
              text={JSON.stringify(item.results, null, 2)}
              mimeType="application/json"
            />
          </ScrollArea>
        </section>
      )}
      {item.type === "mcpToolCall" &&
        item.result?.structuredContent != null &&
        (media?.length ? (
          <AnimatedDisclosure
            open={structuredOpen}
            summary={
              <summary
                aria-expanded={structuredOpen}
                className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted [&::-webkit-details-marker]:hidden"
                onClick={(event) => {
                  event.preventDefault();
                  setStructuredOpen((open) => !open);
                }}
              >
                <ChevronRight
                  size={14}
                  aria-hidden="true"
                  className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${structuredOpen ? "rotate-90" : ""}`}
                />
                结构化结果
              </summary>
            }
          >
            <StructuredResult value={item.result.structuredContent} />
          </AnimatedDisclosure>
        ) : (
          <section className="space-y-2">
            <p className="text-xs text-muted">返回结果</p>
            <ScrollArea scrollChaining className="max-h-48">
              <ToolText
                text={JSON.stringify(item.result.structuredContent, null, 2)}
                mimeType="application/json"
              />
            </ScrollArea>
          </section>
        ))}
    </div>
  );
}
