import { t, useLocale } from "../../lib/i18n";
import { Button } from "../../components/ui";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
  type ComponentPropsWithoutRef,
} from "react";
import { defaultUrlTransform, type ExtraProps } from "react-markdown";
import { useRuntime } from "../../lib/runtime-context";
import {
  parseFileLink,
  parseImageFileLink,
  type FileLinkOrigin,
} from "./file-links";
import { ImageFileAnchor } from "./ImageFileAnchor";

const FileLinkContext = createContext<FileLinkOrigin | null>(null);

export function useFileLinkOrigin() {
  return useContext(FileLinkContext);
}

export function FileLinkProvider({
  cwd,
  threadId,
  children,
}: FileLinkOrigin & { children: ReactNode }) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const origin = useMemo(
    () => (void i18nLocale, { cwd, threadId }),
    [cwd, threadId, i18nLocale],
  );
  return (
    <FileLinkContext.Provider value={origin}>
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
  const i18nLocale = useLocale();
  void i18nLocale;

  const origin = useContext(FileLinkContext);
  const runtime = useRuntime();
  const [error, setError] = useState("");
  void _node;
  const image =
    href && origin
      ? parseImageFileLink(
          href,
          origin,
          typeof window === "undefined" ? undefined : window.location.origin,
        )
      : null;
  if (image)
    return (
      <ImageFileAnchor {...props} href={href} fileTarget={image}>
        {children}
      </ImageFileAnchor>
    );
  const target = href && origin ? parseFileLink(href, origin) : null;
  if (!target) {
    const url = href ? defaultUrlTransform(href) : href;
    const external = !!url && /^(?:https?:)?\/\//i.test(url);
    return (
      <a
        {...props}
        href={url}
        target={external ? "_blank" : props.target}
        rel={external ? "noopener noreferrer" : props.rel}
      >
        {children}
      </a>
    );
  }
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
            setError(
              cause instanceof Error ? cause.message : t("无法打开文件"),
            ),
          );
      }}
    >
      {children}
    </a>
  );
}

/** Explicit current-file action next to the preserved historical patch. */
export function OpenCurrentFile({ path }: { path: string }) {
  const i18nLocale = useLocale();
  void i18nLocale;
  const origin = useContext(FileLinkContext);
  const runtime = useRuntime();
  const [error, setError] = useState("");
  if (!origin) return null;
  return (
    <Button
      size="sm"
      variant="quiet"
      title={error || path}
      onClick={() =>
        void runtime.files
          .open({ ...origin, path })
          .catch((cause: unknown) =>
            setError(
              cause instanceof Error ? cause.message : t("无法打开文件"),
            ),
          )
      }
    >
      {error || t("打开当前文件")}
    </Button>
  );
}
