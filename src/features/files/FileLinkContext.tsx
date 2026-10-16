import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type ComponentPropsWithoutRef,
} from "react";
import { defaultUrlTransform, type ExtraProps } from "react-markdown";
import { useRuntime } from "../../lib/runtime-context";
import { parseFileLink, type FileLinkOrigin } from "./file-links";

const FileLinkContext = createContext<FileLinkOrigin | null>(null);

export function useFileLinkOrigin() {
  return useContext(FileLinkContext);
}

export function FileLinkProvider({
  cwd,
  threadId,
  children,
}: FileLinkOrigin & { children: ReactNode }) {
  return (
    <FileLinkContext.Provider value={{ cwd, threadId }}>
      {children}
    </FileLinkContext.Provider>
  );
}

export function FileAnchor({
  href,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  const origin = useContext(FileLinkContext);
  const runtime = useRuntime();
  const [error, setError] = useState("");
  void _node;
  const target = href && origin ? parseFileLink(href, origin) : null;
  if (!target)
    return (
      <a {...props} href={href ? defaultUrlTransform(href) : href}>
        {children}
      </a>
    );
  return (
    <a
      {...props}
      href={href}
      title={error || props.title || target.path}
      onClick={(event) => {
        event.preventDefault();
        void runtime.files
          .open(target)
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "无法打开文件"),
          );
      }}
    >
      {children}
    </a>
  );
}

/** Explicit current-file action next to the preserved historical patch. */
export function OpenCurrentFile({ path }: { path: string }) {
  const origin = useContext(FileLinkContext);
  const runtime = useRuntime();
  const [error, setError] = useState("");
  if (!origin) return null;
  return (
    <button
      type="button"
      className="rounded px-2 py-1 text-xs text-accent hover:bg-hover"
      title={error || path}
      onClick={() =>
        void runtime.files
          .open({ ...origin, path })
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "无法打开文件"),
          )
      }
    >
      {error || "打开当前文件"}
    </button>
  );
}
