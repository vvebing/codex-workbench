import { useLayoutEffect, useRef, useState } from "react";

/** Keep a submitted question in place while its controls become a receipt. */
export function useStableQuestionCard(receipt: boolean, busy = false) {
  const ref = useRef<HTMLElement | null>(null);
  const capturedWidth = useRef<number | undefined>(undefined);
  const focusWasInside = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [minHeight, setMinHeight] = useState<number>();
  const preserve = () => {
    const card = ref.current;
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    setMinHeight(bounds.height);
    capturedWidth.current = bounds.width;
    focusWasInside.current = card.contains(document.activeElement);
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  };
  useLayoutEffect(() => {
    const card = ref.current;
    if (!busy && focusWasInside.current && card) {
      if (!card.contains(document.activeElement)) {
        const target =
          !receipt && previousFocus.current?.isConnected
            ? previousFocus.current
            : card;
        target.focus({ preventScroll: true });
      }
      focusWasInside.current = false;
    }
  }, [receipt, busy]);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const releaseHeight = () => {
      capturedWidth.current = undefined;
      setMinHeight(undefined);
    };
    // A breakpoint can move the panel without changing its measured width.
    // Release the old footprint whenever the viewport layout changes as well.
    window.addEventListener("resize", releaseHeight);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (
              capturedWidth.current !== undefined &&
              Math.abs(
                card.getBoundingClientRect().width - capturedWidth.current,
              ) > 1
            ) {
              releaseHeight();
            }
          });
    observer?.observe(card);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", releaseHeight);
    };
  }, []);
  return { ref, preserve, minHeight };
}
