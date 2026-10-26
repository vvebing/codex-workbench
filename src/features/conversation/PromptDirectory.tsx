import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Tooltip } from "radix-ui";
import { ChevronUp, ChevronDown, Undo2 } from "lucide-react";
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
  const { i18n } = useTranslation();
  const entries = useMemo(() => {
    // Attachment fallback labels follow language changes without resetting navigation.
    void i18n.language;
    return promptEntries(turns);
  }, [turns, i18n.language]);
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ above: false, below: false });
  const navigationFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(navigationFrame.current), []);
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
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 2)
        current = messages.at(-1) ?? current;
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
  function jump(id: string) {
    const el = viewport.current;
    if (!el) return;
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
    window.dispatchEvent(
      new CustomEvent("conversation-reveal-item", { detail: { itemId: id } }),
    );
    cancelAnimationFrame(navigationFrame.current);
    let attempts = 0;
    const locate = () => {
      window.dispatchEvent(
        new CustomEvent("conversation-reveal-item", { detail: { itemId: id } }),
      );
      const target = Array.from(
        el.querySelectorAll<HTMLElement>("[data-reading-id], [data-prompt-id]"),
      ).find(
        (node) =>
          (node.dataset.readingId === id || node.dataset.promptId === id) &&
          node.getClientRects().length > 0,
      );
      if (
        (!target || (target instanceof HTMLDetailsElement && !target.open)) &&
        attempts++ < 5
      ) {
        // The turn and its operation group may need separate commits to reveal.
        window.dispatchEvent(
          new CustomEvent("conversation-reveal-item", {
            detail: { itemId: id },
          }),
        );
        navigationFrame.current = requestAnimationFrame(locate);
        return;
      }
      if (!target) {
        return;
      }
      el.scrollTop +=
        target.getBoundingClientRect().top -
        el.getBoundingClientRect().top -
        32;
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
    };
    navigationFrame.current = requestAnimationFrame(locate);
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

  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const update = () =>
      setEdges({
        above: element.scrollTop > 1,
        below:
          element.scrollHeight - element.clientHeight - element.scrollTop > 1,
      });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [entries.length]);
  useEffect(() => {
    const element = rail.current;
    const button = element?.querySelector<HTMLElement>(
      '[aria-current="location"]',
    );
    if (!element || !button) return;
    const offset =
      button.getBoundingClientRect().top - element.getBoundingClientRect().top;
    if (offset < 0) element.scrollTop += offset;
    else if (offset + button.offsetHeight > element.clientHeight)
      element.scrollTop += offset + button.offsetHeight - element.clientHeight;
  }, [active]);
  if (!entries.length) return null;
  const activeIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.id === active),
  );
  return (
    <Tooltip.Provider delayDuration={150}>
      <nav className="prompt-directory-controls" aria-label={t("会话轮次导航")}>
        <button
          className="prompt-rail-control"
          aria-label={t("查看更早的问题")}
          disabled={!edges.above}
          onClick={() => rail.current?.scrollBy({ top: -176 })}
        >
          <ChevronUp size={15} />
        </button>
        <div
          ref={rail}
          className="prompt-dot-scroll"
          onKeyDown={(event) => {
            const buttons = Array.from(
              rail.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "ArrowDown"
                ? Math.min(index + 1, buttons.length - 1)
                : event.key === "ArrowUp"
                  ? Math.max(index - 1, 0)
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : undefined;
            if (next !== undefined) {
              event.preventDefault();
              buttons[next]?.focus();
            }
          }}
        >
          <div className="prompt-dot-list">
            {entries.map((entry, index) => (
              <Tooltip.Root key={entry.id}>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    className="prompt-dot"
                    aria-current={active === entry.id ? "location" : undefined}
                    aria-label={t("第 {{value0}} 条问题：{{value1}}", {
                      value0: index + 1,
                      value1: entry.label.slice(0, 120),
                    })}
                    onClick={() => jump(entry.id)}
                  >
                    <span aria-hidden="true" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="left"
                    sideOffset={8}
                    collisionPadding={12}
                    className="prompt-dot-tooltip"
                  >
                    <span className="mb-1 block text-xs text-muted">
                      {t("第 {{value0}} 条问题 · 第 {{value1}} 轮", {
                        value0: index + 1,
                        value1: entry.turn,
                      })}
                    </span>
                    <span className="line-clamp-4">
                      {entry.label.slice(0, 500)}
                    </span>
                    <Tooltip.Arrow className="fill-border" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            ))}
          </div>
        </div>
        <button
          className="prompt-rail-control"
          aria-label={t("查看后续问题")}
          disabled={!edges.below}
          onClick={() => rail.current?.scrollBy({ top: 176 })}
        >
          <ChevronDown size={15} />
        </button>
        <span
          className="prompt-dot-count"
          aria-label={t("当前第 {{value0}} 条，共 {{value1}} 条问题", {
            value0: activeIndex + 1,
            value1: entries.length,
          })}
        >
          {activeIndex + 1}/{entries.length}
        </span>
        {canReturn && (
          <button
            type="button"
            className="prompt-rail-control"
            aria-label={t("返回阅读位置")}
            title={t("返回阅读位置")}
            onClick={returnToReading}
          >
            <Undo2 size={15} />
          </button>
        )}
      </nav>
    </Tooltip.Provider>
  );
}
