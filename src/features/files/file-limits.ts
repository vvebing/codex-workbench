export const MAX_NORMAL_FILE_BYTES = 1024 * 1024;
export const MAX_EDITABLE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Bound expensive language/rendering features even for short, dense files. */
export function isLargeFile(text: string, byteLength?: number): boolean {
  if (
    (byteLength ?? new TextEncoder().encode(text).length) >
    MAX_NORMAL_FILE_BYTES
  )
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
export function fileTextInfo(text: string) {
  const byteLength = new TextEncoder().encode(text).length;
  return { byteLength, largeFile: isLargeFile(text, byteLength) };
}
