import { useTranslation } from "react-i18next";
import { getLocale, t } from "../../lib/i18n";
import type { ImageGenerationItem } from "../../generated/ImageGenerationItem";
import { ConversationImage } from "../../components/ImagePreview";
import { ErrorNotice, ScrollArea } from "../../components/ui";
import { LocalMessageImage } from "./MessageImage";
import { generatedImageSource } from "./image-generation";
import { ToolText } from "./ToolText";

export function GeneratedImage({
  item,
  status,
}: {
  item: ImageGenerationItem;
  status: string;
}) {
  useTranslation();
  const source = generatedImageSource(item);
  return (
    <div className="min-w-0 space-y-2">
      {item.revisedPrompt && (
        <ScrollArea scrollChaining className="max-h-40">
          <ToolText text={item.revisedPrompt} />
        </ScrollArea>
      )}
      {item.failure ? (
        <ErrorNotice>
          {t("图片生成额度已用尽（{{value0}}）", {
            value0: item.failure.limitId,
          })}
          {item.failure.resetsAt != null
            ? t("，重置时间：{{value0}}", {
                value0: new Date(item.failure.resetsAt * 1000).toLocaleString(
                  getLocale(),
                ),
              })
            : ""}
        </ErrorNotice>
      ) : source.type === "local" ? (
        <LocalMessageImage path={source.path} name={t("工具生成图片")} />
      ) : source.type === "url" ? (
        <ConversationImage src={source.url} name={t("工具生成图片")} />
      ) : (
        <p className="text-xs text-muted" role="status">
          {status === "failed"
            ? t("图片生成失败")
            : status === "inProgress" || status === "in_progress"
              ? t("正在生成图片")
              : source.type === "unavailable"
                ? t("图片已生成，暂无法预览。")
                : t("未返回图片")}
        </p>
      )}
      {item.savedPath && <p className="text-xs text-muted">{item.savedPath}</p>}
      {("fileId" in item ||
        item.generationId ||
        !!item.inputImages?.length) && (
        <details className="text-xs">
          <summary className="cursor-pointer py-1 text-muted">
            {t("图片生成记录")}
          </summary>
          <dl className="mt-2 space-y-2 [overflow-wrap:anywhere]">
            {"fileId" in item && (
              <div>
                <dt className="text-muted">{t("图片文件 ID")}</dt>
                <dd>{item.fileId}</dd>
              </div>
            )}
            {item.generationId && (
              <div>
                <dt className="text-muted">{t("生成 ID")}</dt>
                <dd>{item.generationId}</dd>
              </div>
            )}
          </dl>
          {!!item.inputImages?.length && (
            <div className="mt-3 space-y-2">
              <p className="font-medium">{t("生成时读取的参考图片")}</p>
              <p className="text-muted">
                {t("仅记录生成时的路径与 SHA-256，当前文件可能已变化。")}
              </p>
              <ul className="divide-y divide-border">
                {item.inputImages.map((input, index) => (
                  <li key={`${input.path}:${index}`} className="space-y-1 py-2">
                    <p>{input.path}</p>
                    <p className="text-muted">SHA-256: {input.sha256}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </details>
      )}
    </div>
  );
}
