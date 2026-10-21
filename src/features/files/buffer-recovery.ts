/** Browser recovery copies; disk contents remain authoritative when saving. */
export interface SavedFileBuffer {
  path: string;
  text: string;
  baseText: string;
  cwd?: string;
  threadId?: string;
}
const MAX_STORED_LENGTH = 2 * 1024 * 1024;
const MAX_TEXT_LENGTH = 256 * 1024;
const MAX_BUFFERS = 20;
const unavailable =
  "编辑恢复副本未能保存到浏览器，请在离开前保存文件或复制未保存内容。";

function endpointKey(endpoint: string): string {
  try {
    return new URL(endpoint).href;
  } catch {
    return endpoint;
  }
}
export function fileBufferKey(scope: string, endpoint: string): string {
  return `codex-workbench.file-buffers:${JSON.stringify([scope, endpointKey(endpoint)])}`;
}
function isBuffer(value: unknown): value is SavedFileBuffer {
  if (!value || typeof value !== "object") return false;
  const buffer = value as SavedFileBuffer;
  return (
    typeof buffer.path === "string" &&
    /^(\/|[a-z]:\/)/i.test(buffer.path) &&
    buffer.path.length <= 8192 &&
    typeof buffer.text === "string" &&
    typeof buffer.baseText === "string" &&
    buffer.text.length <= MAX_TEXT_LENGTH &&
    buffer.baseText.length <= MAX_TEXT_LENGTH &&
    (buffer.cwd === undefined || typeof buffer.cwd === "string") &&
    (buffer.threadId === undefined || typeof buffer.threadId === "string")
  );
}
export function readFileBuffers(key: string): {
  buffers: SavedFileBuffer[];
  error?: string;
} {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { buffers: [] };
    if (raw.length > MAX_STORED_LENGTH) throw new Error("size");
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 ||
      !Array.isArray(value.buffers) ||
      value.buffers.length > MAX_BUFFERS ||
      !value.buffers.every(isBuffer)
    )
      throw new Error("schema");
    return { buffers: value.buffers };
  } catch {
    return {
      buffers: [],
      error: "无法读取浏览器中的编辑恢复副本；当前文件仍可正常打开和编辑。",
    };
  }
}
export function saveFileBuffers(
  key: string,
  buffers: SavedFileBuffer[],
): string | undefined {
  try {
    if (!buffers.length) {
      localStorage.removeItem(key);
      return;
    }
    if (buffers.length > MAX_BUFFERS || !buffers.every(isBuffer))
      return unavailable;
    const raw = JSON.stringify({ version: 1, buffers });
    if (raw.length > MAX_STORED_LENGTH) return unavailable;
    localStorage.setItem(key, raw);
  } catch {
    return unavailable;
  }
}
