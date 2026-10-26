import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";
import { useEffect, useState } from "react";
import { ImageOff, LoaderCircle, RefreshCw } from "lucide-react";
import { ConversationImage } from "../../components/ImagePreview";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import { useFileLinkOrigin } from "../files/FileLinkContext";
import { absoluteFilePath } from "../files/store";
import type { FsReadFileResponse } from "../../generated/v2/FsReadFileResponse";
import { imageDataUrl } from "./image-source";

/** History may refer to the app-server's saved attachment instead of a data URL. */
export function LocalMessageImage({
  path,
  name,
}: {
  path: string;
  name: string;
}) {
  useTranslation();
  const { connection } = useRuntime();
  const { status, epoch, scope } = useStore(connection);
  const origin = useFileLinkOrigin();
  const [attempt, retry] = useState(0);
  const [result, setResult] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    if (status !== "connected") return;
    let cancelled = false;
    setResult({});
    void (async () => {
      const response = await connection.client.request<FsReadFileResponse>(
        "fs/readFile",
        { path: absoluteFilePath(path, origin?.cwd) },
      );
      const url = imageDataUrl(response.dataBase64);
      if (
        !cancelled &&
        connection.getSnapshot().epoch === epoch &&
        connection.getSnapshot().scope === scope
      )
        setResult({ url });
    })().catch((error: unknown) => {
      if (!cancelled)
        setResult({
          error: error instanceof Error ? error.message : t("图片无法加载"),
        });
    });
    return () => {
      cancelled = true;
    };
  }, [connection, path, origin?.cwd, status, epoch, scope, attempt]);
  if (result.url) return <ConversationImage src={result.url} name={name} />;
  return (
    <span
      data-slot="conversation-image"
      className="my-1 mr-2 inline-flex max-w-full align-top rounded-lg border border-border bg-elevated p-1"
    >
      <span
        role="status"
        title={result.error}
        className="flex h-24 w-32 flex-col items-center justify-center gap-2 rounded bg-surface text-xs text-muted"
      >
        {status !== "connected" ? (
          <>
            <ImageOff size={20} aria-hidden="true" />
            {t("连接后查看图片")}
          </>
        ) : result.error ? (
          <>
            <ImageOff size={20} aria-hidden="true" />
            {t("图片无法加载")}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-hover"
              aria-label={t("重新加载图片 {{value0}}", { value0: name })}
              onClick={() => retry((value) => value + 1)}
            >
              <RefreshCw size={12} aria-hidden="true" />
              {t("重试")}
            </button>
          </>
        ) : (
          <>
            <LoaderCircle
              size={20}
              className="animate-spin"
              aria-hidden="true"
            />
            {t("正在加载图片")}
          </>
        )}
      </span>
    </span>
  );
}
