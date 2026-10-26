import { t, useLocale } from "../../lib/i18n";
import { Button } from "../../components/ui";
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { ImagePreview } from "../../components/ImagePreview";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import { imageDataUrl } from "../conversation/image-source";
import { absoluteFilePath } from "./store";
import type { FileLinkTarget } from "./file-links";
import type { FsReadFileResponse } from "../../generated/v2/FsReadFileResponse";

/** Read from the selected app-server connection, never the web server filesystem. */
export function ImageFileAnchor({
  fileTarget,
  children,
  ...props
}: ComponentPropsWithoutRef<"a"> & { fileTarget: FileLinkTarget }) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const { connection } = useRuntime();
  const { status, scope, epoch } = useStore(connection);
  const trigger = useRef<HTMLAnchorElement>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{
    url?: string;
    error?: string;
    scope?: number;
    epoch?: number;
    path?: string;
  }>({});
  const path = absoluteFilePath(fileTarget.path, fileTarget.cwd);
  const name = path.split("/").at(-1) || t("图片");
  useEffect(() => {
    if (!open || status !== "connected") return;
    let cancelled = false;
    setResult({});
    void connection.client
      .request<FsReadFileResponse>("fs/readFile", { path })
      .then((response) => {
        const url = imageDataUrl(response.dataBase64);
        if (
          !cancelled &&
          connection.getSnapshot().scope === scope &&
          connection.getSnapshot().epoch === epoch
        )
          setResult({ url, scope, epoch, path });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResult({
            error: error instanceof Error ? error.message : t("图片无法加载"),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [connection, open, path, status, scope, epoch]);
  // Scope changes immediately hide bytes belonging to the previous environment.
  return (
    <>
      <a
        {...props}
        ref={trigger}
        title={result.error || props.title || path}
        aria-busy={open && !result.url && !result.error}
        onClick={(event) => {
          event.preventDefault();
          setResult({});
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open && !result.url && (
        <span role="status" className="ml-2 text-xs text-muted">
          {status !== "connected"
            ? t("连接后查看图片")
            : result.error || t("正在加载图片")}
          {result.error && (
            <Button
              size="sm"
              variant="quiet"
              className="ml-2"
              onClick={() => setOpen(false)}
            >
              {t("关闭")}
            </Button>
          )}
        </span>
      )}
      <ImagePreview
        image={
          open &&
          result.scope === scope &&
          result.epoch === epoch &&
          result.path === path &&
          result.url
            ? { url: result.url, name }
            : undefined
        }
        onClose={() => setOpen(false)}
        triggerRef={trigger}
      />
    </>
  );
}
