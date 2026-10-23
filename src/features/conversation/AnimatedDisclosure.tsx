import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { animateHeight } from "./height-motion";
import { BEFORE_EXECUTION_LAYOUT } from "./AnimatedExecution";

/** Keep the outgoing content and native details open until its height reaches zero. */
export function AnimatedDisclosure({
  open,
  summary,
  children,
  animate = true,
  ...props
}: HTMLAttributes<HTMLElement> & {
  open: boolean;
  summary?: ReactNode;
  animate?: boolean;
}) {
  const [retained, setRetained] = useState(open);
  const present = open || retained;
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const fade = useRef<Animation | null>(null);
  const targetHeight = useRef<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const resizeFrame = useRef(0);
  const previousOpen = useRef(open);
  const previousChildren = useRef(children);

  const stopObserving = useCallback(() => {
    observer.current?.disconnect();
    observer.current = null;
    cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = 0;
  }, []);

  const move = useCallback(
    function move(
      element: HTMLElement,
      inner: HTMLElement,
      to: number,
      from: number,
    ) {
      targetHeight.current = to;
      const current = animateHeight(element, from, to, animation.current);
      animation.current = current;
      if (previousOpen.current && !observer.current) {
        observer.current = new ResizeObserver(() => {
          // Resize delivery must not write an ancestor's height in the same pass.
          if (!resizeFrame.current)
            resizeFrame.current = requestAnimationFrame(() => {
              resizeFrame.current = 0;
              const latest = inner.getBoundingClientRect().height;
              if (
                animation.current &&
                Math.abs(latest - (targetHeight.current ?? latest)) >= 1
              )
                move(
                  element,
                  inner,
                  latest,
                  element.getBoundingClientRect().height,
                );
            });
        });
        observer.current.observe(inner);
      } else if (!previousOpen.current) {
        stopObserving();
      }
      current.onfinish = () => {
        const latest = previousOpen.current
          ? inner.getBoundingClientRect().height
          : 0;
        if (Math.abs(latest - to) >= 1) {
          move(element, inner, latest, to);
          return;
        }
        animation.current = null;
        targetHeight.current = null;
        stopObserving();
        setRetained(previousOpen.current);
        if (!previousOpen.current) element.style.height = "0px";
        fade.current?.cancel();
        fade.current = null;
        current.cancel();
      };
    },
    [stopObserving],
  );

  useLayoutEffect(() => {
    if (open) previousChildren.current = children;
  }, [open, children]);

  useLayoutEffect(() => {
    // Automatic instant results can cancel motion; manual toggles opt in at
    // the caller. Initial open state never animates because it has not changed.
    if (!animate) {
      previousOpen.current = open;
      animation.current?.cancel();
      animation.current = null;
      stopObserving();
      fade.current?.cancel();
      fade.current = null;
      if (viewport.current) viewport.current.style.height = "";
      setRetained(open);
      return;
    }
    if (previousOpen.current === open) return;
    previousOpen.current = open;
    const element = viewport.current;
    const inner = content.current;
    if (!element || !inner) return;
    element.style.height = "";

    // A rapid reversal starts at the currently displayed height.
    const from = animation.current
      ? element.getBoundingClientRect().height
      : open
        ? 0
        : inner.getBoundingClientRect().height;
    const to = open ? inner.getBoundingClientRect().height : 0;
    if (
      from === to ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      animation.current?.cancel();
      animation.current = null;
      stopObserving();
      fade.current?.cancel();
      setRetained(open);
      return;
    }

    setRetained(true);
    const opacity = fade.current
      ? getComputedStyle(inner).opacity
      : open
        ? "0"
        : "1";
    fade.current?.cancel();
    fade.current = inner.animate([{ opacity }, { opacity: open ? 1 : 0 }], {
      duration: open ? 200 : 160,
      easing: "ease-out",
      fill: "both",
    });
    move(element, inner, to, from);
  }, [open, animate, move, stopObserving]);

  useLayoutEffect(
    () => () => {
      animation.current?.cancel();
      fade.current?.cancel();
      stopObserving();
    },
    [stopObserving],
  );

  const body = (
    <div
      ref={viewport}
      data-slot="disclosure-content"
      hidden={!present}
      inert={!open}
      aria-hidden={!open}
      className="min-w-0 overflow-hidden"
    >
      {present && (
        <div ref={content} className="flow-root min-w-0">
          {open ? children : previousChildren.current}
        </div>
      )}
    </div>
  );
  return summary ? (
    <details
      {...props}
      open={present}
      onClickCapture={(event) => {
        props.onClickCapture?.(event);
        // Nested result toggles do not change the surrounding execution items.
        // Capture the reading position before their own state updates commit.
        if (
          (event.target as Element).closest("summary") ===
          event.currentTarget.querySelector(":scope > summary")
        )
          event.currentTarget.dispatchEvent(
            new Event(BEFORE_EXECUTION_LAYOUT, { bubbles: true }),
          );
      }}
    >
      {summary}
      {body}
    </details>
  ) : (
    <div {...props} hidden={!present}>
      {body}
    </div>
  );
}
