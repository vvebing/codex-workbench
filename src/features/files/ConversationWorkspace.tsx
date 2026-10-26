import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import { FileWorkspace } from "./FileWorkspace";

const SPLIT_MIN_WIDTH = 960;
const SIZE_KEY = "codex-workbench-editor-ratio";
function savedRatio() {
  try {
    const ratio = Number(localStorage.getItem(SIZE_KEY));
    return ratio >= 30 && ratio <= 70 ? ratio : 50;
  } catch {
    return 50;
  }
}

/** Keep both views mounted so changing layouts preserves scroll, drafts and undo. */
export function ConversationWorkspace({ children }: { children: ReactNode }) {
  const { files } = useRuntime();
  const state = useStore(files);
  useEffect(() => {
    const visibility = () =>
      files.setPageVisible(document.visibilityState !== "hidden");
    const focus = () => files.validateActive();
    visibility();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus);
    };
  }, [files]);
  const container = useRef<HTMLDivElement>(null);
  const group = useRef<ImperativePanelGroupHandle>(null);
  const ratio = useRef(savedRatio());
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  const canSplit = width >= SPLIT_MIN_WIDTH;
  const mode = !state.visible
    ? "conversation"
    : canSplit && !focused
      ? "split"
      : "editor";
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(container.current!);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    group.current?.setLayout(
      mode === "split"
        ? [ratio.current, 100 - ratio.current]
        : mode === "editor"
          ? [0, 100]
          : [100, 0],
    );
  }, [mode]);
  const previousMode = useRef(mode);
  useEffect(() => {
    const previous = previousMode.current;
    previousMode.current = mode;
    if (mode !== "conversation" || previous === "conversation") return;
    const frame = requestAnimationFrame(() => {
      container.current
        ?.querySelector<HTMLElement>(
          '[role="textbox"][aria-label="消息输入框"]',
        )
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [mode]);
  return (
    <div ref={container} className="conversation-workspace" data-layout={mode}>
      <PanelGroup
        direction="horizontal"
        ref={group}
        onLayout={(sizes) => {
          if (mode === "split" && sizes[0] >= 30 && sizes[0] <= 70) {
            ratio.current = sizes[0];
            try {
              localStorage.setItem(SIZE_KEY, String(sizes[0]));
            } catch {
              /* Storage is optional. */
            }
          }
        }}
      >
        <Panel
          id="chat"
          order={1}
          defaultSize={100}
          minSize={mode === "split" ? 30 : 0}
          maxSize={mode === "split" ? 70 : 100}
        >
          <section
            className="@container/conversation flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
            data-slot="conversation-pane"
            aria-label="会话内容"
            aria-hidden={mode === "editor" ? true : undefined}
            inert={mode === "editor"}
            style={mode === "editor" ? { display: "none" } : undefined}
          >
            {children}
          </section>
        </Panel>
        <PanelResizeHandle
          className="conversation-editor-resize"
          aria-label="调整会话与编辑器宽度"
          title="拖动调整宽度，双击或按 Enter 恢复均分"
          onDoubleClick={() => group.current?.setLayout([50, 50])}
          onKeyDown={(event) => {
            if (event.key === "Enter" && mode === "split") {
              event.preventDefault();
              group.current?.setLayout([50, 50]);
            }
          }}
          disabled={mode !== "split"}
          style={mode === "split" ? undefined : { display: "none" }}
        />
        <Panel
          id="editor"
          order={2}
          defaultSize={0}
          minSize={mode === "split" ? 30 : 0}
        >
          <FileWorkspace
            canSplit={canSplit}
            focused={focused}
            onToggleFocus={() => setFocused((value) => !value)}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
