import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ScrollArea } from "../../components/ui";
import { projectPanelState } from "./project-panel-state";

/** Scroll belongs to the displayed resource, independently of the selected project tab. */
export function ResourceScrollArea({
  scope,
  resource,
  children,
}: {
  scope: string;
  resource: string;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const restoring = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    restoring.current = projectPanelState.position(scope, resource);
    const restore = () => {
      if (restoring.current === null) return;
      el.scrollTop = restoring.current;
      if (el.scrollHeight - el.clientHeight >= restoring.current)
        restoring.current = null;
    };
    restore();
    const observer = new ResizeObserver(restore);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (restoring.current === null)
        projectPanelState.savePosition(scope, resource, el.scrollTop);
    };
  }, [scope, resource]);
  return (
    <ScrollArea
      className="min-h-0 min-w-0 flex-1"
      viewportRef={viewport}
      onPointerDownCapture={() => {
        restoring.current = null;
      }}
      onKeyDownCapture={() => {
        restoring.current = null;
      }}
      viewportProps={{
        onWheelCapture: () => {
          restoring.current = null;
        },
        onTouchMove: () => {
          restoring.current = null;
        },
        onScroll: (event) => {
          if (restoring.current === null)
            projectPanelState.savePosition(
              scope,
              resource,
              event.currentTarget.scrollTop,
            );
        },
      }}
    >
      <div className="min-w-0 p-4">{children}</div>
    </ScrollArea>
  );
}
