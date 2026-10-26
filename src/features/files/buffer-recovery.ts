import { t } from "../../lib/i18n";
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
const unavailable = () =>
  t("编辑恢复副本未能保存到浏览器，请在离开前保存文件或复制未保存内容。");

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
      error: t("无法读取浏览器中的编辑恢复副本；当前文件仍可正常打开和编辑。"),
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
      return unavailable();
    const raw = JSON.stringify({ version: 1, buffers });
    if (raw.length > MAX_STORED_LENGTH) return unavailable();
    localStorage.setItem(key, raw);
  } catch {
    return unavailable();
  }
}

/** Large recovery buffers use structured clones, avoiding synchronous JSON copies. */
export const MAX_RECOVERY_TEXT_LENGTH = 5 * 1024 * 1024;
const RECOVERY_DATABASE = "codex-workbench-file-recovery";
const RECOVERY_STORE = "buffers";
export const recoveryUnavailable = unavailable;

function isLargeBuffer(value: unknown): value is SavedFileBuffer {
  if (!value || typeof value !== "object") return false;
  const buffer = value as SavedFileBuffer;
  return (
    typeof buffer.path === "string" &&
    /^(\/|[a-z]:\/)/i.test(buffer.path) &&
    buffer.path.length <= 8192 &&
    typeof buffer.text === "string" &&
    typeof buffer.baseText === "string" &&
    buffer.text.length <= MAX_RECOVERY_TEXT_LENGTH &&
    buffer.baseText.length <= MAX_RECOVERY_TEXT_LENGTH &&
    (buffer.cwd === undefined || typeof buffer.cwd === "string") &&
    (buffer.threadId === undefined || typeof buffer.threadId === "string")
  );
}

function recoveryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(RECOVERY_DATABASE, 1);
    let settled = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RECOVERY_STORE))
        request.result.createObjectStore(RECOVERY_STORE);
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => {
      settled = true;
      reject(request.error ?? new Error("IndexedDB open failed"));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("IndexedDB upgrade blocked"));
    };
  });
}

async function largeRecoveryRecord(
  key: string,
  buffers?: SavedFileBuffer[],
): Promise<unknown> {
  const database = await recoveryDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        RECOVERY_STORE,
        buffers ? "readwrite" : "readonly",
      );
      const store = transaction.objectStore(RECOVERY_STORE);
      const request = buffers
        ? buffers.length
          ? store.put({ version: 1, buffers }, key)
          : store.delete(key)
        : store.get(key);
      let result: unknown;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () =>
        reject(
          transaction.error ?? request.error ?? new Error("IndexedDB failed"),
        );
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    database.close();
  }
}

export async function readLargeFileBuffers(key: string): Promise<{
  buffers: SavedFileBuffer[];
  error?: string;
}> {
  // Old and unsupported browsers may still restore the synchronous small copies.
  if (typeof indexedDB === "undefined") return { buffers: [] };
  try {
    const value = await largeRecoveryRecord(key);
    if (value === undefined) return { buffers: [] };
    if (!value || typeof value !== "object") throw new Error("schema");
    const record = value as { version?: unknown; buffers?: unknown };
    if (
      record.version !== 1 ||
      !Array.isArray(record.buffers) ||
      record.buffers.length > MAX_BUFFERS ||
      !record.buffers.every(isLargeBuffer)
    )
      throw new Error("schema");
    return { buffers: record.buffers };
  } catch {
    return {
      buffers: [],
      error: t(
        "无法读取浏览器中的大文件编辑恢复副本；当前文件仍可正常打开和编辑。",
      ),
    };
  }
}

/** Caller debounces and serializes writes so newer edits always win. */
export async function saveLargeFileBuffers(
  key: string,
  buffers: SavedFileBuffer[],
): Promise<string | undefined> {
  if (buffers.length > MAX_BUFFERS || !buffers.every(isLargeBuffer))
    return unavailable();
  // No large copies exist on a browser without this capability.
  if (!buffers.length && typeof indexedDB === "undefined") return;
  try {
    await largeRecoveryRecord(key, buffers);
  } catch {
    return unavailable();
  }
}
