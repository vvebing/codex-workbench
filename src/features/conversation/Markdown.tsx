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
import { Check, Copy } from "lucide-react";
const ImageLinkContext = createContext(false);
function MarkdownAnchor(props: ComponentPropsWithoutRef<"a"> & ExtraProps) {
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
  const linked = useContext(ImageLinkContext);
  if (linked)
    return <img src={src} alt={alt} loading="lazy" decoding="async" />;
  return (
    <ConversationImage
      src={typeof src === "string" ? src : ""}
      name={alt || "对话图片"}
    />
  );
}
const MarkdownContext = createContext({ text: "", streaming: false });
function CodeBlock({
  children,
  node,
  ...props
}: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  const { text, streaming } = useContext(MarkdownContext);
  const [message, setMessage] = useState("");
  const code = node?.children.find(
    (child) => child.type === "element" && child.tagName === "code",
  );
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
      <Button
        size="sm"
        variant="quiet"
        className="absolute z-10 top-1.5 right-2 min-w-8 gap-1 bg-elevated px-1 text-meta opacity-0 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:min-w-10 focus:opacity-100 group-hover/code:opacity-100 group-focus-within/code:opacity-100"
        aria-label="复制代码"
        onClick={async (event) => {
          const code =
            event.currentTarget.parentElement?.querySelector("pre")
              ?.textContent ?? "";
          try {
            await navigator.clipboard.writeText(code);
            setMessage("已复制");
          } catch {
            setMessage("复制失败");
          }
          window.setTimeout(() => setMessage(""), 2000);
        }}
      >
        {message === "已复制" ? <Check size={14} /> : <Copy size={14} />}
        <span aria-live="polite">{message}</span>
      </Button>
      <ScrollArea scrollChaining orientation="both">
        <pre {...props} className="m-0 p-4 pr-14 text-code leading-code">
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
