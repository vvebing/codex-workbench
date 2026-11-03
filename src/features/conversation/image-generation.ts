import type { ImageGenerationItem } from "../../generated/ImageGenerationItem";
import { imageDataUrl } from "./image-source";

export type GeneratedImageSource =
  | { type: "local"; path: string }
  | { type: "url"; url: string }
  | { type: "unavailable" }
  | { type: "empty" };

/** File IDs identify backend artifacts; they are never filesystem paths. */
export function generatedImageSource(
  item: ImageGenerationItem,
): GeneratedImageSource {
  if (item.savedPath?.trim()) return { type: "local", path: item.savedPath };
  const result = "result" in item ? item.result.trim() : "";
  if (result) {
    if (/^(?:https?:\/\/|blob:|data:image\/)/i.test(result))
      return { type: "url", url: result };
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(result) && result.length > 64) {
      try {
        return { type: "url", url: imageDataUrl(result) };
      } catch {
        return { type: "unavailable" };
      }
    }
    if (
      /^(?:\/|[A-Za-z]:[\\/]|\.\.?[\\/])/.test(result) ||
      (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(result) &&
        /\.(?:png|jpe?g|webp|gif)$/i.test(result))
    )
      return { type: "local", path: result };
    return { type: "unavailable" };
  }
  return "fileId" in item && item.fileId
    ? { type: "unavailable" }
    : { type: "empty" };
}

export function hasGeneratedImageContent(item: ImageGenerationItem): boolean {
  return !!(
    ("result" in item && item.result) ||
    ("fileId" in item && item.fileId) ||
    item.savedPath ||
    item.failure ||
    item.revisedPrompt ||
    item.generationId ||
    item.inputImages?.length
  );
}

export function generatedImageRecord(item: ImageGenerationItem) {
  return {
    ...("result" in item ? { result: item.result } : { fileId: item.fileId }),
    savedPath: item.savedPath,
    generationId: item.generationId ?? null,
    inputImages: item.inputImages,
    failure: item.failure,
  };
}
