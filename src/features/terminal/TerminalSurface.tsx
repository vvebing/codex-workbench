import { useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  readAppearance,
  observeAppearance,
  type Appearance,
} from "../../lib/appearance";
import { t, useLocale } from "../../lib/i18n";
import { ErrorNotice } from "../../components/ui";
import type { TerminalSession, TerminalStore } from "./store";
import { outputUpdate } from "./presentation";
import "@xterm/xterm/css/xterm.css";

function terminalTheme(appearance: Appearance): ITheme {
  return {
    background: appearance.background,
    foreground: appearance.foreground,
    cursor: appearance.accent,
    cursorAccent: appearance.background,
    selectionBackground: appearance.selected,
    selectionForeground: appearance.foreground,
    black: appearance.foreground,
    brightBlack: appearance.muted,
    red: appearance.dark ? "#f59f91" : "#a83f32",
    green: appearance.success,
    yellow: appearance.warning,
    blue: appearance.dark ? "#a0bce8" : "#345c9c",
    magenta: appearance.dark ? "#d5aae1" : "#805293",
    cyan: appearance.dark ? "#99cbd1" : "#276870",
    white: appearance.dark ? "#d5d9d7" : "#5c6260",
    brightRed: appearance.dark ? "#ffb5aa" : "#9d3229",
    brightGreen: appearance.accent,
    brightYellow: appearance.dark ? "#f3d195" : "#805710",
    brightBlue: appearance.dark ? "#bed3f5" : "#31558e",
    brightMagenta: appearance.dark ? "#e4bdf1" : "#724384",
    brightCyan: appearance.dark ? "#b5e1e7" : "#215d65",
    brightWhite: appearance.foreground,
  };
}

/** Readiness is visible to both browser input and explicit prompt-fill controls. */
function synchronizeInput(term: Terminal, writable: boolean) {
  term.options.disableStdin = !writable;
  term.textarea?.setAttribute(
    "aria-label",
    writable ? t("终端输入") : t("终端输出（只读）"),
  );
  if (term.textarea) term.textarea.readOnly = !writable;
}

export interface TerminalSurfaceProps {
  session: TerminalSession;
  store: TerminalStore;
  writable: boolean;
  onSelectionChange: (selection: string) => void;
  onReadyChange?: (ready: boolean) => void;
}

export function TerminalSurface({
  session,
  store,
  writable,
  onSelectionChange,
  onReadyChange,
}: TerminalSurfaceProps) {
  const locale = useLocale();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const progress = useRef<number | null>(null);
  const replaying = useRef(true);
  const replayGeneration = useRef(0);
  const current = useRef({ writable, onSelectionChange, onReadyChange });
  current.current = { writable, onSelectionChange, onReadyChange };
  const [error, setError] = useState("");
  const id = session.id;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let frame: number | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let previousSize = "";
    const appearance = readAppearance();
    const term = new Terminal({
      fontFamily: appearance.codeFontFamily,
      fontSize: appearance.codeFontSize,
      lineHeight: 1.35,
      theme: terminalTheme(appearance),
      cursorBlink: false,
      cursorStyle: "bar",
      scrollback: 3000,
      scrollOnUserInput: true,
      screenReaderMode: true,
      minimumContrastRatio: 4.5,
      disableStdin: true,
      altClickMovesCursor: false,
      // Explicit browser actions own links and clipboard access.
      linkHandler: { activate: () => {} },
    });
    const fit = new FitAddon();
    terminal.current = term;
    progress.current = null;
    replaying.current = true;
    current.current.onReadyChange?.(false);
    term.loadAddon(fit);
    const fitTerminal = () => {
      if (disposed || element.clientWidth < 20 || element.clientHeight < 20)
        return;
      try {
        fit.fit();
      } catch {
        // Fonts/layout may not be ready during the first observer delivery.
        return;
      }
      const size = `${term.cols}:${term.rows}`;
      if (size === previousSize || !current.current.writable) return;
      previousSize = size;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!disposed && current.current.writable)
          void store.resize(id, { cols: term.cols, rows: term.rows });
      }, 80);
    };
    const scheduleFit = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitTerminal);
    };
    try {
      term.open(element);
      synchronizeInput(term, false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      terminal.current = null;
      term.dispose();
      return;
    }
    const input = term.onData((text) => {
      // Replayed output can contain terminal queries. Never send their replies
      // (or stale keystrokes) into a newly connected shell.
      if (!disposed && !replaying.current && current.current.writable)
        void store.write(id, text);
    });
    const selection = term.onSelectionChange(() => {
      if (!disposed) current.current.onSelectionChange(term.getSelection());
    });
    term.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "Backquote")
        return false;
      if (replaying.current) return false;
      const key = event.key.toLowerCase();
      const copy =
        (event.ctrlKey &&
          key === "c" &&
          (event.shiftKey || term.hasSelection())) ||
        (event.metaKey && key === "c");
      const paste =
        (event.ctrlKey && event.shiftKey && key === "v") ||
        (event.metaKey && key === "v");
      if (copy) {
        if (event.type === "keydown" && term.hasSelection()) {
          event.preventDefault();
          void navigator.clipboard.writeText(term.getSelection()).catch(() => {
            if (!disposed) setError(t("复制失败，请检查浏览器剪贴板权限。"));
          });
        }
        return false;
      }
      if (paste) {
        if (event.type === "keydown" && current.current.writable) {
          event.preventDefault();
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (!disposed && !replaying.current && current.current.writable)
                term.paste(text);
            })
            .catch(() => {
              if (!disposed)
                setError(t("无法读取剪贴板，请使用浏览器粘贴操作。"));
            });
        }
        return false;
      }
      return current.current.writable;
    });
    const resize = new ResizeObserver(scheduleFit);
    resize.observe(element);
    const offAppearance = observeAppearance((next) => {
      term.options.theme = terminalTheme(next);
      term.options.fontFamily = next.codeFontFamily;
      term.options.fontSize = next.codeFontSize;
      scheduleFit();
    });
    scheduleFit();
    if (current.current.writable) term.focus();
    void document.fonts?.ready.then(() => {
      if (!disposed) scheduleFit();
    });
    return () => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(resizeTimer);
      resize.disconnect();
      offAppearance();
      input.dispose();
      selection.dispose();
      if (terminal.current === term) terminal.current = null;
      term.dispose();
      current.current.onSelectionChange("");
      current.current.onReadyChange?.(false);
      // The execution store owns the process; hiding this view never stops it.
    };
  }, [id, store]);

  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    const update = outputUpdate(session, progress.current);
    if (update.reset) {
      replaying.current = true;
      replayGeneration.current++;
      synchronizeInput(term, false);
      current.current.onReadyChange?.(false);
      term.reset();
    }
    const generation = replayGeneration.current;
    const completeReplay = () => {
      if (terminal.current !== term || generation !== replayGeneration.current)
        return;
      replaying.current = false;
      synchronizeInput(term, current.current.writable);
      current.current.onReadyChange?.(current.current.writable);
    };
    progress.current = update.end;
    if (update.text) {
      term.write(update.text, () => {
        if (update.reset) completeReplay();
      });
    } else if (update.reset) completeReplay();
  }, [session]);

  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    const ready = writable && !replaying.current;
    synchronizeInput(term, ready);
    current.current.onReadyChange?.(ready);
    if (!writable) term.blur();
  }, [writable, locale]);

  return (
    <div className="terminal-surface-wrap">
      {error && (
        <ErrorNotice onDismiss={() => setError("")}>{error}</ErrorNotice>
      )}
      <div
        ref={host}
        className="terminal-surface"
        data-slot="terminal-surface"
        data-terminal-id={id}
      />
    </div>
  );
}
