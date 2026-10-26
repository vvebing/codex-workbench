import type { ConnectionStore } from "../connection/store";
import type { FsReadDirectoryResponse } from "../../generated/v2/FsReadDirectoryResponse";
import { workspacePath } from "./project-files";
export type DirectoryEntry = {
  path: string;
  directory: boolean;
  file: boolean;
};
export type DirectoryListing = { entries?: DirectoryEntry[]; error?: string };
/** Bounded workspace data survives panel and same-directory session mounts. */
export class WorkspaceDirectories {
  directories: Record<string, DirectoryListing> = {};
  expanded = new Set([""]);
  query = "";
  revision = 0;
  fileRevision?: number;
  selected?: string;
  followedEditorPath?: string;
  handledReveal?: object;
  selectedDirectory = false;
  scrollTop = 0;
  private requests = new Map<string, Promise<void>>();
  private versions = new Map<string, number>();
  private listeners = new Set<() => void>();
  constructor(
    private connection: ConnectionStore,
    private cwd: string,
    private epoch: number,
    private scope: number,
  ) {}
  isSubscribed = () => this.listeners.size > 0;
  getSnapshot = () => this.directories;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  consumeFileRevision(revision: number, changedPaths?: string[]) {
    const previous = this.fileRevision;
    this.fileRevision = revision;
    if (previous === undefined || previous === revision) return false;
    if (
      revision === previous + 1 &&
      changedPaths?.length &&
      !changedPaths.some(
        (path) =>
          path === this.cwd ||
          path.startsWith(`${this.cwd.replace(/\/$/, "")}/`),
      )
    )
      return false;
    this.invalidate();
    this.revision++;
    return true;
  }
  invalidate() {
    this.versions.clear();
  }
  async read(relative: string, revision: number): Promise<void> {
    if (this.versions.get(relative) === revision) return;
    if (this.requests.has(relative)) {
      await this.requests.get(relative);
      return this.read(relative, revision);
    }
    this.versions.set(relative, revision);
    const request = (async () => {
      try {
        const response =
          await this.connection.client.request<FsReadDirectoryResponse>(
            "fs/readDirectory",
            { path: relative ? workspacePath(this.cwd, relative) : this.cwd },
          );
        const state = this.connection.getSnapshot();
        if (state.epoch !== this.epoch || state.scope !== this.scope) return;
        const entries = response.entries
          .filter(
            (entry) =>
              entry.fileName !== ".git" &&
              !/[\\/]/.test(entry.fileName) &&
              entry.fileName !== "." &&
              entry.fileName !== "..",
          )
          .map((entry) => ({
            path: relative ? `${relative}/${entry.fileName}` : entry.fileName,
            directory: entry.isDirectory,
            file: entry.isFile,
          }))
          .sort(
            (a, b) =>
              Number(b.directory) - Number(a.directory) ||
              a.path.localeCompare(b.path),
          );
        this.directories = { ...this.directories, [relative]: { entries } };
        const paths = Object.keys(this.directories);
        for (const path of paths) {
          if (Object.keys(this.directories).length <= 256) break;
          if (!this.expanded.has(path)) {
            delete this.directories[path];
            this.versions.delete(path);
          }
        }
      } catch (error) {
        this.directories = {
          ...this.directories,
          [relative]: { ...this.directories[relative], error: String(error) },
        };
      } finally {
        this.listeners.forEach((listener) => listener());
      }
    })();
    this.requests.set(relative, request);
    try {
      await request;
    } finally {
      this.requests.delete(relative);
    }
  }
}
const caches = new WeakMap<
  ConnectionStore,
  Map<string, WorkspaceDirectories>
>();
export function workspaceDirectories(connection: ConnectionStore, cwd: string) {
  let cache = caches.get(connection);
  if (!cache) {
    cache = new Map();
    caches.set(connection, cache);
  }
  const { epoch, scope } = connection.getSnapshot();
  const key = JSON.stringify([epoch, scope, cwd]);
  let value = cache.get(key);
  if (!value) value = new WorkspaceDirectories(connection, cwd, epoch, scope);
  cache.delete(key);
  cache.set(key, value);
  for (const [old, candidate] of cache) {
    if (cache.size <= 24) break;
    if (old !== key && !candidate.isSubscribed()) cache.delete(old);
  }
  return value;
}
