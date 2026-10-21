import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Popover } from "radix-ui";
import { List, Search, Undo2, X } from "lucide-react";
import { IconButton, ScrollArea } from "../../components/ui";
import type { Thread } from "../../generated/v2/Thread";
import { promptEntries } from "./prompt-directory";
import "./prompt-directory.css";

export function PromptDirectory({
  turns,
  viewport,
  onNavigate,
}: {
  turns: Thread["turns"];
  viewport: RefObject<HTMLDivElement | null>;
  onNavigate: () => void;
}) {
  const entries = useMemo(() => promptEntries(turns), [turns]);
  const searchInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const [canReturn, setCanReturn] = useState(false);
  const saved = useRef<{
    element?: HTMLElement;
    offset: number;
    top: number;
  } | null>(null);
  const highlighted = useRef<Animation | null>(null);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      const top = el.getBoundingClientRect().top + 48;
      const messages = Array.from(
        el.querySelectorAll<HTMLElement>("[data-prompt-id]"),
      );
      let current = messages[0];
      for (const message of messages) {
        if (message.getBoundingClientRect().top > top) break;
        current = message;
      }
      setActive(current?.dataset.promptId ?? "");
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
      highlighted.current?.cancel();
    };
  }, [viewport, entries.length]);
  const messages = () =>
    Array.from(
      viewport.current?.querySelectorAll<HTMLElement>("[data-prompt-id]") ?? [],
    );
  function jump(id: string) {
    const el = viewport.current;
    const target = messages().find(
      (message) => message.dataset.promptId === id,
    );
    if (!el || !target) return;
    if (!saved.current) {
      const top = el.getBoundingClientRect().top;
      const element = Array.from(
        el.querySelectorAll<HTMLElement>("article"),
      ).find((node) => node.getBoundingClientRect().bottom > top);
      saved.current = {
        element,
        offset: element ? element.getBoundingClientRect().top - top : 0,
        top: el.scrollTop,
      };
      setCanReturn(true);
    }
    onNavigate();
    el.scrollTop +=
      target.getBoundingClientRect().top - el.getBoundingClientRect().top - 24;
    highlighted.current?.cancel();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      highlighted.current = target.animate(
        [
          { outline: "3px solid var(--accent)", outlineOffset: "4px" },
          { outline: "3px solid transparent", outlineOffset: "4px" },
        ],
        { duration: 1600 },
      );
    }
    setActive(id);
    setOpen(false);
  }
  function returnToReading() {
    const el = viewport.current;
    const position = saved.current;
    if (!el || !position) return;
    onNavigate();
    el.scrollTop = position.element?.isConnected
      ? el.scrollTop +
        position.element.getBoundingClientRect().top -
        el.getBoundingClientRect().top -
        position.offset
      : position.top;
    saved.current = null;
    setCanReturn(false);
  }
  if (!entries.length) return null;
  const filtered = entries.filter((entry) =>
    entry.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div className="prompt-directory-controls">
      {canReturn && (
        <button
          type="button"
          className="prompt-directory-trigger"
          onClick={returnToReading}
        >
          <Undo2 size={15} />
          返回阅读位置
        </button>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className="prompt-directory-trigger"
          aria-label={`会话目录，${entries.length} 条用户问题`}
        >
          <List size={16} />
          <span>会话目录</span>
          <span className="text-muted">{entries.length}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="prompt-directory-panel"
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchInput.current?.focus();
            }}
            aria-label="会话目录"
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <strong className="text-sm">会话目录</strong>
              <Popover.Close asChild>
                <IconButton label="关闭会话目录">
                  <X size={16} />
                </IconButton>
              </Popover.Close>
            </div>
            <label className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <Search size={15} className="shrink-0 text-muted" />
              <input
                ref={searchInput}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索用户问题"
                aria-label="搜索用户问题"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <ScrollArea className="prompt-directory-scroll">
              <nav aria-label="用户问题" className="prompt-directory-list">
                {filtered.map((entry, index) => (
                  <button
                    type="button"
                    key={entry.id}
                    aria-current={active === entry.id ? "location" : undefined}
                    title={entry.text}
                    onClick={() => jump(entry.id)}
                    className="prompt-directory-entry"
                  >
                    <span className="text-xs tabular-nums text-muted">
                      {entries.indexOf(entry) + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 break-words text-sm">
                        {entry.label}
                      </span>
                      <span className="text-xs text-muted">
                        第 {entry.turn} 轮
                        {query && index === 0 ? " · 搜索结果" : ""}
                      </span>
                    </span>
                  </button>
                ))}
                {!filtered.length && (
                  <p
                    role="status"
                    className="p-5 text-center text-sm text-muted"
                  >
                    没有匹配的用户问题
                  </p>
                )}
              </nav>
            </ScrollArea>
            <p className="border-t border-border px-4 py-2 text-xs text-muted">
              {query
                ? `找到 ${filtered.length} 条问题`
                : "点击问题跳转，可返回之前的阅读位置"}
            </p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
