import { t, useLocale } from "../../lib/i18n";
import { ImageViewer } from "../../components/ImageViewer";

/** Image files share workspace tabs, but never enter a text model. */
export function FileImagePreview({
  url,
  path,
}: {
  url?: string;
  path: string;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-4"
      aria-label={t("文件图片预览")}
    >
      {url && (
        <div className="absolute inset-4 flex min-h-0 min-w-0">
          <ImageViewer
            image={{ url, name: path.split(/[\\/]/).at(-1) ?? path }}
            className="h-full w-full"
          />
        </div>
      )}
    </div>
  );
}
