import {
  readGitComparison,
  type GitComparison,
  type GitComparisonRequest,
} from "./git-content";
import { Store, errorMessage } from "../../lib/store";
import type { ConnectionStore } from "../connection/store";
import { watchWorkspace } from "../shell/workspace-watch";

export interface OpenFileRequest {
  path: string;
  cwd?: string;
  threadId?: string;
  line?: number;
  column?: number;
  endLine?: number;
}
export interface FileDocument extends OpenFileRequest {
  id: string;
  navigationRevision: number;
  text: string;
  baseText: string;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error?: string;
  conflict: boolean;
  readonly: boolean;
  diskText?: string;
  gitComparison?: GitComparison;
  preview?: boolean;
}
export interface FileWorkspaceSnapshot {
  documents: FileDocument[];
  activeId?: string;
  visible: boolean;
  revision: number;
  openRevision: number;
}
export const MAX_FILE_BYTES = 256 * 1024;

export function absoluteFilePath(path: string, cwd?: string): string {
  const input = path.replace(/\\/g, "/");
  const joined = /^(\/|[a-z]:\/)/i.test(input)
    ? input
    : `${cwd ?? ""}/${input}`;
  if (
    !/^(\/|[a-z]:\/)/i.test(joined) ||
    (!cwd && !/^(\/|[a-z]:\/)/i.test(input))
  )
    throw new Error("文件路径必须是绝对路径，或提供工作目录。");
  const prefix = joined.startsWith("/") ? "/" : joined.slice(0, 3);
  const parts: string[] = [];
  for (const part of joined.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return prefix + parts.join("/");
}
function encode(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text))
    binary += String.fromCharCode(byte);
  return btoa(binary);
}
function decode(data: string): string {
  if (data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4)
    throw new Error("文件超过 256 KB，无法在此工作区打开。");
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0))
    throw new Error("二进制或过大的文件无法编辑。");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}

export class FileWorkspaceStore extends Store<FileWorkspaceSnapshot> {
  private documents = new Map<string, FileDocument>();
  private urls = new Map<string, string>();
  private watches = new Map<string, () => void>();
  private reads = new Map<string, number>();
  private uncertainWrites = new Set<string>();
  private removals = new Set<{
    url: string;
    path: string;
    directory: boolean;
  }>();
  private connectionKey = "";
  private mutationPending = false;
  constructor(private connection: ConnectionStore) {
    super({ documents: [], visible: false, revision: 0, openRevision: 0 });
    connection.subscribe(() => {
      const state = connection.getSnapshot();
      const key = `${state.url}:${state.epoch}:${state.status}`;
      if (key === this.connectionKey) return;
      this.connectionKey = key;
      this.watches.forEach((stop) => stop());
      this.watches.clear();
      for (const [id, doc] of this.documents) {
        this.reads.set(id, (this.reads.get(id) ?? 0) + 1);
        if (doc.loading) this.documents.set(id, { ...doc, loading: false });
      }
      this.publish();
      if (state.status === "connected")
        for (const doc of this.state.documents) {
          this.watch(doc);
          if (!doc.gitComparison) void this.read(doc.id, false);
        }
    });
  }
  private publish(patch: Partial<FileWorkspaceSnapshot> = {}) {
    const url = this.connection.getSnapshot().url;
    this.update({
      ...this.state,
      ...patch,
      documents: [...this.documents.values()].filter(
        (doc) => this.urls.get(doc.id) === url,
      ),
    });
  }
  private patch(id: string, patch: Partial<FileDocument>) {
    const doc = this.documents.get(id);
    if (doc) {
      this.documents.set(id, { ...doc, ...patch });
      this.publish();
    }
  }
  private guard(id?: string) {
    const { url, epoch, status } = this.connection.getSnapshot();
    if (status !== "connected" || (id && this.urls.get(id) !== url))
      throw new Error("文件所属连接当前不可用。");
    return () => {
      const current = this.connection.getSnapshot();
      if (
        current.url !== url ||
        current.epoch !== epoch ||
        current.status !== "connected"
      )
        throw new Error("连接已变化，请重新检查文件状态。");
    };
  }
  private watch(doc: FileDocument) {
    if (
      doc.gitComparison ||
      this.watches.has(doc.id) ||
      !this.documents.has(doc.id) ||
      this.connection.getSnapshot().status !== "connected" ||
      this.urls.get(doc.id) !== this.connection.getSnapshot().url
    )
      return;
    const refresh = () => {
      void this.read(doc.id, false);
    };
    const stop = watchWorkspace(this.connection, doc.path, refresh);
    // Filesystem watch is optional on older servers; polling also catches dropped events.
    const timer = setInterval(refresh, 5000);
    this.watches.set(doc.id, () => {
      clearInterval(timer);
      stop();
    });
  }
  pin(id: string) {
    if (this.documents.get(id)?.preview) this.patch(id, { preview: false });
  }
  private replacePreview(except: string) {
    for (const doc of this.state.documents) {
      if (doc.id !== except && doc.preview && !doc.dirty && !doc.saving)
        this.close(doc.id);
    }
  }
  async openGitDiff(
    request: GitComparisonRequest,
    reload = false,
  ): Promise<void> {
    const current = this.guard();
    const url = this.connection.getSnapshot().url;
    const id = JSON.stringify([
      url,
      "git",
      request.cwd,
      request.path,
      request.group,
    ]);
    const existing = this.documents.get(id);
    if (existing && !reload) {
      this.publish({
        activeId: id,
        visible: true,
        openRevision: this.state.openRevision + 1,
      });
      return;
    }
    if (!existing) this.replacePreview(id);
    const navigationRevision = this.state.openRevision + 1;
    const generation = (this.reads.get(id) ?? 0) + 1;
    this.reads.set(id, generation);
    this.urls.set(id, url);
    this.documents.set(id, {
      id,
      path: request.path,
      cwd: request.cwd,
      threadId: request.threadId,
      navigationRevision,
      text: "",
      baseText: "",
      dirty: false,
      loading: true,
      saving: false,
      conflict: false,
      readonly: true,
      preview: existing?.preview ?? !existing,
      gitComparison: {
        request,
        original: "",
        originalLabel: "Git",
        modifiedLabel: "Git",
        canOpen: false,
      },
    });
    this.publish({
      activeId: id,
      visible: true,
      openRevision: navigationRevision,
    });
    const valid = () => {
      current();
      if (!this.documents.has(id) || this.reads.get(id) !== generation)
        throw new Error("差异读取已取消。");
    };
    try {
      const result = await readGitComparison(
        this.connection.client,
        request,
        valid,
      );
      valid();
      this.patch(id, {
        path: result.path,
        text: result.modified,
        baseText: result.modified,
        gitComparison: result.comparison,
        loading: false,
      });
    } catch (error) {
      if (this.documents.has(id) && this.reads.get(id) === generation)
        this.patch(id, { loading: false, error: errorMessage(error) });
    }
  }
  async open(request: OpenFileRequest): Promise<void> {
    const path = absoluteFilePath(request.path, request.cwd);
    const url = this.connection.getSnapshot().url;
    const id = JSON.stringify([url, path]);
    const existing = this.documents.get(id);
    const navigationRevision = this.state.openRevision + 1;
    if (existing)
      this.patch(id, {
        ...request,
        path,
        line: request.line,
        column: request.column,
        endLine: request.endLine,
        navigationRevision,
      });
    else {
      this.urls.set(id, url);
      this.documents.set(id, {
        ...request,
        path,
        id,
        navigationRevision,
        text: "",
        baseText: "",
        dirty: false,
        loading: true,
        saving: false,
        conflict: false,
        readonly: false,
      });
    }
    this.publish({
      activeId: id,
      visible: true,
      openRevision: navigationRevision,
    });
    if (!existing) await this.read(id, true);
    const current = this.documents.get(id);
    if (current) this.watch(current);
  }
  select(id: string) {
    if (this.state.documents.some((doc) => doc.id === id))
      this.publish({ activeId: id, visible: true });
  }
  setVisible(visible: boolean) {
    this.publish({ visible });
  }
  setText(id: string, text: string) {
    const doc = this.documents.get(id);
    if (!doc || doc.readonly || doc.loading) return;
    // Keep the original BOM and newline convention when textarea normalizes them.
    if (doc.baseText.startsWith("\ufeff") && !text.startsWith("\ufeff"))
      text = `\ufeff${text}`;
    if (doc.baseText.includes("\r\n")) text = text.replace(/\r?\n/g, "\r\n");
    this.patch(id, { text, dirty: text !== doc.baseText, preview: false });
  }
  private async read(id: string, discard: boolean): Promise<boolean> {
    const doc = this.documents.get(id);
    if (!doc || doc.saving || (!discard && doc.loading)) return false;
    const read = (this.reads.get(id) ?? 0) + 1;
    this.reads.set(id, read);
    try {
      const check = this.guard(id);
      this.patch(id, { loading: discard, error: undefined });
      const result = await this.connection.client.request<{
        dataBase64: string;
      }>("fs/readFile", { path: doc.path });
      check();
      if (this.reads.get(id) !== read || !this.documents.has(id)) return false;
      const text = decode(result.dataBase64);
      const latest = this.documents.get(id)!;
      if (!discard && latest.dirty)
        this.patch(id, {
          conflict: text !== latest.baseText,
          diskText: text,
          loading: false,
        });
      else
        this.patch(id, {
          text,
          baseText: text,
          dirty: false,
          conflict: false,
          loading: false,
          readonly: false,
          diskText: undefined,
        });
      return true;
    } catch (error) {
      if (this.reads.get(id) === read)
        this.patch(id, {
          loading: false,
          error: errorMessage(error),
          readonly: !this.documents.get(id)?.dirty,
          conflict: Boolean(this.documents.get(id)?.dirty),
        });
      return false;
    }
  }
  reload(id: string) {
    const git = this.documents.get(id)?.gitComparison;
    if (git) return this.openGitDiff(git.request, true);
    return this.read(id, true).then((loaded) => {
      const doc = this.documents.get(id);
      if (loaded && doc && !doc.error && !doc.dirty)
        this.uncertainWrites.delete(id);
    });
  }
  async save(id: string): Promise<void> {
    const doc = this.documents.get(id);
    if (!doc || !doc.dirty || doc.saving || doc.loading || doc.readonly) return;
    if (
      [...this.removals].some(
        (removal) =>
          removal.url === this.urls.get(id) &&
          (doc.path === removal.path ||
            (removal.directory && doc.path.startsWith(`${removal.path}/`))),
      )
    ) {
      this.patch(id, { error: "文件正在删除，请等待操作完成后检查磁盘状态。" });
      return;
    }
    if (this.uncertainWrites.has(id)) {
      this.patch(id, {
        error: "上次保存结果未知，请重新加载并核对磁盘内容后再保存。",
      });
      return;
    }
    const check = this.guard(id);
    this.reads.set(id, (this.reads.get(id) ?? 0) + 1);
    this.patch(id, { saving: true, error: undefined });
    try {
      const result = await this.connection.client.request<{
        dataBase64: string;
      }>("fs/readFile", { path: doc.path });
      check();
      if (decode(result.dataBase64) !== doc.baseText) {
        this.patch(id, { conflict: true, diskText: decode(result.dataBase64) });
        throw new Error("文件已被外部修改。请重新加载并合并后保存。");
      }
      this.uncertainWrites.add(id);
      await this.connection.client.request("fs/writeFile", {
        path: doc.path,
        dataBase64: encode(doc.text),
      });
      check();
      this.uncertainWrites.delete(id);
      this.patch(id, {
        baseText: doc.text,
        dirty: this.documents.get(id)?.text !== doc.text,
        conflict: false,
        diskText: undefined,
      });
      this.publish({ revision: this.state.revision + 1 });
    } catch (error) {
      this.patch(id, { error: errorMessage(error), conflict: true });
    } finally {
      this.patch(id, { saving: false });
    }
  }
  close(id: string) {
    if (this.documents.get(id)?.saving) return;
    this.watches.get(id)?.();
    this.watches.delete(id);
    this.reads.set(id, (this.reads.get(id) ?? 0) + 1);
    this.documents.delete(id);
    this.urls.delete(id);
    this.uncertainWrites.delete(id);
    this.publish({
      activeId:
        this.state.activeId === id
          ? this.state.documents.find((doc) => doc.id !== id)?.id
          : this.state.activeId,
    });
  }
  hasDirty() {
    return [...this.documents.values()].some((doc) => doc.dirty || doc.saving);
  }
  private async missing(path: string, check: () => void) {
    try {
      await this.connection.client.request("fs/getMetadata", { path });
    } catch (error) {
      check();
      if (/\bENOENT\b|\bno such file or directory\b/i.test(errorMessage(error)))
        return;
      throw error;
    }
    throw new Error("目标路径已存在。");
  }
  private async mutate(method: string, params: object, destination?: string) {
    if (this.mutationPending)
      throw new Error("另一项文件管理操作正在执行，请稍后重试。");
    this.mutationPending = true;
    try {
      const check = this.guard();
      if (destination) await this.missing(destination, check);
      check();
      await this.connection.client.request(method, params);
      check();
      this.publish({ revision: this.state.revision + 1 });
    } finally {
      this.mutationPending = false;
    }
  }
  createFile(path: string, text = "") {
    path = absoluteFilePath(path);
    return this.mutate(
      "fs/writeFile",
      { path, dataBase64: encode(text) },
      path,
    );
  }
  createDirectory(path: string) {
    path = absoluteFilePath(path);
    return this.mutate("fs/createDirectory", { path, recursive: false }, path);
  }
  copy(source: string, destination: string, isDirectory: boolean) {
    source = absoluteFilePath(source);
    destination = absoluteFilePath(destination);
    if (
      destination === source ||
      (isDirectory && destination.startsWith(`${source}/`))
    )
      return Promise.reject(new Error("不能复制到自身或其子目录。"));
    return this.mutate(
      "fs/copy",
      {
        sourcePath: source,
        destinationPath: destination,
        recursive: isDirectory,
      },
      destination,
    );
  }
  async remove(path: string, isDirectory: boolean) {
    path = absoluteFilePath(path);
    const affected = this.state.documents.filter(
      (doc) =>
        doc.path === path || (isDirectory && doc.path.startsWith(`${path}/`)),
    );
    if (affected.some((doc) => doc.dirty || doc.saving))
      throw new Error("请先保存或关闭目标内尚未保存的文件。");
    const removal = {
      url: this.connection.getSnapshot().url,
      path,
      directory: isDirectory,
    };
    this.removals.add(removal);
    try {
      await this.mutate("fs/remove", {
        path,
        recursive: isDirectory,
        force: false,
      });
      // Include tabs opened while the RPC was pending, and retain any new edits.
      for (const doc of this.documents.values()) {
        if (
          this.urls.get(doc.id) !== removal.url ||
          !(
            doc.path === path ||
            (isDirectory && doc.path.startsWith(`${path}/`))
          )
        )
          continue;
        this.reads.set(doc.id, (this.reads.get(doc.id) ?? 0) + 1);
        if (doc.dirty || doc.saving)
          this.patch(doc.id, {
            loading: false,
            conflict: true,
            error: "文件已删除；未保存的编辑已保留，请复制内容后恢复文件。",
          });
        else this.close(doc.id);
      }
    } finally {
      this.removals.delete(removal);
    }
  }
}
