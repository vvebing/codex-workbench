/** Validate saved image bytes before creating a browser-renderable source. */
export function imageDataUrl(data: string): string {
  if (data.length > 10 * 1024 * 1024)
    throw new Error("图片编码大小超过 10 MB。");
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
  if (!mime) throw new Error("图片格式无法识别。");
  return `data:${mime};base64,${data}`;
}
