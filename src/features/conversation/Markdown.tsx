import { promptLineBreaks } from "./prompt-line-breaks";
import { ConversationImage } from "../../components/ImagePreview";
import { ScrollArea } from "../../components/ui";
import {
  createContext,
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
      <button
        className="absolute z-10 top-1.5 right-2 inline-flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-[7px] border-0 bg-elevated px-1 text-[11px] text-muted opacity-0 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:min-w-10 hover:bg-hover focus:opacity-100 group-hover/code:opacity-100 group-focus-within/code:opacity-100"
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
      </button>
      <ScrollArea orientation="both">
        <pre {...props} className="m-0 p-4 pr-14 text-[13px] leading-[1.65]">
          {children}
        </pre>
      </ScrollArea>
    </div>
  );
}
export function Markdown({
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
  return (
    <MarkdownContext.Provider value={{ text, streaming }}>
      <div data-slot="markdown" className="markdown-content">
        <ReactMarkdown
          urlTransform={fileLinkUrlTransform}
          remarkPlugins={[
            remarkGfm,
            ...(preserveLineBreaks ? [promptLineBreaks] : []),
          ]}
          rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid"] }]]}
          components={{
            pre: CodeBlock,
            a: MarkdownAnchor,
            img: imageComponent ?? MarkdownImage,
            table: ({ children, ...props }) => (
              <ScrollArea orientation="both">
                <table {...props}>{children}</table>
              </ScrollArea>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    </MarkdownContext.Provider>
  );
}
