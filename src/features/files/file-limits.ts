import { t } from "../../lib/i18n";

export const MAX_NORMAL_FILE_BYTES = 1024 * 1024;
export const MAX_EDITABLE_FILE_BYTES = 5 * 1024 * 1024;
// Whole-file base64 responses must fit within the bridge's 16 MB message cap.
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MIN_FILE_LIMIT_BYTES = 256 * 1024;
export interface FileLimits {
  normalBytes: number;
  editableBytes: number;
  viewBytes: number;
  diffBytes: number;
}
export const DEFAULT_FILE_LIMITS: Readonly<FileLimits> = Object.freeze({
  normalBytes: MAX_NORMAL_FILE_BYTES,
  editableBytes: MAX_EDITABLE_FILE_BYTES,
  viewBytes: MAX_FILE_BYTES,
  diffBytes: MAX_FILE_BYTES,
});
export function normalizeFileLimits(value?: unknown): FileLimits {
  if (value === undefined) return { ...DEFAULT_FILE_LIMITS };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(t("文件大小限制配置无效。"));
  const limits = { ...DEFAULT_FILE_LIMITS, ...value } as FileLimits;
  for (const key of Object.keys(DEFAULT_FILE_LIMITS) as (keyof FileLimits)[]) {
    const size = limits[key];
    if (
      !Number.isSafeInteger(size) ||
      size < MIN_FILE_LIMIT_BYTES ||
      size > MAX_FILE_BYTES
    )
      throw new Error(t("文件大小限制须在 0.25 至 8 MB 之间。"));
  }
  if (
    limits.normalBytes > limits.editableBytes ||
    limits.editableBytes > limits.viewBytes ||
    limits.diffBytes > limits.viewBytes
  )
    throw new Error(
      t("普通模式上限不能超过编辑上限；编辑和差异上限不能超过查看上限。"),
    );
  return Object.fromEntries(
    Object.keys(DEFAULT_FILE_LIMITS).map((key) => [
      key,
      limits[key as keyof FileLimits],
    ]),
  ) as unknown as FileLimits;
}
export function formatFileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Number((bytes / (1024 * 1024)).toFixed(2))} MB`
    : `${Number((bytes / 1024).toFixed(2))} KB`;
}

/** Bound expensive language/rendering features even for short, dense files. */
export function isLargeFile(
  text: string,
  byteLength?: number,
  normalBytes = MAX_NORMAL_FILE_BYTES,
): boolean {
  if ((byteLength ?? new TextEncoder().encode(text).length) > normalBytes)
    return true;
  let lines = 1;
  let column = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      if (++lines > 20_000) return true;
      column = 0;
    } else if (++column > 20_000) return true;
  }
  return false;
}
export function fileTextInfo(
  text: string,
  limits: FileLimits = DEFAULT_FILE_LIMITS,
) {
  const byteLength = new TextEncoder().encode(text).length;
  return {
    byteLength,
    largeFile: isLargeFile(text, byteLength, limits.normalBytes),
  };
}
