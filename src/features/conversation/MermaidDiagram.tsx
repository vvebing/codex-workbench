import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";
import { Button, IconButton, Modal, ScrollArea } from "../../components/ui";
import { observeAppearance, readAppearance } from "../../lib/appearance";
import { renderMermaid } from "./mermaid-renderer";

export function MermaidDiagram({
  source,
  pending = false,
}: {
  source: string;
  pending?: boolean;
}) {
  const [appearance, setAppearance] = useState(readAppearance);
  useEffect(() => {
    setAppearance(readAppearance());
    return observeAppearance(setAppearance);
  }, []);
  const [view, setView] = useState<"diagram" | "source">("diagram");
  const [rendered, setRendered] = useState<{
    source: string;
    appearance: typeof appearance;
    svg: string;
  }>();
  const [error, setError] = useState<{
    source: string;
    appearance: typeof appearance;
    message: string;
  }>();
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [copied, setCopied] = useState("");
  const [retry, setRetry] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = wrapper.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || pending) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderMermaid(source, appearance).then(
        (svg) => {
          if (!cancelled) {
            setRendered({ source, appearance, svg });
            setError(undefined);
          }
        },
        (cause) => {
          if (!cancelled)
            setError({
              source,
              appearance,
              message:
                cause instanceof Error
                  ? cause.message
                  : "请检查 Mermaid 语法。",
            });
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, appearance, pending, visible, retry]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const currentSvg =
    rendered?.source === source && rendered.appearance === appearance
      ? rendered.svg
      : undefined;
  const currentError =
    !pending && error?.source === source && error.appearance === appearance
      ? error.message
      : undefined;
  const expandedSvg = useMemo(() => {
    if (!currentSvg) return "";
    const parsed = new DOMParser().parseFromString(currentSvg, "image/svg+xml");
    const svg = parsed.documentElement;
    svg.setAttribute(
      "style",
      `${svg.getAttribute("style") || ""};max-width:none`,
    );
    svg.setAttribute("width", "100%");
    return new XMLSerializer().serializeToString(svg);
  }, [currentSvg]);
  const diagram = (large = false) => (
    <ScrollArea
      orientation="both"
      className={large ? "max-h-[65vh]" : "max-h-[480px]"}
    >
      <div
        data-slot="mermaid-svg"
        role="img"
        aria-label="Mermaid 图表"
        className="p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        style={large ? { width: `${zoom}%`, minWidth: `${zoom}%` } : undefined}
        dangerouslySetInnerHTML={{
          __html: large ? expandedSvg : currentSvg || "",
        }}
      />
    </ScrollArea>
  );
  return (
    <div
      ref={wrapper}
      data-slot="mermaid-block"
      className="my-4 overflow-hidden rounded-lg border border-border bg-surface first:mt-0 last:mb-0"
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="mr-2 text-meta font-medium text-muted">Mermaid</span>
        <Button
          size="sm"
          variant="quiet"
          aria-pressed={view === "diagram"}
          onClick={() => setView("diagram")}
        >
          图表
        </Button>
        <Button
          size="sm"
          variant="quiet"
          aria-pressed={view === "source"}
          onClick={() => setView("source")}
        >
          源码
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="quiet"
          aria-label="复制 Mermaid 源码"
          onClick={() => {
            void navigator.clipboard.writeText(source).then(
              () => setCopied("已复制"),
              () => setCopied("复制失败，请重试"),
            );
          }}
        >
          {copied === "已复制" ? <Check size={14} /> : <Copy size={14} />}
          <span role="status">{copied || "复制"}</span>
        </Button>
        <IconButton
          label="放大图表"
          disabled={!currentSvg}
          onClick={() => {
            setZoom(100);
            setExpanded(true);
          }}
        >
          <Maximize2 size={14} />
        </IconButton>
      </div>
      {view === "source" ? (
        <ScrollArea orientation="both" className="max-h-[420px]">
          <pre className="m-0 p-4 text-xs leading-relaxed">
            <code>{source}</code>
          </pre>
        </ScrollArea>
      ) : currentError ? (
        <div className="p-4">
          <p role="status" className="text-xs text-muted">
            图表暂时无法显示，可查看源码检查语法。
          </p>
          <details className="mt-2 text-xs text-muted">
            <summary className="cursor-pointer">查看错误详情</summary>
            <pre className="whitespace-pre-wrap break-words pt-2">
              {currentError}
            </pre>
          </details>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试
          </Button>
          <ScrollArea orientation="both" className="max-h-[420px]">
            <pre className="m-0 pt-3 text-xs leading-relaxed">
              <code>{source}</code>
            </pre>
          </ScrollArea>
        </div>
      ) : currentSvg && !expanded ? (
        diagram()
      ) : (
        <div
          role="status"
          className="flex min-h-24 items-center justify-center gap-2 p-4 text-xs text-muted"
        >
          <LoaderCircle size={15} className="animate-spin" />
          {pending
            ? "图表生成中…"
            : expanded
              ? "正在放大查看图表"
              : "正在渲染图表…"}
        </div>
      )}
      <Modal
        open={expanded}
        onOpenChange={setExpanded}
        title="Mermaid 图表"
        className="max-w-[1100px]!"
        description="放大查看图表，超出区域时可滚动浏览。"
      >
        <div className="mb-3 flex items-center gap-2">
          <IconButton
            label="缩小图表"
            disabled={zoom <= 50}
            onClick={() => setZoom((value) => Math.max(50, value - 25))}
          >
            <Minus size={15} />
          </IconButton>
          <span className="text-xs text-muted">{zoom}%</span>
          <IconButton
            label="放大一级"
            disabled={zoom >= 300}
            onClick={() => setZoom((value) => Math.min(300, value + 25))}
          >
            <Plus size={15} />
          </IconButton>
          <Button size="sm" variant="quiet" onClick={() => setZoom(100)}>
            适应宽度
          </Button>
        </div>
        {diagram(true)}
      </Modal>
    </div>
  );
}
