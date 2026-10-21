import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import {
  fitSidebars,
  setSidebarWidth,
  SIDEBARS,
  useSidebarWidths,
  type Side,
} from "./sidebar-layout";

export function ShellPanels({
  width,
  navigation,
  details,
  children,
}: {
  width: number;
  navigation?: ReactNode;
  details?: ReactNode;
  children: ReactNode;
}) {
  const preferred = useSidebarWidths();
  const group = useRef<ImperativePanelGroupHandle>(null);
  const draggingSide = useRef<Side | null>(null);
  const hasNavigation = !!navigation,
    hasDetails = !!details;
  const { available, left, right } = fitSidebars(
    width,
    preferred,
    hasNavigation,
    hasDetails,
  );
  const percent = (pixels: number) => (pixels / available) * 100;
  useLayoutEffect(() => {
    const layout = [
      (left / available) * 100,
      ((available - left - right) / available) * 100,
      (right / available) * 100,
    ];
    group.current?.setLayout(layout);
  }, [available, left, right, hasNavigation, hasDetails]);
  const persist = (side: Side) => {
    const sizes = group.current?.getLayout();
    if (!sizes) return;
    const index = side === "navigation" ? 0 : sizes.length - 1;
    setSidebarWidth(side, (sizes[index] / 100) * available);
  };
  const handle = (side: Side, label: string, visible: boolean) => (
    <PanelResizeHandle
      className="w-0.5 bg-border/60 transition-colors hover:bg-accent data-[resize-handle-active]:bg-accent"
      aria-label={label}
      disabled={!visible}
      style={visible ? undefined : { display: "none" }}
      onDragging={(dragging) => {
        if (dragging) draggingSide.current = side;
        else if (draggingSide.current === side) {
          draggingSide.current = null;
          persist(side);
        }
      }}
      onKeyUp={(event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          persist(side);
      }}
      onDoubleClick={() => setSidebarWidth(side, SIDEBARS[side].initial)}
    />
  );
  return (
    <PanelGroup
      direction="horizontal"
      ref={group}
      keyboardResizeBy={percent(16)}
    >
      {/* Keep panel registration stable when a sidebar collapses. */}
      <Panel
        id="navigation"
        order={1}
        defaultSize={percent(left)}
        minSize={hasNavigation ? percent(SIDEBARS.navigation.min) : 0}
        maxSize={hasNavigation ? percent(SIDEBARS.navigation.max) : 0}
      >
        {navigation}
      </Panel>
      {handle("navigation", "调整导航宽度", hasNavigation)}
      <Panel id="conversation" order={2} minSize={percent(480)}>
        {children}
      </Panel>
      {handle("details", "调整详情宽度", hasDetails)}
      <Panel
        id="details"
        order={3}
        defaultSize={percent(right)}
        minSize={hasDetails ? percent(SIDEBARS.details.min) : 0}
        maxSize={hasDetails ? percent(SIDEBARS.details.max) : 0}
      >
        {details}
      </Panel>
    </PanelGroup>
  );
}
