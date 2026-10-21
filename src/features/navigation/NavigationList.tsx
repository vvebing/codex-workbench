import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { ScrollArea } from "../../components/ui";
import { navigationState } from "./navigation-state";
import {
  navigationAnchor,
  navigationLayout,
  navigationObservedTop,
  navigationRenderedIndices,
  navigationRestore,
  navigationScrollTop,
  navigationStickyProject,
  navigationWindow,
  type NavigationListRow,
} from "./navigation-window";
export { navigationWindow, type NavigationListRow } from "./navigation-window";

export function NavigationList<T extends NavigationListRow>({
  rows,
  scope,
  selectedKey,
  selectionRevision,
  selectionLoading = false,
  focusKey,
  onFocusKey,
  onKeyDown,
  render,
}: {
  rows: T[];
  scope: string;
  selectedKey?: string;
  selectionRevision?: number | string;
  selectionLoading?: boolean;
  focusKey?: string;
  onFocusKey: (key: string) => void;
  onKeyDown?: (event: KeyboardEvent, key: string) => void;
  render: (row: T, tabStop: boolean) => ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, height: 600 });
  const [focusedKey, setFocusedKey] = useState<string>();
  const layout = useMemo(() => navigationLayout(rows), [rows]);
  const visible = navigationWindow(rows, position.top, position.height, layout);
  const previous = useRef<
    { scope: string; rows: T[]; layout: typeof layout } | undefined
  >(undefined);
  const lastTop = useRef(0);
  const focusFrame = useRef(0);
  const restore = useRef<{ scope: string; target: number } | undefined>({
    scope,
    target: navigationState.scrollPosition(scope),
  });
  const initialSavedPosition = useRef(restore.current?.target || 0);
  const priorSelection = useRef({
    key: selectedKey,
    revision: selectionRevision,
  });
  const selectionScope = useRef(scope);
  const scopeSelections = useRef(
    new Map<string, { key?: string; revision?: number | string }>(),
  );
  const pendingSelection = useRef(
    initialSavedPosition.current ? undefined : selectedKey,
  );
  const followingSelection = useRef(!!pendingSelection.current);
  const virtual = rows.length > 120;
  const projects = useMemo(
    () => rows.flatMap((row, index) => (row.sticky ? [index] : [])),
    [rows],
  );
  const sticky = navigationStickyProject(rows, layout, projects, position.top);
  const projectHeights = useMemo(
    () =>
      new Map(
        projects.map((index, project) => [
          index,
          (layout.offsets[projects[project + 1]] ?? layout.total) -
            layout.offsets[index],
        ]),
      ),
    [projects, layout],
  );
  const rendered = navigationRenderedIndices(
    rows.length,
    visible.start,
    visible.end,
    focusedKey ? layout.indices.get(focusedKey) : undefined,
    virtual,
    sticky?.index,
  );
  const renderedKeys = new Set(
    rendered
      .filter((index) => rows[index].navigable)
      .map((index) => rows[index].key),
  );
  const effectiveFocus =
    [focusedKey, focusKey, selectedKey].find(
      (key) => key && renderedKeys.has(key),
    ) || rows[rendered.find((index) => rows[index].navigable) ?? -1]?.key;

  function measure(element: HTMLDivElement) {
    const top = element.scrollTop;
    const height = element.clientHeight;
    lastTop.current = top;
    setPosition((old) =>
      old.top === top && old.height === height ? old : { top, height },
    );
  }
  function cancelRestore() {
    restore.current = undefined;
    pendingSelection.current = undefined;
    followingSelection.current = false;
  }
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const entering = previous.current?.scope !== scope;
    if (entering) {
      restore.current = {
        scope,
        target: navigationState.scrollPosition(scope),
      };
      cancelAnimationFrame(focusFrame.current);
      setFocusedKey(undefined);
    }
    let top = navigationObservedTop(
      lastTop.current,
      element.scrollTop,
      previous.current?.layout.total ?? layout.total,
      layout.total,
      element.clientHeight,
    );
    if (restore.current?.scope === scope) {
      const restored = navigationRestore(
        restore.current.target,
        layout.total,
        element.clientHeight,
      );
      top = restored.top;
      if (!restored.pending) restore.current = undefined;
    } else if (previous.current && previous.current.rows !== rows) {
      top = navigationAnchor(
        previous.current.rows,
        previous.current.layout,
        layout,
        top,
        element.clientHeight,
      );
    } else top = navigationScrollTop(top, layout.total, element.clientHeight);
    element.scrollTop = top;
    previous.current = { scope, rows, layout };
    measure(element);
    if (!restore.current) navigationState.saveScroll(scope, element.scrollTop);
  }, [rows, scope, layout, position.height]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => measure(element));
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(focusFrame.current);
    };
  }, []);

  function focus(row: T) {
    const index = layout.indices.get(row.key)!;
    const element = viewport.current;
    if (!element) return;
    cancelRestore();
    const top = layout.offsets[index];
    const bottom = top + row.height;
    const covered =
      sticky && sticky.index !== index ? rows[sticky.index].height : 0;
    if (top < element.scrollTop + covered)
      element.scrollTop = Math.max(0, top - covered);
    else if (bottom > element.scrollTop + element.clientHeight)
      element.scrollTop = bottom - element.clientHeight;
    measure(element);
    navigationState.saveScroll(scope, element.scrollTop);
    onFocusKey(row.key);
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      const target = [
        ...element.querySelectorAll<HTMLElement>("[data-navigation-key]"),
      ].find((node) => node.dataset.navigationKey === row.key);
      target
        ?.querySelector<HTMLElement>("[data-navigation-primary]")
        ?.focus({ preventScroll: true });
    });
  }
  // Keep a new selection pending until its summary page arrives. A scope change
  // alone restores that scope's reading position instead of following selection.
  useLayoutEffect(() => {
    const entering = selectionScope.current !== scope;
    const selectionChangedInScope =
      scopeSelections.current.has(scope) &&
      (scopeSelections.current.get(scope)?.key !== selectedKey ||
        scopeSelections.current.get(scope)?.revision !== selectionRevision);
    scopeSelections.current.set(scope, {
      key: selectedKey,
      revision: selectionRevision,
    });
    if (entering) {
      selectionScope.current = scope;
      pendingSelection.current = undefined;
      followingSelection.current = false;
    }
    if (
      selectedKey !== priorSelection.current.key ||
      selectionRevision !== priorSelection.current.revision
    ) {
      priorSelection.current = {
        key: selectedKey,
        revision: selectionRevision,
      };
      // Returning to a scope can make its existing selection visible again;
      // preserve the reading position unless that scope selected a new thread.
      if (
        !entering ||
        selectionChangedInScope ||
        !navigationState.scrollPosition(scope)
      ) {
        pendingSelection.current = selectedKey;
        followingSelection.current = !!selectedKey;
      }
    }
    // Additional summary pages can insert rows above a newly opened session.
    // Follow that target through discovery until the user scrolls or it finishes.
    if (followingSelection.current) pendingSelection.current = selectedKey;
    if (!pendingSelection.current) return;
    const index = layout.indices.get(pendingSelection.current);
    const element = viewport.current;
    if (index === undefined || !element) return;
    pendingSelection.current = undefined;
    restore.current = undefined;
    const top = layout.offsets[index];
    const covered =
      sticky && sticky.index !== index ? rows[sticky.index].height : 0;
    if (top < element.scrollTop + covered)
      element.scrollTop = Math.max(0, top - covered);
    else if (
      top + rows[index].height >
      element.scrollTop + element.clientHeight
    )
      element.scrollTop = top + rows[index].height - element.clientHeight;
    measure(element);
    navigationState.saveScroll(scope, element.scrollTop);
    if (!selectionLoading) followingSelection.current = false;
  }, [
    selectedKey,
    selectionRevision,
    selectionLoading,
    rows,
    scope,
    layout,
    sticky,
  ]);

  const navigable = useMemo(() => rows.filter((row) => row.navigable), [rows]);
  function handleKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    const key = target.closest<HTMLElement>("[data-navigation-key]")?.dataset
      .navigationKey;
    if (!key || !target.matches("[data-navigation-primary]")) return;
    cancelRestore();
    const index = navigable.findIndex((row) => row.key === key);
    const next =
      event.key === "ArrowDown"
        ? Math.min(index + 1, navigable.length - 1)
        : event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? navigable.length - 1
              : -1;
    if (next >= 0 && navigable[next]) {
      event.preventDefault();
      focus(navigable[next]);
    } else onKeyDown?.(event, key);
  }
  return (
    <ScrollArea
      className="min-h-0 flex-1"
      viewportRef={viewport}
      onPointerDownCapture={cancelRestore}
      viewportProps={{
        "aria-label": "会话列表",
        style: { overflowAnchor: "none" },
        onKeyDown: handleKey,
        onWheelCapture: cancelRestore,
        onTouchStartCapture: cancelRestore,
        onBlurCapture: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocusedKey(undefined);
        },
        onScroll: (event) => {
          const element = event.currentTarget;
          if (!restore.current)
            navigationState.saveScroll(scope, element.scrollTop);
          measure(element);
        },
      }}
    >
      <div
        role="tree"
        aria-label="项目与会话"
        data-slot="navigation-list"
        className="relative mx-2"
        style={{ height: layout.total }}
      >
        {rendered.map((index) => {
          const row = rows[index];
          const pinned =
            sticky?.index === index && sticky.top > layout.offsets[index];
          return (
            <div
              key={row.key}
              data-navigation-key={row.key}
              data-navigation-project-group={row.sticky || undefined}
              style={{
                position: "absolute",
                top: layout.offsets[index],
                zIndex: row.sticky ? 1 : undefined,
                left: 0,
                right: 0,
                height: row.sticky ? projectHeights.get(index) : row.height,
                pointerEvents: row.sticky ? "none" : undefined,
              }}
              onFocus={() => {
                setFocusedKey(row.key);
                onFocusKey(row.key);
              }}
            >
              {row.sticky ? (
                <div
                  className="navigation-project-heading sticky top-0"
                  data-sticky-project={pinned || undefined}
                  style={{ height: row.height, pointerEvents: "auto" }}
                >
                  {render(row, effectiveFocus === row.key)}
                </div>
              ) : (
                render(row, effectiveFocus === row.key)
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
