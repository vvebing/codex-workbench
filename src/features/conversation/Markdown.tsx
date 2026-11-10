import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";
import { promptLineBreaks } from "./prompt-line-breaks";
import { ConversationImage } from "../../components/ImagePreview";
import { Button, ScrollArea } from "../../components/ui";
import {
  createContext,
  memo,
  useMemo,
  useContext,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
} from "react";
import ReactMarkdown from "react-markdown";
import { FileAnchor } from "../files/FileLinkContext";
import { fileLinkUrlTransform } from "../files/file-links";
import remarkGfm from "remark-gfm";
import type { ExtraProps } from "react-markdown";
import { MermaidDiagram } from "./MermaidDiagram";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, TerminalSquare } from "lucide-react";
import { useTerminalCommand } from "./TerminalCommandContext";
import { terminalCodeCommand } from "./terminal-code-action";
const ImageLinkContext = createContext(false);
function MarkdownAnchor(props: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  useTranslation();
  return (
    <ImageLinkContext.Provider value={true}>
      <FileAnchor {...props} />
    </ImageLinkContext.Provider>
  );
}
function MarkdownImage({
  src,
  alt,
}: ComponentPropsWithoutRef<"img"> & ExtraProps) {
  useTranslation();
  const linked = useContext(ImageLinkContext);
  if (linked)
    return <img src={src} alt={alt} loading="lazy" decoding="async" />;
  return (
    <ConversationImage
      src={typeof src === "string" ? src : ""}
      name={alt || t("对话图片")}
    />
  );
}
const MarkdownContext = createContext({
  text: "",
  streaming: false,
});
function codeText(node: {
  type: string;
  value?: unknown;
  children?: readonly unknown[];
}): string {
  if (node.type === "text" && typeof node.value === "string") return node.value;
  return (node.children ?? [])
    .map((child) => codeText(child as Parameters<typeof codeText>[0]))
    .join("");
}
function CodeBlock({
  children,
  node,
  ...props
}: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  useTranslation();
  const { text, streaming } = useContext(MarkdownContext);
  const fillTerminal = useTerminalCommand();
  const [message, setMessage] = useState("");
  const [filled, setFilled] = useState(false);
  const code = node?.children.find(
    (child) => child.type === "element" && child.tagName === "code",
  );
  const classes =
    code?.type === "element" && Array.isArray(code.properties.className)
      ? code.properties.className
      : [];
  const language = classes.find(
    (value) => typeof value === "string" && value.startsWith("language-"),
  );
  const source = code?.type === "element" ? codeText(code) : "";
  const command =
    code?.type === "element"
      ? terminalCodeCommand(
          source,
          typeof language === "string" ? language.slice(9) : undefined,
          streaming,
        )
      : null;
  if (
    code?.type === "element" &&
    Array.isArray(code.properties.className) &&
    code.properties.className.includes("language-mermaid")
  ) {
    const source = code.children
      .filter((child) => child.type === "text")
      .map((child) => child.value)
      .join("")
      .replace(/\n$/, "");
    const original = text.slice(
      node?.position?.start.offset,
      node?.position?.end.offset,
    );
    const lines = original.split("\n");
    const fence = /^[ \t]*(`{3,}|~{3,})/.exec(lines[0])?.[1];
    const closed =
      !!fence &&
      new RegExp(`^[ \t]*${fence[0]}{${fence.length},}[ \t]*$`).test(
        lines.at(-1) || "",
      );
    return <MermaidDiagram source={source} pending={streaming && !closed} />;
  }
  return (
    <div className="group/code relative my-4 rounded-lg border border-border bg-surface first:mt-0 last:mb-0">
      <div className="absolute z-10 top-1.5 right-2 flex items-center gap-1 rounded-md bg-elevated opacity-0 [@media(hover:none)]:opacity-100 group-hover/code:opacity-100 group-focus-within/code:opacity-100">
        {fillTerminal && command && (
          <Button
            size="sm"
            variant="quiet"
            data-slot="terminal-code-action"
            className="gap-1 px-2 text-meta"
            aria-label={t("填入终端")}
            title={t("填入项目终端，按 Enter 后执行")}
            onClick={() => {
              if (!fillTerminal(command)) return;
              setFilled(true);
              window.setTimeout(() => setFilled(false), 2000);
            }}
          >
            <TerminalSquare size={14} />
            <span aria-live="polite">
              {filled ? t("已填入终端") : t("填入终端")}
            </span>
          </Button>
        )}
        <Button
          size="sm"
          variant="quiet"
          className="min-w-8 gap-1 px-1 text-meta [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:min-w-10"
          aria-label={t("复制代码")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(source);
              setMessage("已复制");
            } catch {
              setMessage("复制失败");
            }
            window.setTimeout(() => setMessage(""), 2000);
          }}
        >
          {message === "已复制" ? <Check size={14} /> : <Copy size={14} />}
          <span aria-live="polite" className="empty:hidden">
            {message ? t(message) : ""}
          </span>
        </Button>
      </div>
      <ScrollArea scrollChaining orientation="both">
        <pre
          {...props}
          className={`m-0 p-4 text-code leading-code ${fillTerminal && command ? "pr-40" : "pr-14"}`}
        >
          {children}
        </pre>
      </ScrollArea>
    </div>
  );
}
function MarkdownTable({
  children,
  node,
  ...props
}: ComponentPropsWithoutRef<"table"> & ExtraProps) {
  useTranslation();
  void node;
  return (
    <ScrollArea scrollChaining orientation="both">
      <table {...props}>{children}</table>
    </ScrollArea>
  );
}
const standardPlugins = [remarkGfm];
const promptPlugins = [remarkGfm, promptLineBreaks];
const highlightPlugins: ComponentPropsWithoutRef<
  typeof ReactMarkdown
>["rehypePlugins"] = [[rehypeHighlight, { plainText: ["mermaid"] }]];
export const Markdown = memo(function Markdown({
  text,
  streaming = false,
  preserveLineBreaks = false,
  imageComponent,
}: {
  text: string;
  streaming?: boolean;
  preserveLineBreaks?: boolean;
  imageComponent?: ComponentType<ComponentPropsWithoutRef<"img"> & ExtraProps>;
}) {
  useTranslation();
  const value = useMemo(() => ({ text, streaming }), [text, streaming]);
  const components = useMemo(
    () => ({
      pre: CodeBlock,
      a: MarkdownAnchor,
      img: imageComponent ?? MarkdownImage,
      table: MarkdownTable,
    }),
    [imageComponent],
  );
  return (
    <MarkdownContext.Provider value={value}>
      <div data-slot="markdown" className="markdown-content">
        <ReactMarkdown
          urlTransform={fileLinkUrlTransform}
          remarkPlugins={preserveLineBreaks ? promptPlugins : standardPlugins}
          rehypePlugins={highlightPlugins}
          components={components}
        >
          {text}
        </ReactMarkdown>
      </div>
    </MarkdownContext.Provider>
  );
});
