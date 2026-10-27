import { t } from "../../lib/i18n";
import { formatFileSize } from "../files/file-limits";
export function imageDataUrl(data: string, rawByteLimit?: number): string {
  if (rawByteLimit !== undefined) {
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    if (
      !Number.isSafeInteger(rawByteLimit) ||
      rawByteLimit < 0 ||
      data.length > Math.ceil(rawByteLimit / 3) * 4 ||
      Math.floor((data.length * 3) / 4) - padding > rawByteLimit
    )
      throw new Error(
        t("图片超过 {{value0}} 查看上限。", {
          value0: formatFileSize(rawByteLimit),
        }),
      );
  } else if (data.length > 10 * 1024 * 1024)
    throw new Error(t("图片编码大小超过 10 MB。"));
  const header = atob(data.slice(0, 32));
  const mime = header.startsWith("\x89PNG\r\n\x1a\n")
    ? "image/png"
    : header.startsWith("\xff\xd8\xff")
      ? "image/jpeg"
      : /^GIF8[79]a/.test(header)
        ? "image/gif"
        : header.startsWith("RIFF") && header.slice(8, 12) === "WEBP"
          ? "image/webp"
          : undefined;
  if (!mime) throw new Error(t("图片格式无法识别。"));
  return `data:${mime};base64,${data}`;
}
