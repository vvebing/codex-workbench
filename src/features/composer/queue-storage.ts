import { t } from "../../lib/i18n";
import type { TaskQueue } from "./queue";

type Queues = Record<string, TaskQueue>;

/** Attachments belong in IndexedDB, not the small localStorage quota. */
export class QueueStorage {
  private database?: Promise<IDBDatabase>;
  private memory = new Map<string, Queues>();
  private open(): Promise<IDBDatabase> {
    return (this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("codex-message-queues", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("queues");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error(t("无法打开待发送任务存储，请关闭旧页面后重试。")));
    }));
  }
  async read(scope: string): Promise<Queues> {
    if (typeof indexedDB === "undefined")
      return structuredClone(this.memory.get(scope) ?? {});
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction("queues").objectStore("queues").get(scope);
      request.onsuccess = () => resolve(request.result ?? {});
      request.onerror = () => reject(request.error);
    });
  }
  async write(scope: string, queues: Queues): Promise<void> {
    if (typeof indexedDB === "undefined") {
      this.memory.set(scope, structuredClone(queues));
      return;
    }
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("queues", "readwrite");
      transaction.objectStore("queues").put(queues, scope);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error(t("待发送任务保存失败。")));
    });
  }
}
