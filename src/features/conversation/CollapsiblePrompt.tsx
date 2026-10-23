import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const PREVIEW_HEIGHT = 192;

/** Measure the rendered prompt so wrapping, code and attachments count equally. */
export function CollapsiblePrompt({
  children,
  preview,
}: {
  children: ReactNode;
  preview: string;
}) {
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setLong(element.scrollHeight > PREVIEW_HEIGHT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div data-slot="collapsible-prompt">
      {long && !expanded && (
        <p className="sr-only">{preview.slice(0, 300)}…（内容已折叠）</p>
      )}
      <div
        id={id}
        className="relative overflow-hidden"
        style={{ maxHeight: expanded ? undefined : PREVIEW_HEIGHT }}
      >
        <div ref={content} inert={long && !expanded ? true : undefined}>
          {children}
        </div>
        {long && !expanded && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent"
          />
        )}
      </div>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-xs text-muted hover:bg-hover hover:text-foreground max-[600px]:min-h-11"
          onClick={(event) => {
            if (expanded) {
              const prompt =
                event.currentTarget.closest<HTMLElement>("[data-prompt-id]");
              const viewport = prompt?.closest<HTMLElement>(
                "[data-radix-scroll-area-viewport]",
              );
              if (
                prompt &&
                viewport &&
                prompt.getBoundingClientRect().top <
                  viewport.getBoundingClientRect().top
              ) {
                viewport.scrollTop +=
                  prompt.getBoundingClientRect().top -
                  viewport.getBoundingClientRect().top -
                  16;
              }
            }
            setExpanded(!expanded);
          }}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {expanded ? "收起问题" : "展开完整问题"}
        </button>
      )}
    </div>
  );
}
